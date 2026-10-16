from __future__ import annotations

import ipaddress
import os
import socket
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from flask import Flask, jsonify, render_template, request

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024
MAX_HOPS = 12
TIMEOUT = 10
USER_AGENT = "MrDonLinkWeb/1.0 (public redirect inspector)"
REDIRECT_CODES = {301, 302, 303, 307, 308}


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def validate_public_url(raw: str) -> str:
    """Accept only public HTTP(S) URLs; reject local/private destinations."""
    raw = (raw or "").strip()
    if not raw or len(raw) > 4096:
        raise ValueError("Hãy nhập URL hợp lệ (tối đa 4096 ký tự).")
    if "://" not in raw:
        raw = "https://" + raw
    try:
        p = urlsplit(raw)
        scheme = p.scheme.lower()
        if scheme not in ("http", "https"):
            raise ValueError("Chỉ hỗ trợ URL HTTP hoặc HTTPS.")
        if not p.hostname:
            raise ValueError("URL thiếu tên miền.")
        if p.username or p.password:
            raise ValueError("Không chấp nhận URL chứa thông tin đăng nhập.")
        host = p.hostname.rstrip(".").lower()
        if host == "localhost" or host.endswith(".localhost") or host.endswith(".local"):
            raise ValueError("Địa chỉ localhost/mạng nội bộ không được phép.")

        try:
            ips = [ipaddress.ip_address(host)]
        except ValueError:
            try:
                infos = socket.getaddrinfo(host, p.port or (443 if scheme == "https" else 80),
                                           type=socket.SOCK_STREAM)
            except socket.gaierror as exc:
                raise ValueError("Không phân giải được tên miền. Kiểm tra URL hoặc mạng.") from exc
            ips = []
            for info in infos:
                try:
                    ips.append(ipaddress.ip_address(info[4][0].split("%")[0]))
                except ValueError:
                    continue
        if not ips:
            raise ValueError("Tên miền không có địa chỉ IP hợp lệ.")
        for ip in ips:
            if not ip.is_global:
                raise ValueError("Đã chặn địa chỉ IP nội bộ hoặc không công khai.")
        netloc = p.netloc
        # Preserve explicit port and IPv6 bracket notation; remove URL fragment.
        return urlunsplit((scheme, netloc, p.path or "/", p.query, ""))
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError(f"URL không hợp lệ: {exc}") from exc


def request_once(opener, url: str, method: str):
    req = Request(url, headers={
        "User-Agent": USER_AGENT,
        "Accept": "*/*",
        "Range": "bytes=0-1023",
    }, method=method)
    try:
        response = opener.open(req, timeout=TIMEOUT)
        status, headers = response.getcode(), response.headers
        response.close()
        return status, headers
    except HTTPError as exc:
        status, headers = exc.code, exc.headers
        exc.close()
        return status, headers
    except (URLError, TimeoutError, OSError):
        raise


def inspect_url(raw: str):
    current = validate_public_url(raw)
    chain = []
    seen = set()
    opener = build_opener(NoRedirect())

    for hop in range(MAX_HOPS + 1):
        # Revalidate every hop, including hostname resolution, before requesting it.
        current = validate_public_url(current)
        if current in seen:
            raise RuntimeError("Phát hiện vòng lặp chuyển hướng.")
        seen.add(current)

        try:
            try:
                status, headers = request_once(opener, current, "HEAD")
                if status in (400, 403, 405, 501):
                    status, headers = request_once(opener, current, "GET")
            except (URLError, TimeoutError, OSError):
                status, headers = request_once(opener, current, "GET")
        except HTTPError as exc:
            status, headers = exc.code, exc.headers
        except Exception as exc:
            raise RuntimeError(f"Không truy cập được URL ở bước {hop + 1}: {exc}") from exc

        location = headers.get("Location") if headers else None
        chain.append({
            "step": hop + 1,
            "status": int(status),
            "url": current,
            "location": location or "",
        })

        if status in REDIRECT_CODES and location:
            if hop >= MAX_HOPS:
                raise RuntimeError(f"Đã chạm giới hạn {MAX_HOPS} lần chuyển hướng.")
            next_url = urljoin(current, location)
            current = validate_public_url(next_url)
            continue

        if status in (401, 407):
            raise RuntimeError(f"Trang yêu cầu xác thực (HTTP {status}); công cụ không vượt đăng nhập.")
        if status in (403, 429):
            raise RuntimeError(f"Trang từ chối hoặc giới hạn yêu cầu (HTTP {status}); công cụ không vượt cơ chế bảo vệ.")
        return {"final_url": current, "chain": chain, "count": len(chain)}

    raise RuntimeError("Không hoàn tất chuỗi chuyển hướng.")


@app.get("/")
def index():
    return render_template("index.html")


@app.post("/api/resolve")
def resolve():
    payload = request.get_json(silent=True) or {}
    url = payload.get("url", "")
    try:
        result = inspect_url(url)
        return jsonify({"ok": True, **result})
    except (ValueError, RuntimeError) as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    except Exception:
        app.logger.exception("Unexpected link resolution error")
        return jsonify({"ok": False, "error": "Có lỗi không xác định. Hãy thử lại với URL khác."}), 500


@app.get("/health")
def health():
    return jsonify({"status": "ok"})


if __name__ == "__main__":
    # Local development only. Use a production WSGI server for deployment.
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", "5000")), debug=False)

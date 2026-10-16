(() => {
  const $ = (id) => document.getElementById(id);
  const form = $("resolve-form"), input = $("url-input"), submit = $("submit-btn");
  const notice = $("notice"), progress = $("progress"), resultSection = $("result-section");
  const chainEl = $("chain"), historyList = $("history-list"), emptyHistory = $("empty-history");
  const HISTORY_KEY = "mrdon-link-tool-history-v1";
  let lastFinalUrl = "";

  function showNotice(message, kind = "error") {
    notice.textContent = message;
    notice.className = "notice" + (kind === "success" ? " success" : "");
  }
  function hideNotice() { notice.className = "notice hidden"; }
  function safeText(value) { return String(value ?? ""); }
  function getHistory() {
    try {
      const data = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
      return Array.isArray(data) ? data.slice(0, 15) : [];
    } catch { return []; }
  }
  function saveHistory(entry) {
    const items = getHistory().filter(x => x.input !== entry.input);
    items.unshift(entry);
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 15))); } catch {}
    renderHistory();
  }
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      showNotice("Đã sao chép URL vào clipboard.", "success");
    } catch {
      const temp = document.createElement("textarea");
      temp.value = text; temp.style.position = "fixed"; temp.style.opacity = "0";
      document.body.appendChild(temp); temp.select();
      const ok = document.execCommand("copy"); temp.remove();
      showNotice(ok ? "Đã sao chép URL vào clipboard." : "Không thể sao chép tự động. Hãy chọn và sao chép URL.", ok ? "success" : "error");
    }
  }
  function makeLink(url, className) {
    const a = document.createElement("a");
    a.className = className || "";
    a.textContent = url;
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    return a;
  }
  function renderChain(data) {
    chainEl.replaceChildren();
    data.chain.forEach((item, idx) => {
      const row = document.createElement("div"); row.className = "chain-item";
      const dot = document.createElement("div"); dot.className = "step-dot"; dot.textContent = String(idx + 1);
      const content = document.createElement("div"); content.className = "chain-content";
      const top = document.createElement("div"); top.className = "chain-top";
      const code = document.createElement("span"); code.className = "http-code" + ([200, 204, 206].includes(item.status) ? " ok" : "");
      code.textContent = "HTTP " + item.status;
      const label = document.createElement("span"); label.className = "chain-label";
      label.textContent = item.location ? "Chuyển hướng →" : "Điểm dừng";
      top.append(code, label);
      content.append(top, makeLink(item.url, "chain-url"));
      if (item.location) {
        const loc = document.createElement("div"); loc.className = "chain-label";
        loc.style.cssText = "margin-top:7px;overflow-wrap:anywhere;line-height:1.5";
        loc.textContent = "Location: " + item.location;
        content.append(loc);
      }
      row.append(dot, content); chainEl.append(row);
    });
    lastFinalUrl = data.final_url;
    const finalLink = $("final-url");
    finalLink.textContent = data.final_url; finalLink.href = data.final_url;
    $("step-count").textContent = data.count + (data.count === 1 ? " bước" : " bước");
    resultSection.classList.remove("hidden");
  }
  function renderHistory() {
    const items = getHistory();
    historyList.replaceChildren();
    emptyHistory.classList.toggle("hidden", items.length > 0);
    items.forEach((item) => {
      const row = document.createElement("div"); row.className = "history-entry";
      const icon = document.createElement("div"); icon.className = "history-symbol"; icon.textContent = "↗";
      const main = document.createElement("div"); main.className = "history-main";
      const link = document.createElement("a"); link.className = "history-url"; link.href = item.finalUrl;
      link.target = "_blank"; link.rel = "noopener noreferrer"; link.textContent = item.finalUrl;
      link.title = item.finalUrl;
      const meta = document.createElement("div"); meta.className = "history-meta";
      meta.textContent = `${item.count} bước · ${new Date(item.at).toLocaleString()}`;
      main.append(link, meta);
      const actions = document.createElement("div"); actions.className = "history-actions";
      const copy = document.createElement("button"); copy.className = "mini-btn"; copy.type = "button"; copy.textContent = "Sao chép";
      copy.addEventListener("click", () => copyText(item.finalUrl));
      const rerun = document.createElement("button"); rerun.className = "mini-btn"; rerun.type = "button"; rerun.textContent = "Kiểm tra lại";
      rerun.addEventListener("click", () => { input.value = item.input; form.requestSubmit(); window.scrollTo({top: 0, behavior: "smooth"}); });
      actions.append(copy, rerun); row.append(icon, main, actions); historyList.append(row);
    });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const url = input.value.trim();
    if (!url) return;
    hideNotice(); submit.disabled = true; progress.classList.remove("hidden");
    submit.querySelector("span").textContent = "Đang kiểm tra…";
    try {
      const response = await fetch("/api/resolve", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({url})
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Không thể kiểm tra URL.");
      renderChain(data);
      saveHistory({input: url, finalUrl: data.final_url, count: data.count, at: Date.now()});
      showNotice("Đã kiểm tra xong. Hãy xem URL cuối cùng và chuỗi chuyển hướng bên dưới.", "success");
      resultSection.scrollIntoView({behavior: "smooth", block: "start"});
    } catch (err) {
      showNotice(err.message || "Không thể kết nối máy chủ. Hãy thử lại.");
    } finally {
      submit.disabled = false; progress.classList.add("hidden");
      submit.querySelector("span").textContent = "Kiểm tra link";
    }
  });
  $("paste-btn").addEventListener("click", async () => {
    try { input.value = await navigator.clipboard.readText(); input.focus(); }
    catch { showNotice("Trình duyệt không cho phép đọc clipboard. Hãy nhấn Ctrl+V vào ô URL."); }
  });
  $("copy-final").addEventListener("click", () => lastFinalUrl && copyText(lastFinalUrl));
  $("clear-history").addEventListener("click", () => {
    try { localStorage.removeItem(HISTORY_KEY); } catch {}
    renderHistory(); showNotice("Đã xóa lịch sử lưu trên trình duyệt.", "success");
  });
  renderHistory();
})();

  // ---- Kit: the site's shared UI building blocks. Every helper returns an HTML string, so the trip pages
  // (app.js) and the together pages (together.js) render buttons, chips, menus and sheets the same way. ----
  const $ = (s) => document.querySelector(s);
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  // Message for a failed Cloud Function call: the function's own (Chinese) message, a clear one when the App Check
  // security check failed (the SDK then waits a day before retrying), else the fallback.
  const fnError = (e, fallback) =>
    e?.code === "functions/unauthenticated" || /appCheck/i.test(String(e?.code || e?.message || ""))
      ? "這部手機未能通過安全驗證，地圖及 AI 功能暫時不能使用；請稍後再試，或用另一個瀏覽器。"
      : // the function's own (Chinese) message; a bare SDK code such as "internal" means the server could not be reached
        String(e?.code || "").startsWith("functions/") && e.message && !/^[a-z-]+$/.test(e.message)
        ? e.message.replace(/\s*\[\d+\]$/, "")
        : `${fallback}（伺服器未能處理請求）`;
  // A Google Maps link (share links and google.*/maps pages)
  const isMapsLink = (t) => /^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|(www\.)?google\.[a-z.]+\/maps|maps\.google\.[a-z.]+)\S*$/i.test(String(t ?? "").trim());
  // {"data-x": 1, hidden: true, title: null} → ' data-x="1" hidden' (null, undefined and false are left out).
  const attrs = (o = {}) =>
    Object.entries(o)
      .filter(([, v]) => v != null && v !== false)
      .map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${esc(v)}"`))
      .join("");

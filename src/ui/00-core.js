  // ---- Kit: the site's shared UI building blocks. Every helper returns an HTML string, so the trip pages
  // (app.js) and the together pages (together.js) render buttons, chips, menus and sheets the same way. ----
  const $ = (s) => document.querySelector(s);
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  // {"data-x": 1, hidden: true, title: null} → ' data-x="1" hidden' (null, undefined and false are left out).
  const attrs = (o = {}) =>
    Object.entries(o)
      .filter(([, v]) => v != null && v !== false)
      .map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${esc(v)}"`))
      .join("");

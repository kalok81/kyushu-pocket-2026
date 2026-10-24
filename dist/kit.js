"use strict";
// Shared UI building blocks (icons, buttons, chips, menus, sheets, undo bar) used by app.js and together.js.
// Generated from src/ui/*.js by scripts/build.mjs — edit those files, not this one.
window.Kit = (() => {
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
  // ---- Icons: one line-icon set for the whole site (paths from Lucide, ISC licence, 24×24, 2px stroke) ----
  const ICONS = {
    home: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    calendar: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
    compass: '<circle cx="12" cy="12" r="10"/><path d="m16.24 7.76-2.12 6.36-6.36 2.12 2.12-6.36 6.36-2.12z"/>',
    bag: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    menu: '<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/>',
    grip: '<circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/>',
    route: '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>',
    more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    pin: '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
    nav: '<polygon points="3 11 22 2 13 21 11 13 3 11"/>',
    star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    plane: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
    bed: '<path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v9"/>',
    locate: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3"/><path d="M12 19v3"/><path d="M2 12h3"/><path d="M19 12h3"/>',
    book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
    share: '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="m16 6-4-4-4 4"/><path d="M12 2v13"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
    suitcase: '<rect width="20" height="14" x="2" y="7" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
    camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
    image: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    edit: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    up: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
    down: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
    map: '<path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z"/><path d="M15 5.764v15"/><path d="M9 3.236v15"/>',
    printer: '<path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6"/><rect x="6" y="14" width="12" height="8" rx="1"/>',
    clip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
    list: '<path d="M3 12h.01"/><path d="M3 18h.01"/><path d="M3 6h.01"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M8 6h13"/>',
    grid: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
    ticket: '<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2"/><path d="M13 17v2"/><path d="M13 11v2"/>',
    note: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/>',
    sparkles: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>',
    wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
    checklist: '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    train: '<rect width="16" height="16" x="4" y="3" rx="2"/><path d="M4 11h16"/><path d="M12 3v8"/><path d="m8 19-2 3"/><path d="m18 22-2-3"/><path d="M8 15h.01"/><path d="M16 15h.01"/>',
    copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
    redo: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
    tag: '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
  };
  // An icon as inline SVG; decorative unless a label is given.
  const icon = (name, label = "") =>
    `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"${label ? ` role="img" aria-label="${esc(label)}"` : ' aria-hidden="true"'}>${ICONS[name] || ""}</svg>`;
  // ---- Components. Labels are HTML: escape user text with esc() before passing it in. ----
  // Button or link. variant: primary (one main action per page or form), secondary (soft), outline (default),
  // ghost (no border), danger. size "sm" for actions inside cards. href makes a link; external opens a new tab.
  function btn(label, o = {}) {
    const cls = ["btn", `btn-${o.variant || "outline"}`, o.size === "sm" && "btn-sm", o.iconOnly && "btn-icon", o.cls]
        .filter(Boolean)
        .join(" "),
      a = { ...o.attrs },
      inner = `${o.icon ? icon(o.icon) : ""}${o.iconOnly ? "" : `<span>${label}</span>`}${o.external && !o.iconOnly ? icon("external") : ""}`;
    if (o.iconOnly) a["aria-label"] ??= label;
    if (o.href)
      return `<a class="${cls}" href="${esc(o.href)}"${o.external ? ' target="_blank" rel="noopener noreferrer"' : ""}${attrs(a)}>${inner}</a>`;
    return `<button type="${o.type || "button"}" class="${cls}"${attrs(a)}>${inner}</button>`;
  }
  // A row of toggle chips: items are {label, active, attrs}.
  const chips = (items, o = {}) =>
    `<div class="chips${o.cls ? " " + o.cls : ""}" role="group"${o.label ? ` aria-label="${esc(o.label)}"` : ""}>${items
      .filter(Boolean)
      .map(
        (i) =>
          `<button type="button" class="chip${i.active ? " active" : ""}" aria-pressed="${!!i.active}"${attrs(i.attrs)}>${i.icon ? icon(i.icon) : ""}${i.label}</button>`,
      )
      .join("")}</div>`;
  // Page title: short and functional; aside holds the page's own small actions.
  const pageHead = (title, o = {}) =>
    `<header class="page-head"><div><h1>${title}</h1>${o.sub ? `<p>${o.sub}</p>` : ""}</div>${o.aside || ""}</header>`;
  const sectionHead = (title, aside = "") => `<div class="sectionhead"><h2>${title}</h2>${aside}</div>`;
  const empty = (title, text = "", action = "") =>
    `<div class="empty"><h2>${title}</h2>${text ? `<p>${text}</p>` : ""}${action}</div>`;
  const badge = (label, cls = "") => `<span class="badge${cls ? " " + cls : ""}">${label}</span>`;
  // "⋯" menu for an item's less frequent actions (edit, delete…). items: {label, icon, attrs, href, danger}.
  function menu(items, o = {}) {
    const list = items.filter(Boolean);
    if (!list.length) return "";
    return `<details class="more${o.cls ? " " + o.cls : ""}"><summary class="btn btn-ghost btn-icon btn-sm" aria-label="${esc(o.label || "更多操作")}"${attrs(o.attrs)}>${icon("more")}</summary><div class="menu" role="menu">${list
      .map((i) =>
        i.href
          ? `<a class="menu-item" role="menuitem" href="${esc(i.href)}"${i.external ? ' target="_blank" rel="noopener noreferrer"' : ""}${attrs(i.attrs)}>${i.icon ? icon(i.icon) : ""}<span>${i.label}</span></a>`
          : `<button type="button" class="menu-item${i.danger ? " danger" : ""}" role="menuitem"${attrs(i.attrs)}${i.disabled ? " disabled" : ""}>${i.icon ? icon(i.icon) : ""}<span>${i.label}</span></button>`,
      )
      .join("")}</div></details>`;
  }
  // The page's main "add" action, floating above the bottom navigation.
  const fab = (label, a = {}, ic = "plus") =>
    `<button type="button" class="fab"${attrs(a)}>${icon(ic)}<span>${esc(label)}</span></button>`;
  // Heading of a sheet (the #detail dialog).
  const sheetHead = (title, eyebrow = "") =>
    `${eyebrow ? `<div class="eyebrow">${eyebrow}</div>` : ""}<h2 class="detailtitle">${title}</h2>`;
  // ---- Sheets, menus and the undo bar ----
  // Sheet: the one #detail dialog (a bottom sheet on phones) shows forms and details.
  function open(html) {
    $("#detailBody").innerHTML = html;
    if (!$("#detail").open) $("#detail").showModal();
  }
  function close() {
    if ($("#detail").open) $("#detail").close();
  }
  // Menus: one open at a time, placed under (or above) their button so cards with hidden overflow never clip them;
  // a choice, a tap elsewhere or Escape closes them. They follow their button when the page scrolls.
  const closeMenus = (keep) =>
    document.querySelectorAll("details.more[open]").forEach((d) => d !== keep && d.removeAttribute("open"));
  function placeMenu(d) {
    const m = d.querySelector(".menu"),
      r = d.querySelector("summary").getBoundingClientRect(),
      w = m.offsetWidth,
      h = m.offsetHeight;
    m.style.left = `${Math.max(8, Math.min(r.right - w, innerWidth - w - 8))}px`;
    m.style.top = `${r.bottom + 4 + h > innerHeight - 8 ? Math.max(8, r.top - h - 4) : r.bottom + 4}px`;
  }
  document.addEventListener(
    "toggle",
    (e) => {
      const d = e.target;
      if (!d.classList?.contains("more") || !d.open) return;
      closeMenus(d);
      placeMenu(d);
    },
    true,
  );
  const placeOpen = () => document.querySelectorAll("details.more[open]").forEach(placeMenu);
  addEventListener("scroll", placeOpen, { passive: true, capture: true });
  addEventListener("resize", placeOpen);
  document.addEventListener("click", (e) => {
    const inMenu = e.target.closest?.("details.more");
    if (e.target.closest?.(".menu-item")) setTimeout(() => closeMenus());
    else closeMenus(inMenu);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMenus();
  });
  // Undo bar: shows text and an action for a few seconds. Resolves true when the action is pressed, false when it
  // times out, another bar replaces it or the page is closed (so a pending delete still goes through).
  let snackDone = null;
  function snack(text, { action = "", ms = 5000 } = {}) {
    snackDone?.(false);
    return new Promise((resolve) => {
      const el = $("#toast");
      let timer;
      const done = (v) => {
        if (snackDone !== done) return;
        snackDone = null;
        clearTimeout(timer);
        el.classList.remove("show", "snack");
        resolve(v);
      };
      snackDone = done;
      el.innerHTML = `<span>${esc(text)}</span>${action ? `<button type="button" class="snack-action">${icon("undo")}${esc(action)}</button>` : ""}`;
      el.classList.add("show", "snack");
      el.querySelector(".snack-action")?.addEventListener("click", () => done(true));
      timer = setTimeout(() => done(false), ms);
    });
  }
  addEventListener("pagehide", () => snackDone?.(false));
  // ---- Clear buttons: every text field in a form gets an × that empties it ----
  // Fields are wrapped as they appear (pages and sheets are rendered as HTML), and the × shows only while the field
  // has text (CSS :placeholder-shown, so values filled in by the AI count too).
  const CLEARABLE =
    'form input:not([type]),form input[type=text],form input[type=url],form input[type=number],form input[type=email],form input[type=tel],form textarea';
  function addClear(el) {
    if (el.closest(".field, .tg-line-row, [data-no-clear], [data-tg-form=login]") || el.readOnly) return;
    const wrap = document.createElement("span");
    wrap.className = `field${el.tagName === "TEXTAREA" ? " field-area" : ""}`;
    if (!el.hasAttribute("placeholder")) el.setAttribute("placeholder", " ");
    el.replaceWith(wrap);
    wrap.append(el);
    wrap.insertAdjacentHTML("beforeend", `<button type="button" class="field-clear" tabindex="-1" aria-label="清除">${icon("x")}</button>`);
  }
  const wrapAll = (root) => root.querySelectorAll?.(CLEARABLE).forEach(addClear);
  new MutationObserver((list) => {
    for (const m of list) for (const n of m.addedNodes) if (n.nodeType === 1) n.matches?.(CLEARABLE) ? addClear(n) : wrapAll(n);
  }).observe(document.body, { childList: true, subtree: true });
  wrapAll(document.body);
  document.addEventListener("click", (e) => {
    const b = e.target.closest(".field-clear");
    if (!b) return;
    const el = b.parentElement.querySelector("input,textarea");
    el.value = "";
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.focus();
  });
  // ---- Progress bars for AI analyses and map lookups ----
  // The AI does not report progress, so the bar moves by time: fast at first, slowing towards 92% over the usual
  // duration, and jumps to 100% when the answer arrives. Background jobs pass their start time, so a bar picks up
  // where it was after the page is drawn again.
  const progress = ({ text = "", seconds = 15, since = Date.now() } = {}) => {
    const spent = Math.max(0, (Date.now() - since) / 1000),
      from = Math.min(90, (spent / seconds) * 92),
      rest = Math.max(1, seconds - spent);
    return `<div class="ai-progress" role="progressbar" aria-label="${esc(text || "處理中")}" aria-valuemin="0" aria-valuemax="100"><div class="ai-progress-bar"><i style="--from:${from.toFixed(1)}%;--rest:${rest.toFixed(1)}s"></i></div>${text ? `<span>${esc(text)}</span>` : ""}</div>`;
  };
  // A bar placed just before el (e.g. a form's note line) until the returned function is called.
  function busy(el, opts = {}) {
    if (!el) return () => {};
    el.previousElementSibling?.classList.contains("ai-progress") && el.previousElementSibling.remove();
    el.insertAdjacentHTML("beforebegin", progress(opts));
    const bar = el.previousElementSibling;
    return () => {
      bar.classList.add("done");
      setTimeout(() => bar.remove(), 400);
    };
  }
  return Object.freeze({ esc, attrs, icon, btn, chips, pageHead, sectionHead, empty, badge, menu, fab, sheetHead, open, close, closeMenus, snack, progress, busy });
})();

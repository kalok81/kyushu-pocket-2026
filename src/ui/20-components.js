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
  // A file picker that looks like btn: a label around a hidden file input (o.accept, o.capture, o.multiple, o.input attrs).
  function fileBtn(label, o = {}) {
    const cls = ["btn", `btn-${o.variant || "outline"}`, o.size === "sm" && "btn-sm", o.cls].filter(Boolean).join(" ");
    return `<label class="${cls}"${attrs(o.attrs)}>${o.icon ? icon(o.icon) : ""}<span>${label}</span><input type="file" accept="${esc(o.accept || "image/*")}" class="sr-only"${attrs({ capture: o.capture, multiple: o.multiple, ...o.input })}></label>`;
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
    `<header class="page-head"><div><h1>${title}</h1>${o.sub ? `<p>${o.sub}</p>` : ""}</div>${o.aside ? `<div class="page-head-aside">${o.aside}</div>` : ""}</header>`;
  const sectionHead = (title, aside = "") => `<div class="sectionhead"><h2>${title}</h2>${aside}</div>`;
  const empty = (title, text = "", action = "") =>
    `<div class="empty"><h2>${title}</h2>${text ? `<p>${text}</p>` : ""}${action}</div>`;
  // A short wait: three swelling dots, with an optional text beside them; loading is the same as a page's empty state.
  const dots = (text = "") => `<span class="dots" role="status"><b aria-hidden="true"><i></i><i></i><i></i></b>${text ? `<span>${text}</span>` : '<span class="sr-only">載入中</span>'}</span>`;
  const loading = (title, text = "") => `<div class="empty loading">${dots()}<h2>${title}</h2>${text ? `<p>${text}</p>` : ""}</div>`;
  // An on/off option (o.name, o.checked, o.attrs on the input) as a switch with its label in front.
  const toggle = (label, o = {}) =>
    `<label class="switch-row"><span>${label}</span><input type="checkbox" class="switch" role="switch"${attrs({ name: o.name, checked: o.checked, ...o.attrs })}></label>`;
  const badge = (label, cls = "") => `<span class="badge${cls ? " " + cls : ""}">${label}</span>`;
  // Card: the one surface for list items (住宿, 活動, 資料簿…). top: the small line above the title (date, badges, ⋯ menu);
  // title and body are HTML; links: the row of small buttons at the bottom.
  const card = (o = {}) =>
    `<article class="card${o.cls ? " " + o.cls : ""}"${attrs(o.attrs)}>${o.top ? `<div class="card-top">${o.top}</div>` : ""}${o.title ? `<h3>${o.title}</h3>` : ""}${o.body || ""}${o.links ? `<div class="links">${o.links}</div>` : ""}</article>`;
  // List row (inside a .list): lead (icon or D1), title and sub line, trail (chevron, button). href makes it a link,
  // otherwise a button when attrs are given, else a plain row.
  function row(o = {}) {
    const inner = `${o.lead ?? ""}<span class="list-main"><b>${o.title}</b>${o.sub ? `<small>${o.sub}</small>` : ""}</span>${o.trail ?? ""}`,
      cls = `list-row${o.cls ? " " + o.cls : ""}`;
    if (o.href) return `<a class="${cls}" href="${esc(o.href)}"${attrs(o.attrs)}>${inner}</a>`;
    if (o.attrs) return `<button type="button" class="${cls}"${attrs(o.attrs)}>${inner}</button>`;
    return `<div class="${cls}">${inner}</div>`;
  }
  // Fold: a section that opens in place (更多資料, 修改旅程資料…), the same chevron everywhere.
  const fold = (summary, body, o = {}) =>
    `<details class="fold${o.cls ? " " + o.cls : ""}"${o.open ? " open" : ""}${attrs(o.attrs)}><summary>${summary}</summary>${body}</details>`;
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
  const fab = (label, { class: cls, ...a } = {}, ic = "plus") =>
    `<button type="button" class="fab${cls ? " " + cls : ""}"${attrs(a)}>${icon(ic)}<span>${esc(label)}</span></button>`;
  // Heading of a sheet (the #detail dialog).
  const sheetHead = (title, eyebrow = "") =>
    `${eyebrow ? `<div class="eyebrow">${eyebrow}</div>` : ""}<h2 class="detailtitle">${title}</h2>`;

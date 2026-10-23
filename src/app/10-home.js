  // ---- 總覽 (home): the trip at a glance, today's stops, shortcuts and every day ----
  const todayIso = () => {
    const n = new Date();
    return `${n.getFullYear()}/${String(n.getMonth() + 1).padStart(2, "0")}/${String(n.getDate()).padStart(2, "0")}`;
  };
  function renderHome() {
    const hs = lists().hotels,
      first = days[0],
      last = days.at(-1),
      iso = todayIso(),
      now = days.find((d) => d.iso === iso),
      until = first ? Math.round((Date.parse(first.iso) - Date.parse(iso)) / 864e5) : 0;
    const when = now
      ? `今天是第 ${now.n} 天`
      : !first
        ? ""
        : until > 0
          ? `還有 ${until} 天出發`
          : "旅程已完結";
    const todayStops = now ? stopsFor(now.n) : [];
    const today = now
      ? `${Kit.sectionHead(`今天 · ${esc(now.region)}`, Kit.btn("全日行程", { href: `#plan?day=${now.n}`, size: "sm", icon: "calendar" }))}<div class="panel today-list">${
          todayStops.length
            ? todayStops
                .map((s) => `<a class="today-row" href="#plan?day=${now.n}"><time>${esc(s.time || "—")}</time><span>${esc(s.title)}</span></a>`)
                .join("")
            : '<p class="note">這天還沒有安排。</p>'
        }</div>`
      : "";
    const tile = (href, ic, title, sub) => `<a class="quick" href="${href}">${icon(ic)}<span><b>${title}</b><small>${sub}</small></span></a>`;
    return `<section class="hero trip-card"><div class="eyebrow">${esc(meta.destination || "我們的旅程")}</div><h1>${esc(meta.name || "我們的旅程")}</h1>${
      first
        ? `<p class="trip-dates">${esc(first.iso.replaceAll("/", "."))} – ${esc(last.iso.slice(5).replace("/", "."))} · ${days.length} 天</p>`
        : ""
    }${when ? `<p class="trip-when">${when}</p>` : ""}${Kit.btn(now ? "今天的行程" : "打開行程", { href: `#plan?day=${now ? now.n : 1}`, variant: "primary", icon: "calendar", cls: "herobtn" })}</section>${today}<div class="quicklinks">${tile("#flights", "plane", "機票", `${lists().flights.length} 個航班`)}${tile("#hotels", "bed", "住宿", `${hs.length} 間`)}${tile("#nearby", "locate", "附近", "定位找地點")}${tile("#notebook", "book", "資料簿", "搜尋全部")}</div>${Kit.sectionHead("旅程一覽")}<div class="panel">${days
      .map(
        (d) =>
          `<a class="dayrow${now && d.n === now.n ? " today" : ""}" href="#plan?day=${d.n}"><span class="daynum">D${d.n}</span><div><strong>${esc(d.region)}</strong><small>${esc(d.date)} · ${esc(d.weekday)}${d.hotel ? ` · ${esc(d.hotel)}` : ""}</small></div>${icon("chevron")}</a>`,
      )
      .join("")}</div>`;
  }

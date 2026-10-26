  // ---- 總覽 (home): the trip in one line, today's stops, shortcuts and the 資料簿 search ----
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
      ? `${Kit.sectionHead(`今天 · ${esc(now.region)}`, Kit.btn("全日行程", { href: `#plan?day=${now.n}`, size: "sm", icon: "calendar" }))}<div class="list today-list">${
          todayStops.length
            ? todayStops
                .map((s) => Kit.row({ href: `#plan?day=${now.n}`, lead: `<time>${esc(s.time || "—")}</time>`, title: esc(s.title), cls: "today-row" }))
                .join("")
            : '<p class="note">這天還沒有安排。</p>'
        }</div>`
      : "";
    const tile = (href, ic, title, sub) => `<a class="quick" href="${href}">${icon(ic)}<span><b>${title}</b><small>${sub}</small></span></a>`;
    const info = [meta.destination, first && Kit.dateRange(first.iso, last.iso, { weekday: false }), first && `${days.length} 天`, when].filter(Boolean);
    return `<section class="trip-card trip-bar"><div class="trip-line"><h1>${esc(meta.name || "我們的旅程")}</h1><span>${info.map(esc).join(" · ")}</span></div></section>${today}<div class="quicklinks">${tile(`#plan?day=${now ? now.n : 1}`, "calendar", "行程", now ? `今天 D${now.n}` : `${days.length} 天`)}${tile("#flights", "plane", "機票", `${lists().flights.length} 個航班`)}${tile("#hotels", "bed", "住宿", `${hs.length} 間`)}${tile("#events", "ticket", "活動", `${lists().events?.length || 0} 個`)}${tile("#nearby", "locate", "附近", "定位找地點")}</div>${Kit.sectionHead("資料簿")}${notebookBody()}`;
  }

  // ---- 行程: the day page (day tabs, heading, 方案, timeline) ----
  // Consecutive stops with the same (non-empty) time are alternatives for one slot, shown side by side.
  const stopGroups = (stops) =>
    stops.reduce((gs, s, i) => {
      const g = gs[gs.length - 1];
      if (g && s.time && g[0].s.time === s.time) g.push({ s, i });
      else gs.push([{ s, i }]);
      return gs;
    }, []);
  function stopCard(s, i, label, last) {
    const placeOk = s.placeId && places.some((p) => p.id === s.placeId);
    return `<div class="card stopcontent"><div class="card-top stop-top"><span class="eyebrow">${label} / ${esc(s.area)}</span>${Kit.menu(
      [
        { label: "修改", icon: "edit", attrs: { "data-stop-edit": i } },
        { label: "移去其他日子", icon: "calendar", attrs: { "data-stop-to-day": i } },
        { label: "上移", icon: "up", disabled: !i, attrs: { "data-stop-move": `${i}:-1` } },
        { label: "下移", icon: "down", disabled: i >= last, attrs: { "data-stop-move": `${i}:1` } },
        { label: "刪除", icon: "trash", danger: true, attrs: { "data-stop-delete": i } },
      ],
      { label: `編輯「${s.title}」`, attrs: { "data-stop-more": i } },
    )}</div><h3>${esc(s.title)}${zhLine(placeOk ? places.find((p) => p.id === s.placeId).zh : "")}</h3>${s.warn ? `<p class="stop-warn">${icon("clock")}<span>${esc(s.warn)}</span></p>` : ""}${s.note ? `<p class="stop-note">${icon("note")}<span>${esc(s.note)}</span></p>` : ""}${s.detail ? `<p>${esc(s.detail)}</p>` : ""}${buyLine(buysAt({ placeId: s.placeId, title: s.hotelId ? "" : s.title }))}<div class="links">${placeOk ? Kit.btn("地點資料", { size: "sm", attrs: { "data-place": s.placeId } }) : ""}${s.hotelId ? Kit.btn("住宿資料", { size: "sm", href: "#hotels" }) : ""}${s.target ? link(route(s.target), "導航") : ""}${urlList(s.ref)
      .map((u) => link(u, "參考網站"))
      .join("")}</div></div>`;
  }
  function renderPlanDay(day) {
    const d = days[day - 1],
      edit = planEdits[day],
      stops = stopsFor(day),
      last = stops.length - 1,
      first = stops[0],
      startHotel = first && !first.hotelId ? dayStartHotel(day) : null;
    return `<div class="dayintro"><div><div class="eyebrow">${esc(d.date)}</div><h2>${esc(d.region)}</h2><p class="weather" data-weather="${day}" hidden></p><p class="day-hotel">${icon("bed")}<span>住宿：${d.hotel ? `<a href="#hotels">${esc(d.hotel)}</a>` : "未設定"}</span></p></div>${Kit.menu(
      [
        { label: "修改這天標題", icon: "edit", attrs: { "data-day-label": true } },
        { label: "新增方案（複製這個）", icon: "copy", attrs: { "data-plan-variant-new": true } },
        variantsOf(day).length && { label: "方案改名", icon: "edit", attrs: { "data-plan-variant-rename": true } },
        viewedVariant(day) && { label: "設為主要方案", icon: "check", attrs: { "data-plan-variant-main": true } },
        viewedVariant(day) && { label: "刪除這個方案", icon: "trash", danger: true, attrs: { "data-plan-variant-del": true } },
        { label: "與另一日對調", icon: "calendar", attrs: { "data-day-swap": true } },
        routeStops(day).length && { label: "當天路線地圖", icon: "map", attrs: { "data-day-map": true } },
        { label: "列印／另存 PDF", icon: "printer", attrs: { "data-plan-print": true } },
        (viewedVariant(day) ? stops.length : edit?.stops?.length) && { label: viewedVariant(day) ? "清空這個方案" : "清空這天", icon: "trash", danger: true, attrs: { "data-plan-reset": true } },
      ],
      { label: "這天的更多操作", cls: "day-more" },
    )}</div>${variantChips(day)}${stops.length ? planTools(stops) : ""}${nowFor(day)}${first?.transport && !startHotel ? `<p class="transport">${icon("train")}<span>${esc(first.transport)}</span></p>` : ""}<div class="timeline">${startHotel ? startStop(startHotel) : ""}${
      stopGroups(stops)
        .map(
          (g, n, all) =>
            `${n || startHotel ? stopLink(all, n, startHotel) : ""}<article class="stop${g.length > 1 ? " stop-group" : ""}" data-group="${n}"><div class="time">${esc(g[0].s.time)}${g.length > 1 ? `<small class="alt-count">${g.length} 個選擇</small>` : ""}${Kit.btn(`在 ${esc(g[0].s.time || "這個時段")} 加入另一個選擇`, { size: "sm", variant: "ghost", icon: "plus", iconOnly: true, cls: "alt-add", attrs: { "data-stop-alt": g[g.length - 1].i } })}${all.length > 1 ? `<button type="button" class="stop-grip" aria-label="拖動調整「${esc(g[0].s.title)}」的次序">${icon("grip")}</button>` : ""}</div><div class="stop-alts">${g
              .map(({ s, i }, k) => stopCard(s, i, `${String(n + 1).padStart(2, "0")}${g.length > 1 ? String.fromCharCode(97 + k) : ""}`, last))
              .join("")}</div></article>`,
        )
        .join("") || Kit.empty("這天還沒有行程", "按右下角「＋地點」，從探索、住宿或購物選擇，或新增地點。")
    }</div><section class="tg-slot" data-tg-day="${day}"></section><div class="fab-row">${Kit.fab("地點", { "data-plan-pick": true, "aria-label": "加入地點" })}${Kit.fab("筆記", { "data-tg": "dayNote", "data-note-day": day, "aria-label": "寫筆記" })}</div>`;
  }
  function renderPlan() {
    const tab = (d) => {
      return `<button class="daytab ${d.n === selectedDay ? "active" : ""}" data-day="${d.n}" aria-pressed="${d.n === selectedDay}" aria-label="第 ${d.n} 天 ${esc(d.date)} ${esc(d.region)}"><b>D${d.n}</b><span>${d.md} ${d.weekday.slice(-1)}</span><small class="weather-tab" data-weather-tab="${d.n}"></small></button>`;
    };
    return `<h1 class="sr-only">每日行程</h1><div class="daytabs" aria-label="選擇行程日期">${days.map(tab).join("")}</div><article class="journey-day" aria-label="第${selectedDay}天行程">${renderPlanDay(selectedDay)}</article>`;
  }

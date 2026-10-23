  // ---- 行程 (plan): day stops, the stop form and the in-page place picker ----
  // Each day's plan lives in Firestore planDays/{day}: the stop list and the day's title.
  let planEdits = {};
  // A stop for an explore place or a hotel shows that place's current name, area, details and address, so editing the
  // place in 探索 (or the hotel in 住宿) updates every stop; the copy saved in the stop is only a fallback.
  function resolveStop(s) {
    const p = s.placeId && places.find((x) => x.id === s.placeId);
    if (p)
      return {
        ...s,
        title: p.v[1],
        area: areaOf(p) || p.v[0],
        detail: p.v[4],
        target: `${p.v[1]} ${p.v[3]}`.trim(),
        ref: urlList(p.v[10])[0] || "",
        linked: "place",
      };
    const h = s.hotelId && lists().hotels.find((x) => x.id === s.hotelId);
    if (h)
      return {
        ...s,
        title: h.name,
        area: "住宿",
        detail: h.address || "",
        target: `${h.name} ${h.address || ""}`.trim(),
        ...(Number.isFinite(h.lat) ? { lat: h.lat, lng: h.lng } : {}),
        linked: "hotel",
      };
    return s;
  }
  const stopsFor = (day) => (planEdits[day]?.stops || []).map(resolveStop);
  const stopFields = (s) => ({
    time: String(s.time || "").slice(0, 30),
    area: String(s.area || "").slice(0, 60),
    title: String(s.title || "").slice(0, 80),
    detail: String(s.detail || "").slice(0, 1000),
    transport: String(s.transport || "").slice(0, 500),
    ref: String(s.ref || "").slice(0, 500),
    target: String(s.target || "").slice(0, 200),
    placeId: String(s.placeId || "").slice(0, 40),
    ...(s.hotelId ? { hotelId: String(s.hotelId).slice(0, 40) } : {}),
    ...(Number.isFinite(s.lat) && Number.isFinite(s.lng) ? { lat: s.lat, lng: s.lng } : {}),
  });
  const startMinute = (t) => {
    const m = String(t).match(/(\d{1,2}):(\d{2})/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  function insertByTime(list, stop) {
    const t = startMinute(stop.time);
    if (t == null) return [...list, stop];
    const i = list.findIndex((s) => {
      const u = startMinute(s.time);
      return u != null && u > t;
    });
    return i < 0 ? [...list, stop] : [...list.slice(0, i), stop, ...list.slice(i)];
  }
  function savePlan(day, stops) {
    planEdits = { ...planEdits, [day]: { ...planEdits[day], stops } };
    window.Together.savePlanDay(day, stops.map(stopFields));
    if (current === "plan") refreshPlan();
  }
  function applyPlanEdits(map) {
    planEdits = map;
    refreshDays();
    if (current === "plan") refreshPlan();
    else if (current === "notebook" && $("#notebookResults")) notebookResults();
  }
  function refreshPlan() {
    const j = $(".journey-day");
    if (j) {
      j.innerHTML = renderPlanDay(selectedDay);
      window.Together?.refresh();
      paintWeather();
    }
  }
  // Editing a stop: time and transport always; the place itself is edited in 探索 / 住宿 when the stop is linked to one.
  function stopForm(day, index) {
    const s = stopsFor(day)[index] || {},
      v = (k) => esc(s[k] || ""),
      own = !s.linked;
    openDialog(
      `${Kit.sheetHead("修改站點", `D${day} · ${esc(days[day - 1].date)}`)}<form class="tg-form" id="stopForm" data-day="${day}" data-index="${index}">${own ? `<label>Google 地圖連結<span class="searchrow"><input name="mapsUrl" class="search" inputmode="url" autocomplete="off" placeholder="貼上 Google 地圖分享連結">${Kit.btn("自動填寫", { variant: "secondary", icon: "sparkles", attrs: { id: "stopLookup" } })}</span></label><p class="note" id="stopLookupInfo">在 Google 地圖按「分享」→ 複製連結，貼上後按「自動填寫」。只會填入空白欄位。</p>` : `<div class="notice">「${esc(s.title)}」的名稱、地址及介紹跟隨${s.linked === "place" ? "探索地點" : "住宿資料"}，修改後所有行程會一併更新。<div class="links">${s.linked === "place" ? Kit.btn("修改地點資料", { size: "sm", icon: "edit", attrs: { "data-place-edit": s.placeId } }) : Kit.btn("修改住宿資料", { size: "sm", icon: "edit", attrs: { "data-hotel-edit": s.hotelId } })}</div></div>`}<div class="tg-row"><label>時間<input name="time" maxlength="30" placeholder="例如：14:00–15:30" value="${v("time")}"></label>${own ? `<label>區域<input name="area" maxlength="60" value="${v("area")}"></label>` : ""}</div>${own ? `<label>地點／活動<input name="title" required maxlength="80" value="${v("title")}"></label><label>內容<textarea name="detail" rows="3" maxlength="1000">${v("detail")}</textarea></label>` : ""}<label>交通<textarea name="transport" rows="2" maxlength="500">${v("transport")}</textarea></label>${own ? `<label>導航目的地（可留空）<input name="target" maxlength="200" value="${v("target")}"></label>` : ""}${Kit.btn("儲存修改", { type: "submit", variant: "primary", cls: "btn-block" })}</form>`,
    );
  }
  // Sub-area name for a coordinate (same centres as the explore filter), else the nearest place's region.
  function areaAt(pt) {
    const a = areas.map((x) => ({ x, d: window.Nearby.distance(pt, x) })).sort((p, q) => p.d - q.d)[0];
    if (a && a.d <= 6000) return a.x.name;
    const near = places
      .map((p) => ({
        p,
        d: Math.min(...(window.TRIP_GEO.places[p.id] || []).map((g) => window.Nearby.distance(pt, g)), Infinity),
      }))
      .sort((p, q) => p.d - q.d)[0];
    return near && near.d < 8000 ? near.p.v[0] : "";
  }
  async function lookupStopForm() {
    const f = $("#stopForm"),
      btn = $("#stopLookup"),
      info = $("#stopLookupInfo"),
      el = f.elements,
      url = el.mapsUrl.value.trim();
    if (!url) return toast("請先貼上 Google 地圖連結。");
    btn.disabled = true;
    info.textContent = "正在查詢 Google 地圖…";
    const done = Kit.busy(info, { seconds: 5 });
    try {
      const r = await window.Together.lookupPlace(url),
        put = (name, value) => {
          if (value && !el[name].value.trim()) el[name].value = value;
        };
      put("title", r.name);
      put("target", [r.name, r.address].filter(Boolean).join(" "));
      put("detail", [r.type, r.price && "價格：" + r.price, r.hours && "營業時間：\n" + r.hours].filter(Boolean).join("\n"));
      if (Number.isFinite(r.lat) && Number.isFinite(r.lng)) put("area", areaAt({ lat: r.lat, lng: r.lng }));
      f.dataset.ref = r.website || r.mapsUrl || "";
      info.textContent = "已填入，請檢查後按儲存。";
    } catch (e) {
      info.textContent =
        fnError(e, "未能自動填寫，請手動輸入。");
      console.error(e);
    } finally {
      done();
      btn.disabled = false;
    }
  }
  function saveStopForm(f) {
    const day = Number(f.dataset.day),
      index = Number(f.dataset.index),
      v = new FormData(f),
      get = (k) => String(v.get(k) || "").trim(),
      list = [...stopsFor(day)],
      old = list[index];
    if (!old) return;
    const stop = { ...old, time: get("time"), transport: get("transport") };
    if (!old.linked) {
      if (!get("title")) return;
      Object.assign(stop, { area: get("area"), title: get("title"), detail: get("detail"), target: get("target") });
      if (f.dataset.ref && !stop.ref) stop.ref = f.dataset.ref;
    }
    list[index] = stop;
    savePlan(day, list);
    $("#detail").close();
    toast("已儲存");
  }
  function addPlaceToPlan(p) {
    const today = days.find((d) => d.iso === new Date().toLocaleDateString("en-CA").replaceAll("-", "/"))?.n,
      sel = current === "plan" ? selectedDay : today || selectedDay;
    openDialog(
      `${Kit.sheetHead(`把「${esc(p.v[1])}」加入行程`)}<form class="tg-form" id="placeToPlan" data-place="${esc(p.id)}"><label>日子<select name="day">${days.map((d) => `<option value="${d.n}"${d.n === sel ? " selected" : ""}>D${d.n} ${esc(d.date)} ${esc(d.region)}</option>`).join("")}</select></label><label>時間（可留空，留空會放在最後）<input name="time" maxlength="30" placeholder="例如：12:00–13:00"></label>${Kit.btn("加入行程", { type: "submit", variant: "primary", cls: "btn-block" })}</form>`,
    );
  }
  // In-page picker: search explore places and add them to the selected day without leaving the plan.
  let ppCat = "全部";
  // A hotel entered on 住宿 as a plan stop (navigation by its name and address).
  const hotelStop = (h, time) => ({
    time,
    area: "住宿",
    title: h.name,
    detail: h.address || "",
    transport: "",
    ref: "",
    target: `${h.name} ${h.address || ""}`.trim(),
    hotelId: h.id,
    ...(Number.isFinite(h.lat) ? { lat: h.lat, lng: h.lng } : {}),
  });
  const placeStop = (p, time) => ({
    time,
    area: areaOf(p) || p.v[0],
    title: p.v[1],
    detail: p.v[4],
    transport: "",
    ref: urlList(p.v[10])[0] || "",
    target: `${p.v[1]} ${p.v[3]}`.trim(),
    placeId: p.id,
  });
  function pickPlaceForPlan(day, slot = null) {
    ppCat = "全部";
    const s = slot != null ? stopsFor(day)[slot] : null;
    openDialog(
      `${Kit.sheetHead(s ? "加入同一時間的選擇" : "加入地點", `D${day}`)}<p class="note">${s ? `與「${esc(s.title)}」同在 ${esc(s.time || "這個時段")}` : `${esc(days[day - 1].date)} · ${esc(days[day - 1].region)}`}</p>${s ? Kit.btn("自己輸入", { icon: "edit", attrs: { "data-stop-own": slot } }) : Kit.btn("新增地點（不在探索）", { icon: "plus", attrs: { "data-stop-new": true } })}<div class="tg-form plan-pick"><input id="ppSearch" class="search" type="search" placeholder="搜尋地點、區域、特色…" aria-label="搜尋地點">${Kit.chips(
        ["全部", ...(lists().hotels.length ? ["住宿"] : []), ...(window.Together?.shoppingPlaces?.().length ? ["購物清單"] : []), ...exploreCats].map((c) => ({ label: c, active: c === ppCat, attrs: { "data-pp-cat": c } })),
        { label: "分類" },
      )}${s ? "" : '<label>時間（可留空，留空會放在最後）<input id="ppTime" maxlength="30" placeholder="例如：12:00–13:00"></label>'}</div><div id="ppList" class="pp-list" data-day="${day}" data-slot="${slot ?? ""}"></div>`,
    );
    ppResults();
  }
  const addBtn = (attrs) => Kit.btn("加入", { variant: "secondary", size: "sm", icon: "plus", attrs });
  function ppResults() {
    const box = $("#ppList");
    if (!box) return;
    const day = Number(box.dataset.day),
      q = ($("#ppSearch")?.value || "").trim().toLocaleLowerCase(),
      inPlan = new Set(
        stopsFor(day)
          .map((s) => s.placeId)
          .filter(Boolean),
      );
    const hs =
        ["全部", "住宿"].includes(ppCat)
          ? [...lists().hotels]
              .filter((h) => !q || `${h.name} ${h.address}`.toLocaleLowerCase().includes(q))
              .sort((a, b) => String(a.checkIn).localeCompare(String(b.checkIn)))
          : [],
      hotelIn = stopsFor(day).reduce((m, s) => (s.hotelId ? m.set(s.hotelId, (m.get(s.hotelId) || 0) + 1) : m), new Map());
    const ps = ["住宿", "購物清單"].includes(ppCat)
      ? []
      : places
          .filter(
            (p) =>
              (ppCat === "全部" || p.cats.includes(ppCat) || (ppCat === "商店" && giftShop(p))) &&
              (!q || [p.v[1], p.v[0], areaOf(p), p.v[4], p.v[2]].join(" ").toLocaleLowerCase().includes(q)),
          )
          .sort((a, b) => saved.has(b.id) - saved.has(a.id));
    const hotelRows = hs
      .map(
        (h) =>
          `<div class="pp-row"><div><b>${icon("bed")} ${esc(h.name)}</b><small>${h.checkIn ? `${esc(h.checkIn.slice(5))} → ${esc((h.checkOut || "").slice(5))}` : "住宿"}${h.address ? ` · ${esc(h.address.slice(0, 40))}` : ""}</small></div>${hotelIn.get(h.id) ? Kit.badge(`✓ ${hotelIn.get(h.id)} 次`) : ""}${addBtn({ "data-pp-hotel": h.id })}</div>`,
      )
      .join("");
    // 購物清單: where unbought list items are bought (explore places, or the item's own geocoded 購買地點).
    ppSpots =
      ppCat === "購物清單"
        ? (window.Together?.shoppingPlaces?.() || []).filter(
            (s) => !q || `${s.name} ${s.address} ${s.items.join(" ")}`.toLocaleLowerCase().includes(q),
          )
        : [];
    const spotRows = ppSpots
      .map(
        (s, k) =>
          `<div class="pp-row"><div><b>${icon("bag")} ${esc(s.name)}</b><small>要買：${s.items.map(esc).join("、")}</small></div>${s.placeId && inPlan.has(s.placeId) ? Kit.badge("✓ 已加入") : addBtn({ "data-pp-spot": k })}</div>`,
      )
      .join("");
    box.innerHTML = hotelRows + spotRows + (ps.length || hotelRows || spotRows ? "" : '<p class="note">找不到符合的地點。</p>');
    if (!ps.length) return;
    box.insertAdjacentHTML(
      "beforeend",
      `${ps
        .slice(0, 40)
        .map(
          (p) =>
            `<div class="pp-row"><div><b>${saved.has(p.id) ? "★ " : ""}${esc(p.v[1])}</b><small>${esc(areaOf(p) || p.v[0])}${p.v[4] ? ` · ${esc(p.v[4].slice(0, 40))}` : ""}</small></div>${inPlan.has(p.id) ? Kit.badge("✓ 已加入") : addBtn({ "data-pp-add": p.id })}</div>`,
        )
        .join("")}${ps.length > 40 ? `<p class="note">還有 ${ps.length - 40} 個，請輸入更多字縮窄搜尋。</p>` : ""}`,
    );
  }
  let ppSpots = [];
  // A shopping spot without an explore place becomes its own stop at the item's 購買地點.
  const spotStop = (s, time) => ({
    time,
    area: (Number.isFinite(s.lat) && areaAt(s)) || "購物",
    title: s.name,
    detail: "",
    transport: "",
    ref: "",
    target: s.address || s.name,
    ...(Number.isFinite(s.lat) ? { lat: s.lat, lng: s.lng } : {}),
  });
  function addPickedPlace(id, hotel = false, spot = null) {
    const box = $("#ppList"),
      p = spot || (hotel ? lists().hotels.find((x) => x.id === id) : places.find((x) => x.id === id));
    if (!box || !p) return;
    const day = Number(box.dataset.day),
      list = stopsFor(day),
      make = (t) => (spot ? spotStop(p, t) : hotel ? hotelStop(p, t) : placeStop(p, t));
    if (box.dataset.slot !== "") {
      const at = slotEnd(list, Number(box.dataset.slot));
      savePlan(day, [...list.slice(0, at + 1), make(list[at].time), ...list.slice(at + 1)]);
    } else savePlan(day, insertByTime(list, make(($("#ppTime")?.value || "").trim())));
    toast(`已加入 D${day}：${spot || hotel ? p.name : p.v[1]}`);
    ppResults();
  }
  // Last index of the slot (same-time run) containing stop i, so new alternatives go to the end of that slot.
  const slotEnd = (list, i) => {
    let j = i;
    while (list[j + 1] && list[i].time && list[j + 1].time === list[i].time) j++;
    return j;
  };
  document.addEventListener("input", (e) => {
    if (e.target.id === "ppSearch") ppResults();
  });
  function savePlaceToPlan(f) {
    const p = places.find((x) => x.id === f.dataset.place);
    if (!p) return;
    const v = new FormData(f),
      day = Number(v.get("day")),
      stop = placeStop(p, String(v.get("time") || "").trim());
    savePlan(day, insertByTime(stopsFor(day), stop));
    $("#detail").close();
    toast(`已加入 D${day} 行程`);
  }
  document.addEventListener("submit", (e) => {
    if (e.target.id === "stopForm") {
      e.preventDefault();
      saveStopForm(e.target);
    }
    if (e.target.id === "placeToPlan") {
      e.preventDefault();
      savePlaceToPlan(e.target);
    }
  });
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
    return `<div class="stopcontent"><div class="stop-top"><span class="eyebrow">${label} / ${esc(s.area)}</span>${Kit.menu(
      [
        { label: "修改", icon: "edit", attrs: { "data-stop-edit": i } },
        { label: "加入同一時間的選擇", icon: "plus", attrs: { "data-stop-alt": i } },
        { label: "上移", icon: "up", disabled: !i, attrs: { "data-stop-move": `${i}:-1` } },
        { label: "下移", icon: "down", disabled: i >= last, attrs: { "data-stop-move": `${i}:1` } },
        { label: "刪除", icon: "trash", danger: true, attrs: { "data-stop-delete": i } },
      ],
      { label: `編輯「${s.title}」`, attrs: { "data-stop-more": i } },
    )}</div><h3>${esc(s.title)}${zhLine(placeOk ? places.find((p) => p.id === s.placeId).zh : "")}</h3>${s.detail ? `<p>${esc(s.detail)}</p>` : ""}${buyLine(buysAt({ placeId: s.placeId, title: s.hotelId ? "" : s.title }))}<div class="links">${placeOk ? Kit.btn("地點資料", { size: "sm", attrs: { "data-place": s.placeId } }) : ""}${s.hotelId ? Kit.btn("住宿資料", { size: "sm", href: "#hotels" }) : ""}${s.target ? link(route(s.target), "導航") : ""}${urlList(s.ref)
      .map((u) => link(u, "參考網站"))
      .join("")}</div></div>`;
  }
  function renderPlanDay(day) {
    const d = days[day - 1],
      edit = planEdits[day],
      stops = stopsFor(day),
      last = stops.length - 1,
      first = stops[0];
    return `<div class="dayintro"><div><div class="eyebrow">${esc(d.date)} · ${esc(d.weekday)}</div><h2>${esc(d.region)}</h2><p class="weather" data-weather="${day}" hidden></p><p class="day-hotel">${icon("bed")}<span>住宿：${d.hotel ? `<a href="#hotels">${esc(d.hotel)}</a>` : "未設定"}</span></p></div>${Kit.menu(
      [
        { label: "修改這天標題", icon: "edit", attrs: { "data-day-label": true } },
        routeStops(day).length && { label: "當天路線地圖", icon: "map", attrs: { "data-day-map": true } },
        { label: "列印／另存 PDF", icon: "printer", attrs: { "data-plan-print": true } },
        edit?.stops?.length && { label: "清空這天", icon: "trash", danger: true, attrs: { "data-plan-reset": true } },
      ],
      { label: "這天的更多操作", cls: "day-more" },
    )}</div>${first && !hotelLink() && first.transport ? `<p class="transport">${icon("train")}<span>${esc(first.transport)}</span></p>` : ""}<div class="timeline">${
      stopGroups(stops)
        .map(
          (g, n, all) =>
            `${n || hotelLink() ? stopLink(all, n) : ""}<article class="stop${g.length > 1 ? " stop-group" : ""}"><div class="time">${esc(g[0].s.time)}${g.length > 1 ? `<small class="alt-count">${g.length} 個選擇</small>` : ""}</div><div class="stop-alts">${g
              .map(({ s, i }, k) => stopCard(s, i, `${String(n + 1).padStart(2, "0")}${g.length > 1 ? String.fromCharCode(97 + k) : ""}`, last))
              .join("")}</div></article>`,
        )
        .join("") || Kit.empty("這天還沒有行程", "按右下角「加入地點」，從探索、住宿或購物清單選擇，或新增地點。")
    }</div><section class="tg-slot" data-tg-day="${day}"></section>${Kit.fab("加入地點", { "data-plan-pick": true })}`;
  }
  function renderPlan() {
    const tab = (d) => {
      const [dd, mm] = d.date.split("/");
      return `<button class="daytab ${d.n === selectedDay ? "active" : ""}" data-day="${d.n}" aria-pressed="${d.n === selectedDay}" aria-label="第 ${d.n} 天 ${esc(d.date)} ${esc(d.region)}"><b>D${d.n}</b><span>${dd}/${mm} ${d.weekday.slice(-1)}</span><small class="weather-tab" data-weather-tab="${d.n}"></small></button>`;
    };
    return `<h1 class="sr-only">每日行程</h1><div class="daytabs" aria-label="選擇行程日期">${days.map(tab).join("")}</div><article class="journey-day" aria-label="第${selectedDay}天行程">${renderPlanDay(selectedDay)}</article>`;
  }

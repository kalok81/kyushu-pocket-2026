  // ---- 行程 (plan): day stops, the stop form and the in-page place picker ----
  // Each day's plan lives in Firestore planDays/{day}: the stop list and the day's title.
  let planEdits = {},
    openStop = null;
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
      `<div class="eyebrow">${esc(days[day - 1].date)} · DAY ${day}</div><h2 class="detailtitle">修改站點</h2><form class="tg-form" id="stopForm" data-day="${day}" data-index="${index}">${own ? `<label>Google 地圖連結<span class="searchrow"><input name="mapsUrl" class="search" inputmode="url" autocomplete="off" placeholder="貼上 Google 地圖分享連結"><button type="button" class="action primary" id="stopLookup">自動填寫</button></span></label><p class="note" id="stopLookupInfo">在 Google 地圖按「分享」→ 複製連結，貼上後按「自動填寫」。只會填入空白欄位。</p>` : `<div class="notice">「${esc(s.title)}」的名稱、地址及介紹跟隨${s.linked === "place" ? "探索地點" : "住宿資料"}，修改後所有行程會一併更新。<div class="links">${s.linked === "place" ? `<button type="button" class="action" data-place-edit="${esc(s.placeId)}">✎ 修改地點資料</button>` : `<button type="button" class="action" data-hotel-edit="${esc(s.hotelId)}">✎ 修改住宿資料</button>`}</div></div>`}<div class="tg-row"><label>時間<input name="time" maxlength="30" placeholder="例如：14:00–15:30" value="${v("time")}"></label>${own ? `<label>區域<input name="area" maxlength="60" value="${v("area")}"></label>` : ""}</div>${own ? `<label>地點／活動<input name="title" required maxlength="80" value="${v("title")}"></label><label>內容<textarea name="detail" rows="3" maxlength="1000">${v("detail")}</textarea></label>` : ""}<label>交通<textarea name="transport" rows="2" maxlength="500">${v("transport")}</textarea></label>${own ? `<label>導航目的地（可留空）<input name="target" maxlength="200" value="${v("target")}"></label>` : ""}<button type="submit" class="locate-button">儲存修改</button></form>`,
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
        String(e?.code || "").startsWith("functions/") && e.message
          ? e.message.replace(/\s*\[\d+\]$/, "")
          : "未能自動填寫，請手動輸入。";
      console.error(e);
    } finally {
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
      `<div class="eyebrow">ADD TO PLAN</div><h2 class="detailtitle">把「${esc(p.v[1])}」加入行程</h2><form class="tg-form" id="placeToPlan" data-place="${esc(p.id)}"><label>日子<select name="day">${days.map((d) => `<option value="${d.n}"${d.n === sel ? " selected" : ""}>D${d.n} ${esc(d.date)} ${esc(d.region)}</option>`).join("")}</select></label><label>時間（可留空，留空會放在最後）<input name="time" maxlength="30" placeholder="例如：12:00–13:00"></label><button type="submit" class="locate-button">加入行程</button></form>`,
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
      `<div class="eyebrow">ADD TO DAY ${day}</div><h2 class="detailtitle">${s ? "加入同一時間的選擇" : "從探索加入地點"}</h2><p class="note">${s ? `與「${esc(s.title)}」同在 ${esc(s.time || "這個時段")}` : `${esc(days[day - 1].date)} · ${esc(days[day - 1].region)}`}</p>${s ? `<button class="action" data-stop-own="${slot}">✎ 自己輸入</button>` : ""}<div class="tg-form plan-pick"><input id="ppSearch" class="search" type="search" placeholder="搜尋地點、區域、特色…" aria-label="搜尋地點"><div class="chips" role="group" aria-label="分類">${["全部", ...(lists().hotels.length ? ["住宿"] : []), ...(window.Together?.shoppingPlaces?.().length ? ["購物清單"] : []), ...exploreCats].map((c) => `<button class="chip ${c === ppCat ? "active" : ""}" data-pp-cat="${c}">${c}</button>`).join("")}</div>${s ? "" : '<label>時間（可留空，留空會放在最後）<input id="ppTime" maxlength="30" placeholder="例如：12:00–13:00"></label>'}</div><div id="ppList" class="pp-list" data-day="${day}" data-slot="${slot ?? ""}"></div>`,
    );
    ppResults();
  }
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
          `<div class="pp-row"><div><b>🏨 ${esc(h.name)}</b><small>${h.checkIn ? `${esc(h.checkIn.slice(5))} → ${esc((h.checkOut || "").slice(5))}` : "住宿"}${h.address ? ` · ${esc(h.address.slice(0, 40))}` : ""}</small></div>${hotelIn.get(h.id) ? `<span class="badge">✓ ${hotelIn.get(h.id)} 次</span>` : ""}<button class="action primary" data-pp-hotel="${esc(h.id)}">＋ 加入</button></div>`,
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
          `<div class="pp-row"><div><b>🛍 ${esc(s.name)}</b><small>要買：${s.items.map(esc).join("、")}</small></div>${s.placeId && inPlan.has(s.placeId) ? '<span class="badge">✓ 已加入</span>' : `<button class="action primary" data-pp-spot="${k}">＋ 加入</button>`}</div>`,
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
            `<div class="pp-row"><div><b>${saved.has(p.id) ? "★ " : ""}${esc(p.v[1])}</b><small>${esc(areaOf(p) || p.v[0])}${p.v[4] ? ` · ${esc(p.v[4].slice(0, 40))}` : ""}</small></div>${inPlan.has(p.id) ? '<span class="badge">✓ 已加入</span>' : `<button class="action primary" data-pp-add="${esc(p.id)}">＋ 加入</button>`}</div>`,
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
  function renderPlanDay(day) {
    const d = days[day - 1],
      edit = planEdits[day],
      stops = stopsFor(day),
      last = stops.length - 1;
    return `<div class="dayintro"><div><div class="eyebrow">${esc(d.date)} · ${esc(d.weekday)}</div><h2>${esc(d.region)}</h2><p class="weather" data-weather="${day}" hidden></p></div><div class="links"><button class="action" data-day-label>✎ 這天標題</button><a href="#hotels" class="action">查看酒店 ↗</a></div></div><div class="notice">${edit?.stops?.length ? "旅伴安排的行程，修改即時同步。" : "這天還未安排，按「＋ 新增站點」或「⌕ 從探索加入地點」。"}<br>住宿：${esc(d.hotel || "未設定")}</div><div class="plan-tools"><button class="action primary" data-stop-new>＋ 新增站點</button><button class="action" data-plan-pick>⌕ 從探索加入地點</button>${routeStops(day).length ? '<button class="action" data-day-map>🗺 當天路線</button>' : ""}<button class="action" data-plan-print>🖨 列印／PDF</button>${edit?.stops?.length ? '<button class="action" data-plan-reset>清空這天</button>' : ""}</div><div class="timeline">${
      stopGroups(stops)
        .map(
          (g, n, all) =>
            `${n || hotelLink() ? stopLink(all, n) : ""}<article class="stop${g.length > 1 ? " stop-group" : ""}"><div class="time">${esc(g[0].s.time)}${g.length > 1 ? `<small class="alt-count">${g.length} 個選擇</small>` : ""}</div><div class="stop-alts">${g
              .map(
                ({ s, i }, k) =>
                  `<div class="stopcontent"><button class="stop-more${openStop === i ? " active" : ""}" data-stop-more="${i}" aria-label="編輯這個站點" aria-expanded="${openStop === i}">⋯</button><span class="eyebrow">${String(n + 1).padStart(2, "0")}${g.length > 1 ? String.fromCharCode(97 + k) : ""} / ${esc(s.area)}</span><h3>${esc(s.title)}</h3><p>${esc(s.detail)}</p>${buyLine(buysAt({ placeId: s.placeId, title: s.hotelId ? "" : s.title }))}${n === 0 && !hotelLink() && s.transport ? `<p class="transport">↳ ${esc(s.transport)}</p>` : ""}<div class="links">${s.placeId && places.some((p) => p.id === s.placeId) ? `<button class="action" data-place="${esc(s.placeId)}">地點資料</button>` : ""}${s.hotelId ? '<a class="action" href="#hotels">住宿資料</a>' : ""}${s.target ? link(route(s.target), "導航") : ""}${urlList(
                    s.ref,
                  )
                    .map((u) => link(u, "參考網站"))
                    .join(
                      "",
                    )}</div>${openStop === i ? `<div class="stop-edit"><button class="smallbtn" data-stop-move="${i}:-1"${i ? "" : " disabled"} aria-label="上移">↑</button><button class="smallbtn" data-stop-move="${i}:1"${i < last ? "" : " disabled"} aria-label="下移">↓</button><button class="smallbtn" data-stop-edit="${i}">✎ 修改</button><button class="smallbtn" data-stop-delete="${i}">刪除</button><button class="smallbtn" data-stop-alt="${i}">＋ 加入</button></div>` : ""}</div>`,
              )
              .join("")}</div></article>`,
        )
        .join("") || '<div class="empty"><h2>這天還沒有行程</h2><p>按「＋ 新增站點」或「⌕ 從探索加入地點」。</p></div>'
    }</div><section class="tg-slot" data-tg-day="${day}"></section>`;
  }
  function renderPlan() {
    return `${header("DAY BY DAY", "跟著酒店，順路出發。", "選擇日期查看當天行程")}<div class="daytabs" aria-label="選擇行程日期">${days.map((d) => `<button class="daytab ${d.n === selectedDay ? "active" : ""}" data-day="${d.n}" aria-pressed="${d.n === selectedDay}"><b>DAY ${d.n}</b><span>${esc(d.date)} · ${esc(d.weekday)}</span><em class="day-region" title="${esc(d.region)}">${esc(d.region)}</em><small class="weather-tab" data-weather-tab="${d.n}"></small></button>`).join("")}</div><article class="journey-day" aria-label="第${selectedDay}天行程">${renderPlanDay(selectedDay)}</article>`;
  }

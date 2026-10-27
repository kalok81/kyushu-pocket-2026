  // ---- 行程: the 加入地點 picker (explore places, hotels, shopping spots, AI 推薦) ----
  // In-page picker: search explore places and add them to the selected day without leaving the plan.
  let ppCat = "全部",
    ppArea = "";
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
  // at: insert before this stop index (the ＋ between two stops); later picks follow the previous one.
  function pickPlaceForPlan(day, slot = null, at = null) {
    ppCat = "全部";
    ppArea = "";
    ppAi = null;
    const s = slot != null ? stopsFor(day)[slot] : null,
      before = at != null ? stopsFor(day)[at] : null;
    openDialog(
      `${Kit.sheetHead(s ? "加入同一時間的選擇" : "加入地點", `D${day}`)}<p class="note pp-where">${s ? `與「${esc(s.title)}」同在 ${esc(s.time || "這個時段")}` : before ? `加在「${esc(before.title)}」之前` : `${esc(days[day - 1].date)} · ${esc(days[day - 1].region)}`}</p><div class="tg-form plan-pick"><div class="pp-bar"><input id="ppSearch" class="search" type="search" placeholder="搜尋地點、特色…" aria-label="搜尋地點">${s ? Kit.btn("自己輸入", { size: "sm", icon: "edit", attrs: { "data-stop-own": slot } }) : Kit.btn("新增", { size: "sm", icon: "plus", attrs: { "data-stop-new": true, "aria-label": "新增地點" } })}${Kit.btn("發掘", { size: "sm", icon: "sparkles", attrs: { "data-discover": day, "aria-label": "發掘新地點" } })}</div>${Kit.chips(
        ["全部", ...(saved.size ? ["★ 收藏"] : []), "✨ AI 推薦", ...(lists().hotels.length ? ["住宿"] : []), ...(window.Together?.shoppingPlaces?.().length ? ["購物"] : []), ...exploreCats].map((c) => ({ label: c, active: c === ppCat, attrs: { "data-pp-cat": c } })),
        { label: "分類" },
      )}<label class="pp-time">區域<select id="ppArea"><option value="">全部區域</option>${[...new Set(places.map((p) => p.v[0]).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, "zh-Hant"))
        .map((r) => `<option value="${esc(r)}">${esc(r)}</option>`)
        .join("")}</select></label>${s || before ? "" : '<label class="pp-time">時間<input id="ppTime" maxlength="30" placeholder="可留空，例如 12:00–13:00"></label>'}</div><div id="ppList" class="list pp-list" data-day="${day}" data-slot="${slot ?? ""}" data-at="${at ?? ""}" title="收藏的地點排先，其餘按與這天站點的距離排列"></div>`,
    );
    ppResults();
  }
  const addBtn = (attrs) => Kit.btn("加入", { variant: "secondary", size: "sm", icon: "plus", attrs });
  // Distance from a place to the day: the nearest stop already planned, else the day's area or hotel.
  function dayDistance(day) {
    const pts = stopsFor(day)
      .map((s) => stopPoint(s))
      .filter((p) => p && Number.isFinite(p.lat));
    if (!pts.length) pts.push(dayPoint(day));
    return (p) => {
      const g = window.TRIP_GEO.places[p.id] || [];
      const d = Math.min(...g.flatMap((x) => pts.filter(Boolean).map((q) => window.Nearby.distance(x, q))), Infinity);
      return d;
    };
  }
  // 交通 places (stations, airports…) can be in a day more than once: going out and coming back
  const pickState = (inPlan) => ({
    planned: (p) => inPlan.has(p.id) && !p.cats.includes("交通"),
    againNote: (p) => (inPlan.has(p.id) && p.cats.includes("交通") ? '<small class="pp-reason">已在這天行程，可再加入</small>' : ""),
  });
  const kmText = (d) => (Number.isFinite(d) ? (d < 1000 ? ` · ${Math.round(d / 10) * 10} 米` : ` · ${(d / 1000).toFixed(1)} 公里`) : "");
  // ✨ AI 推薦: up to 6 explore places that fit the day (planDay suggest), with the reason.
  let ppAi = null;
  async function ppSuggest(box, day) {
    const dist = dayDistance(day),
      inPlan = new Set(stopsFor(day).map((s) => s.placeId)),
      d = days[day - 1];
    const cands = places
      .filter((p) => !inPlan.has(p.id) && !p.v[9]?.includes("已閉店"))
      .map((p) => ({ p, d: dist(p) - (saved.has(p.id) ? 3000 : 0) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 40);
    if (!cands.length) return (box.innerHTML = '<p class="note">探索沒有可以推薦的地點。</p>');
    box.innerHTML = Kit.progress({ text: "AI 正在按這天的行程、距離及營業時間挑選…", seconds: 15 });
    try {
      const r = await window.Together.planDay({
        mode: "suggest",
        date: isoDash(d),
        weekday: d.weekday,
        region: d.region,
        currency: meta.currency || "JPY",
        stops: stopsFor(day).map((s, i) => ({ k: String(i), name: s.title, time: s.time, type: placeOf(s)?.v[2] || "" })),
        candidates: cands.map(({ p }) => ({ k: p.id, name: p.v[1], area: areaOf(p) || p.v[0], type: p.v[2], note: String(p.v[4] || "").slice(0, 120), hours: String(p.v[5] || "").slice(0, 200), saved: saved.has(p.id), km: Number.isFinite(dist(p)) ? dist(p) / 1000 : null })),
      });
      ppAi = { day, picks: r.picks.filter((x) => places.some((p) => p.id === x.k)), advice: r.advice };
    } catch (e) {
      console.error(e);
      ppAi = { day, picks: [], error: fnError(e, "AI 未能推薦，請稍後再試。") };
    }
    if (ppCat === "✨ AI 推薦") ppResults();
  }
  function ppResults() {
    const box = $("#ppList");
    if (!box) return;
    if (ppCat === "✨ AI 推薦") {
      const day = Number(box.dataset.day);
      if (!ppAi || ppAi.day !== day) return ppSuggest(box, day);
      const inPlan = new Set(stopsFor(day).map((s) => s.placeId)),
        { planned, againNote } = pickState(inPlan),
        dist = dayDistance(day);
      box.innerHTML = ppAi.error
        ? `<p class="note">${esc(ppAi.error)}</p>`
        : `${ppAi.advice ? `<p class="note">${icon("sparkles")} ${esc(ppAi.advice)}</p>` : ""}${ppAi.picks
            .map(({ k, reason }) => {
              const p = places.find((x) => x.id === k);
              return `<div class="list-row pp-row"><div><b>${saved.has(p.id) ? "★ " : ""}${esc(p.v[1])}${zhLine(p.zh)}</b><small>${esc(areaOf(p) || p.v[0])}${kmText(dist(p))}</small>${reason ? `<small class="pp-reason">${esc(reason)}</small>` : ""}${againNote(p)}</div>${planned(p) ? Kit.badge("✓ 已加入") : addBtn({ "data-pp-add": p.id })}</div>`;
            })
            .join("") || '<p class="note">AI 沒有合適的推薦。</p>'}`;
      box.insertAdjacentHTML("beforeend", Kit.btn("再推薦一次", { size: "sm", icon: "redo", attrs: { "data-pp-ai-again": true } }));
      return;
    }
    const day = Number(box.dataset.day),
      q = ($("#ppSearch")?.value || "").trim().toLocaleLowerCase(),
      inPlan = new Set(
        stopsFor(day)
          .map((s) => s.placeId)
          .filter(Boolean),
      ),
      { planned, againNote } = pickState(inPlan);
    const hs =
        (ppCat === "全部" && !q ? false : ["全部", "住宿"].includes(ppCat))
          ? [...lists().hotels]
              .filter((h) => !q || `${h.name} ${h.address}`.toLocaleLowerCase().includes(q))
              .sort((a, b) => String(a.checkIn).localeCompare(String(b.checkIn)))
          : [],
      hotelIn = stopsFor(day).reduce((m, s) => (s.hotelId ? m.set(s.hotelId, (m.get(s.hotelId) || 0) + 1) : m), new Map());
    const dist = dayDistance(day),
      far = new Map(places.map((p) => [p.id, dist(p)]));
    const ps = ["住宿", "購物"].includes(ppCat)
      ? []
      : places
          .filter(
            (p) =>
              (ppCat === "全部" || (ppCat === "★ 收藏" && saved.has(p.id)) || p.cats.includes(ppCat) || (ppCat === "商店" && giftShop(p))) &&
              (!ppArea || p.v[0] === ppArea) &&
              (!q || [p.v[1], p.v[0], areaOf(p), p.v[4], p.v[2], p.zh].join(" ").toLocaleLowerCase().includes(q)),
          )
          .sort((a, b) => saved.has(b.id) - saved.has(a.id) || far.get(a.id) - far.get(b.id));
    const hotelRows = hs
      .map(
        (h) =>
          `<div class="list-row pp-row"><div><b>${icon("bed")} ${esc(h.name)}</b><small>${h.checkIn ? esc(Kit.dateRange(h.checkIn, h.checkOut)) : "住宿"}${h.address ? ` · ${esc(h.address.slice(0, 40))}` : ""}</small></div>${hotelIn.get(h.id) ? Kit.badge(`✓ ${hotelIn.get(h.id)} 次`) : ""}${addBtn({ "data-pp-hotel": h.id })}</div>`,
      )
      .join("");
    // 購物清單: where unbought list items are bought (explore places, or the item's own geocoded 購買地點).
    ppSpots =
      ppCat === "購物"
        ? (window.Together?.shoppingPlaces?.() || []).filter(
            (s) => !q || `${s.name} ${s.address} ${s.items.join(" ")}`.toLocaleLowerCase().includes(q),
          )
        : [];
    const spotRows = ppSpots
      .map(
        (s, k) =>
          `<div class="list-row pp-row"><div><b>${icon("bag")} ${esc(s.name)}</b><small>要買：${s.items.map(esc).join("、")}</small></div>${s.placeId && inPlan.has(s.placeId) ? Kit.badge("✓ 已加入") : addBtn({ "data-pp-spot": k })}</div>`,
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
            `<div class="list-row pp-row"><div><b>${saved.has(p.id) ? "★ " : ""}${esc(p.v[1])}${zhLine(p.zh)}</b><small>${esc(areaOf(p) || p.v[0])}${kmText(far.get(p.id))}${p.v[2] ? ` · ${esc(p.v[2])}` : ""}</small>${againNote(p)}</div>${planned(p) ? Kit.badge("✓ 已加入") : addBtn({ "data-pp-add": p.id })}</div>`,
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
    } else if (box.dataset.at !== "") {
      // Between two stops: the stop after it now comes from somewhere else, so its transport is cleared.
      const at = Number(box.dataset.at);
      savePlan(day, legsChanged(list, [...list.slice(0, at), make(""), ...list.slice(at)]));
      box.dataset.at = at + 1;
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
    if (e.target.id === "ppArea") {
      ppArea = e.target.value;
      ppResults();
    }
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

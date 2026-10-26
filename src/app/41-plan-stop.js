  // ---- 行程: the stop form and adding an explore place to a day ----
  // Editing a stop: time and transport always; the place itself is edited in 探索 / 住宿 when the stop is linked to one.
  function stopForm(day, index) {
    const s = stopsFor(day)[index] || {},
      v = (k) => esc(s[k] || ""),
      own = !s.linked;
    openDialog(
      `${Kit.sheetHead("修改站點", `D${day} · ${esc(days[day - 1].date)}`)}<form class="tg-form" id="stopForm" data-day="${day}" data-index="${index}">${own ? `<label>Google 地圖連結<span class="searchrow"><input name="mapsUrl" class="search" inputmode="url" autocomplete="off" placeholder="貼上 Google 地圖分享連結">${Kit.btn("自動填寫", { variant: "secondary", icon: "sparkles", attrs: { id: "stopLookup" } })}</span></label><p class="note" id="stopLookupInfo">在 Google 地圖按「分享」→ 複製連結，貼上後按「自動填寫」。只會填入空白欄位。</p>` : `<div class="notice">「${esc(s.title)}」的名稱、地址及介紹跟隨${s.linked === "place" ? "探索地點" : "住宿資料"}，修改後所有行程會一併更新。<div class="links">${s.linked === "place" ? Kit.btn("修改地點資料", { size: "sm", icon: "edit", attrs: { "data-place-edit": s.placeId } }) : Kit.btn("修改住宿資料", { size: "sm", icon: "edit", attrs: { "data-hotel-edit": s.hotelId } })}</div></div>`}<div class="tg-row"><label>時間<input name="time" maxlength="30" placeholder="例如：14:00–15:30" value="${v("time")}"></label>${own ? `<label>區域<input name="area" maxlength="60" value="${v("area")}"></label>` : ""}</div>${own ? `<label>地點／活動<input name="title" required maxlength="80" value="${v("title")}"></label><label>內容<textarea name="detail" rows="3" maxlength="1000">${v("detail")}</textarea></label>` : ""}<label>備註（這一站的提示，例如要預約、只收現金）<textarea name="note" rows="2" maxlength="500">${v("note")}</textarea></label><label>交通<textarea name="transport" rows="2" maxlength="500">${v("transport")}</textarea></label>${own ? `<label>導航目的地（可留空）<input name="target" maxlength="200" value="${v("target")}"></label>` : ""}${Kit.btn("儲存修改", { type: "submit", variant: "primary", cls: "btn-block" })}</form>`,
    );
  }
  // Sub-area name for a coordinate (same centres as the explore filter), else the nearest place's region.
  function areaAt(pt) {
    const a = areas.map((x) => ({ x, d: window.Nearby.distance(pt, x) })).sort((p, q) => p.d - q.d)[0];
    if (a && a.d <= 6000) return a.x.name;
    const near = nearestPlace(pt);
    return near && near.d < 8000 ? near.p.v[0] : "";
  }
  function lookupStopForm() {
    const f = $("#stopForm");
    return mapsAutofill(f, {
      btn: $("#stopLookup"),
      info: $("#stopLookupInfo"),
      fill: (r, put) => {
        put("title", r.name);
        put("target", [r.name, r.address].filter(Boolean).join(" "));
        put("detail", [r.type, r.price && "價格：" + r.price, r.hours && "營業時間：\n" + r.hours].filter(Boolean).join("\n"));
        if (Number.isFinite(r.lat) && Number.isFinite(r.lng)) put("area", areaAt({ lat: r.lat, lng: r.lng }));
        f.dataset.ref = r.website || r.mapsUrl || "";
      },
    });
  }
  function saveStopForm(f) {
    const day = Number(f.dataset.day),
      index = Number(f.dataset.index),
      v = new FormData(f),
      get = (k) => String(v.get(k) || "").trim(),
      list = [...stopsFor(day)],
      old = list[index];
    if (!old) return;
    // a time typed here is the traveller's own: 推算時間 keeps its length
    const stop = { ...old, time: get("time"), transport: get("transport"), note: get("note"), manual: get("time") !== (old.time || "") ? !!get("time") : !!old.manual };
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

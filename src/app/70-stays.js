  // ---- 住宿 and 機票 (hotels and flights) ----
  function renderHotels() {
    const hs = [...lists().hotels].sort((a, b) => String(a.checkIn).localeCompare(String(b.checkIn)));
    return `${header("STAY & REST", "每一天，都有回去的地方。", "貼上 Google 地圖連結即可自動填寫酒店資料")}<div class="links"><button class="action primary" data-hotel-new>＋ 新增住宿</button></div>${hs.length ? `<div class="twocol">${hs.map((h) => `<article class="card hotel"><span class="hotelnum">${esc(h.checkIn || "?")} → ${esc(h.checkOut || "?")}</span><h2>${esc(h.name)}</h2>${nights(h) > 0 ? `<div class="badge">${nights(h)} 晚</div>` : ""}<dl class="kv">${h.address ? `<dt>地址</dt><dd>${esc(h.address)}</dd>` : ""}${h.note ? `<dt>備註</dt><dd>${esc(h.note)}</dd>` : ""}</dl><div class="links">${link(route(`${h.name} ${h.address}`.trim()), "導航")}${h.mapsUrl ? link(h.mapsUrl, "Google 地圖") : ""}<button class="smallbtn" data-docs="hotels:${esc(h.id)}">📎 文件${h.docs?.length ? `（${h.docs.length}）` : ""}</button><button class="smallbtn" data-hotel-edit="${esc(h.id)}">編輯</button><button class="smallbtn" data-hotel-del="${esc(h.id)}">刪除</button></div></article>`).join("")}</div>` : '<div class="empty"><h2>還沒有住宿</h2><p>按「＋ 新增住宿」，貼上酒店的 Google 地圖連結。</p></div>'}<div class="sectionhead"><h2>每晚住宿</h2></div><div class="panel">${days.map((d) => `<a class="dayrow" href="#plan?day=${d.n}"><span class="daynum">D${d.n}</span><div><strong>${esc(d.date)} · ${esc(d.region)}</strong><small>${esc(d.hotel || "未設定")}</small></div><span class="arrow">↗</span></a>`).join("")}</div>`;
  }
  function hotelForm(h) {
    const v = (k) => esc(h?.[k] ?? ""),
      first = days[0] ? isoDash(days[0]) : "",
      last = days.at(-1) ? isoDash(days.at(-1)) : "";
    openDialog(
      `<div class="eyebrow">STAY</div><h2 class="detailtitle">${h ? "修改住宿" : "新增住宿"}</h2><form class="tg-form" id="hotelForm" data-id="${h ? esc(h.id) : ""}"><label>Google 地圖連結<span class="searchrow"><input name="mapsUrl" class="search" inputmode="url" autocomplete="off" placeholder="貼上酒店的 Google 地圖分享連結" value="${v("mapsUrl")}"><button type="button" class="action primary" id="hotelLookup">自動填寫</button></span></label><p class="note" id="hotelLookupInfo"></p><label>酒店名稱<input name="name" required maxlength="100" value="${v("name")}"></label><label>地址<input name="address" maxlength="200" value="${v("address")}"></label><div class="tg-row"><label>入住<input name="checkIn" type="date" value="${h ? v("checkIn") : first}"></label><label>退房<input name="checkOut" type="date" value="${h ? v("checkOut") : last}"></label></div><label>備註（訂單、早餐、寄存行李…）<textarea name="note" rows="2" maxlength="500">${v("note")}</textarea></label><input type="hidden" name="lat" value="${h?.lat ?? ""}"><input type="hidden" name="lng" value="${h?.lng ?? ""}"><button type="submit" class="locate-button">${h ? "儲存修改" : "加入住宿"}</button></form>`,
    );
  }
  async function lookupHotel() {
    const f = $("#hotelForm"),
      el = f.elements,
      info = $("#hotelLookupInfo"),
      url = el.mapsUrl.value.trim();
    if (!url) return toast("請先貼上 Google 地圖連結。");
    info.textContent = "正在查詢 Google 地圖…";
    try {
      const r = await window.Together.lookupPlace(url);
      if (r.name) el.name.value = r.name;
      if (r.address) el.address.value = r.address;
      if (Number.isFinite(r.lat)) {
        el.lat.value = r.lat;
        el.lng.value = r.lng;
      }
      if (r.mapsUrl) el.mapsUrl.value = r.mapsUrl;
      info.textContent = "已填入，請檢查入住及退房日期。";
    } catch (e) {
      info.textContent =
        fnError(e, "未能自動填寫，請手動輸入。");
    }
  }
  function saveHotel(f) {
    const v = new FormData(f),
      g = (k) => String(v.get(k) || "").trim(),
      lat = parseFloat(v.get("lat")),
      lng = parseFloat(v.get("lng"));
    if (!g("name")) return;
    if (g("checkIn") && g("checkOut") && g("checkOut") < g("checkIn")) return toast("退房日期要在入住之後。");
    window.Together.saveItem("hotels", f.dataset.id || null, {
      name: g("name").slice(0, 100),
      address: g("address").slice(0, 200),
      checkIn: g("checkIn"),
      checkOut: g("checkOut"),
      mapsUrl: g("mapsUrl").slice(0, 500),
      note: g("note").slice(0, 500),
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
    });
    $("#detail").close();
  }
  function renderFlights() {
    const fs = [...lists().flights].sort((a, b) => String(a.depart).localeCompare(String(b.depart)));
    return `${header("FLIGHTS", "出發與回家，都準備好。", "航班時間為各地當地時間")}<div class="links"><button class="action primary" data-flight-new>＋ 新增航班</button></div>${fs.length ? `<div class="twocol">${fs.map((f) => `<article class="ticket"><div class="ticket-top"><b>${esc(f.depart ? f.depart.slice(0, 10) : "")}</b><span>${esc(f.airline)} · ${esc(f.flightNo)}</span></div><div class="flightpath"><div><strong>${esc(f.from)}</strong><b>${esc(f.depart ? f.depart.slice(11, 16) : "")}</b></div><div class="plane">✈</div><div><strong>${esc(f.to)}</strong><b>${esc(f.arrive ? f.arrive.slice(11, 16) : "")}</b><small>${f.arrive && f.depart && f.arrive.slice(0, 10) !== f.depart.slice(0, 10) ? esc(f.arrive.slice(0, 10)) : ""}</small></div></div><div class="ticket-bottom"><span>${esc(f.note)}</span><span><button class="smallbtn" data-docs="flights:${esc(f.id)}">📎 文件${f.docs?.length ? `（${f.docs.length}）` : ""}</button> <button class="smallbtn" data-flight-edit="${esc(f.id)}">編輯</button> <button class="smallbtn" data-flight-del="${esc(f.id)}">刪除</button></span></div></article>`).join("")}</div>` : '<div class="empty"><h2>還沒有航班</h2><p>按「＋ 新增航班」輸入航班號、出發及到達時間。</p></div>'}<p class="note">電子機票等文件可按「📎 文件」上載，只限旅伴登入查看。</p>`;
  }
  function flightForm(f) {
    const v = (k) => esc(f?.[k] ?? "");
    openDialog(
      `<div class="eyebrow">FLIGHT</div><h2 class="detailtitle">${f ? "修改航班" : "新增航班"}</h2><form class="tg-form" id="flightForm" data-id="${f ? esc(f.id) : ""}"><div class="tg-row"><label>航班號<input name="flightNo" required maxlength="20" placeholder="例如：CX 410" value="${v("flightNo")}"></label><label>航空公司<input name="airline" maxlength="60" value="${v("airline")}"></label></div><div class="tg-row"><label>出發地<input name="from" maxlength="80" placeholder="例如：HKG T1" value="${v("from")}"></label><label>目的地<input name="to" maxlength="80" placeholder="例如：ICN T1" value="${v("to")}"></label></div><div class="tg-row"><label>出發（當地時間）<input name="depart" type="datetime-local" value="${v("depart")}"></label><label>到達（當地時間）<input name="arrive" type="datetime-local" value="${v("arrive")}"></label></div><label>備註（行李限額等，不要輸入訂單資料）<input name="note" maxlength="500" value="${v("note")}"></label><button type="submit" class="locate-button">${f ? "儲存修改" : "加入航班"}</button></form>`,
    );
  }
  function saveFlight(f) {
    const v = new FormData(f),
      g = (k) => String(v.get(k) || "").trim();
    if (!g("flightNo")) return;
    window.Together.saveItem("flights", f.dataset.id || null, {
      flightNo: g("flightNo").slice(0, 20),
      airline: g("airline").slice(0, 60),
      from: g("from").slice(0, 80),
      to: g("to").slice(0, 80),
      depart: g("depart").slice(0, 20),
      arrive: g("arrive").slice(0, 20),
      note: g("note").slice(0, 500),
    });
    $("#detail").close();
  }
  document.addEventListener("submit", (e) => {
    if (e.target.id === "hotelForm") {
      e.preventDefault();
      saveHotel(e.target);
    }
    if (e.target.id === "flightForm") {
      e.preventDefault();
      saveFlight(e.target);
    }
  });

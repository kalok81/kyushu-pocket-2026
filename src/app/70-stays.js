  // ---- 住宿 and 機票 (hotels and flights) ----
  // Label and value pairs under a card's title (empty values are left out)
  const kv = (rows) => {
    const r = rows.filter(([, v]) => v);
    return r.length ? `<dl class="kv">${r.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}</dl>` : "";
  };
  const docsBtn = (k, x) => Kit.btn(`文件${x.docs?.length ? `（${x.docs.length}）` : ""}`, { size: "sm", icon: "clip", attrs: { "data-docs": `${k}:${x.id}` } }),
    itemMenu = (k, id) =>
      Kit.menu([
        { label: "編輯", icon: "edit", attrs: { [`data-${k}-edit`]: id } },
        { label: "刪除", icon: "trash", danger: true, attrs: { [`data-${k}-del`]: id } },
      ]);
  function renderHotels() {
    const hs = [...lists().hotels].sort((a, b) => String(a.checkIn).localeCompare(String(b.checkIn)));
    return `${header("住宿")}${hs.length ? `<div class="twocol">${hs.map((h) => Kit.card({ cls: "hotel", top: `<span class="card-date">${h.checkIn ? esc(Kit.dateRange(h.checkIn, h.checkOut)) : "日期未定"}${nights(h) > 0 ? ` · ${nights(h)} 晚` : ""}</span>${itemMenu("hotel", h.id)}`, title: esc(h.name), body: kv([["地址", h.address], ["備註", h.note]]), links: `${link(route(`${h.name} ${h.address}`.trim()), "導航")}${h.mapsUrl ? link(h.mapsUrl, "Google 地圖") : ""}${docsBtn("hotels", h)}` })).join("")}</div>` : Kit.empty("還沒有住宿", "按右下角「＋住宿」，貼上酒店的 Google 地圖連結即可自動填寫。")}${Kit.sectionHead("每晚住宿")}<div class="list">${days.map((d) => Kit.row({ href: `#plan?day=${d.n}`, lead: `<span class="daynum">D${d.n}</span>`, title: `${esc(d.date)} · ${esc(d.region)}`, sub: esc(d.hotel || "未設定"), trail: icon("chevron") })).join("")}</div>${Kit.fab("住宿", { "data-hotel-new": true, "aria-label": "新增住宿" })}`;
  }
  function hotelForm(h) {
    const v = (k) => esc(h?.[k] ?? ""),
      [first, last] = tripDates();
    openDialog(
      `${Kit.sheetHead(h ? "修改住宿" : "新增住宿")}<form class="tg-form" id="hotelForm" data-id="${h ? esc(h.id) : ""}"><label>Google 地圖連結<span class="searchrow"><input name="mapsUrl" class="search" inputmode="url" autocomplete="off" placeholder="貼上酒店的 Google 地圖分享連結" value="${v("mapsUrl")}">${Kit.btn("自動填寫", { variant: "secondary", icon: "sparkles", attrs: { id: "hotelLookup" } })}</span></label><p class="note" id="hotelLookupInfo"></p><label>酒店名稱<input name="name" required maxlength="100" value="${v("name")}"></label><label>地址<input name="address" maxlength="200" value="${v("address")}"></label><div class="tg-row"><label>入住<input name="checkIn" type="date" value="${h ? v("checkIn") : first}"></label><label>退房<input name="checkOut" type="date" value="${h ? v("checkOut") : last}"></label></div><label>備註（訂單、早餐、寄存行李…）<textarea name="note" rows="2" maxlength="500">${v("note")}</textarea></label><input type="hidden" name="lat" value="${h?.lat ?? ""}"><input type="hidden" name="lng" value="${h?.lng ?? ""}">${Kit.btn(h ? "儲存修改" : "加入住宿", { type: "submit", variant: "primary", cls: "btn-block" })}</form>`,
    );
  }
  function lookupHotel() {
    return mapsAutofill($("#hotelForm"), {
      info: $("#hotelLookupInfo"),
      fill: (r, put, el) => {
        if (r.name) el.name.value = r.name;
        if (r.address) el.address.value = r.address;
        if (Number.isFinite(r.lat)) {
          el.lat.value = r.lat;
          el.lng.value = r.lng;
        }
        if (r.mapsUrl) el.mapsUrl.value = r.mapsUrl;
        return "已填入，請檢查入住及退房日期。";
      },
    });
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
    return `${header("機票", "航班時間為各地當地時間")}${fs.length ? `<div class="twocol">${fs.map((f) => `<article class="card ticket"><div class="ticket-top"><b>${esc(Kit.date(f.depart))}</b><span>${esc(f.airline)} · ${esc(f.flightNo)}</span></div><div class="flightpath"><div><strong>${esc(f.from)}</strong><b>${esc(f.depart ? f.depart.slice(11, 16) : "")}</b></div><div class="plane">✈</div><div><strong>${esc(f.to)}</strong><b>${esc(f.arrive ? f.arrive.slice(11, 16) : "")}</b><small>${f.arrive && f.depart && f.arrive.slice(0, 10) !== f.depart.slice(0, 10) ? esc(Kit.date(f.arrive)) : ""}</small></div></div><div class="ticket-bottom"><span>${esc(f.note)}</span><span>${docsBtn("flights", f)}${itemMenu("flight", f.id)}</span></div></article>`).join("")}</div>` : Kit.empty("還沒有航班", "按右下角「＋航班」，輸入航班號、出發及到達時間。")}<p class="note">電子機票等文件可按「文件」上載，只限旅伴登入查看。</p>${Kit.fab("航班", { "data-flight-new": true, "aria-label": "新增航班" })}`;
  }
  function flightForm(f) {
    const v = (k) => esc(f?.[k] ?? "");
    openDialog(
      `${Kit.sheetHead(f ? "修改航班" : "新增航班")}<form class="tg-form" id="flightForm" data-id="${f ? esc(f.id) : ""}"><div class="tg-row"><label>航班號<input name="flightNo" required maxlength="20" placeholder="例如：CX 410" value="${v("flightNo")}"></label><label>航空公司<input name="airline" maxlength="60" value="${v("airline")}"></label></div><div class="tg-row"><label>出發地<input name="from" maxlength="80" placeholder="例如：HKG T1" value="${v("from")}"></label><label>目的地<input name="to" maxlength="80" placeholder="例如：ICN T1" value="${v("to")}"></label></div><div class="tg-row"><label>出發（當地時間）<input name="depart" type="datetime-local" value="${v("depart")}"></label><label>到達（當地時間）<input name="arrive" type="datetime-local" value="${v("arrive")}"></label></div><label>備註（行李限額等，不要輸入訂單資料）<input name="note" maxlength="500" value="${v("note")}"></label>${Kit.btn(f ? "儲存修改" : "加入航班", { type: "submit", variant: "primary", cls: "btn-block" })}</form>`,
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

  // ---- 活動 (events during the trip: festivals, light-ups, markets) ----
  let evDay = 0,
    evTime = "全部";
  const EV_TIMES = ["日間", "夜間", "全日"],
    evDays = (ev) => days.filter((d) => (!ev.start || ev.start <= isoDash(d)) && (!ev.end || isoDash(d) <= ev.end)),
    evTimeMatch = (ev) => evTime === "全部" || ev.time === evTime || ev.time === "全日";
  // An event's venue is an explore place (placeId), so it has 地點資料, a position on maps and in the plan.
  const evPlace = (ev) => (ev?.placeId && places.find((p) => p.id === ev.placeId)) || null,
    evPlaceLabel = (p) => (p ? `${p.v[1]}${p.v[0] ? ` · ${p.v[0]}` : ""}` : ""),
    NEW_PLACE = "＋新增探索地點：";
  function eventCard(ev) {
    const on = evDays(ev).map((d) => `D${d.n}`).join(" "),
      p = evPlace(ev),
      where = p ? `${p.v[1]} ${p.v[3]}` : ev.venue;
    return Kit.card({
      cls: "event",
      top: `<span class="card-date">${esc(Kit.dateRange(ev.start, ev.end))}</span>${itemMenu("event", ev.id)}`,
      title: esc(ev.title),
      body: `<div class="card-badges">${ev.area ? Kit.badge(esc(ev.area)) : ""}${ev.time ? Kit.badge(esc(ev.time), ev.time === "夜間" ? "night" : "") : ""}${ev.fee ? Kit.badge(esc(ev.fee)) : ""}${on ? Kit.badge(esc(on)) : ""}</div>${kv([["地點", ev.venue || p?.v[1]], ["時間", ev.hours], ["備註", ev.note]])}`,
      links: `${ev.url ? link(ev.url, "官網") : ""}${p ? Kit.btn("地點資料", { size: "sm", attrs: { "data-place": p.id } }) : ""}${where ? link("https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(where), "地圖") : ""}${on ? Kit.btn("加入行程", { size: "sm", icon: "calendar", attrs: { "data-event-plan": ev.id } }) : ""}`,
    });
  }
  function renderEvents() {
    const all = [...lists().events].sort((a, b) => String(a.start).localeCompare(String(b.start)) || String(a.title).localeCompare(String(b.title))),
      d = days[evDay - 1],
      shown = all.filter((ev) => (!d || evDays(ev).includes(d)) && evTimeMatch(ev));
    return `${header("活動", "旅程期間的祭典、點燈及市集")}${Kit.chips(
      [{ label: "全部日子", active: !d, attrs: { "data-event-day": 0 } }, ...days.map((x) => ({ label: `D${x.n} ${esc(x.md)}`, active: x === d, attrs: { "data-event-day": x.n } }))],
      { cls: "event-days", label: "按日子篩選" },
    )}${Kit.chips(
      ["全部", "日間", "夜間"].map((t) => ({ label: t, active: t === evTime, attrs: { "data-event-time": t } })),
      { label: "按時段篩選" },
    )}${all.length ? (shown.length ? `<div class="twocol">${shown.map(eventCard).join("")}</div>` : Kit.empty("這天沒有活動", "試試選其他日子或時段。")) : Kit.empty("還沒有活動", "按右下角「＋活動」，加入祭典、點燈或市集。")}<p class="note">活動日期及時間以主辦單位公佈為準，出發前請再到官網確認。</p>${Kit.fab("活動", { "data-event-new": true, "aria-label": "新增活動" })}`;
  }
  function eventForm(ev) {
    const v = (k) => esc(ev?.[k] ?? ""),
      [first, last] = tripDates();
    openDialog(
      `${Kit.sheetHead(ev ? "修改活動" : "新增活動")}<form class="tg-form" id="eventForm" data-id="${ev ? esc(ev.id) : ""}"><label>網頁連結（AI 幫你填寫）<span class="searchrow"><input name="fillUrl" class="search" inputmode="url" autocomplete="off" placeholder="貼上活動網頁連結">${Kit.btn("AI 填寫", { variant: "secondary", icon: "sparkles", attrs: { id: "eventFill" } })}</span></label><p class="note" id="eventFillInfo">貼上活動網頁連結，或在表格內貼上海報／網頁截圖，AI 會讀出名稱、日期、時間、費用及地點，只填空白欄位；地點會連到探索（未有的話用 Google 地圖資料新增）。</p><label>活動名稱<input name="title" required maxlength="100" value="${v("title")}"></label><div class="tg-row"><label>區域<input name="area" maxlength="40" placeholder="例如：博多" value="${v("area")}"></label><label>時段<select name="time">${EV_TIMES.map((t) => `<option${(ev?.time || "夜間") === t ? " selected" : ""}>${t}</option>`).join("")}</select></label></div><label>探索地點<input name="placeQ" list="eventPlaceList" maxlength="140" autocomplete="off" placeholder="打字搜尋探索的地點" value="${esc(evPlaceLabel(evPlace(ev)))}"></label><datalist id="eventPlaceList">${places.map((p) => `<option value="${esc(evPlaceLabel(p))}">`).join("")}</datalist><input type="hidden" name="newPlace" value=""><label>地點說明<input name="venue" maxlength="120" placeholder="例如：冷泉公園（櫛田神社前站旁）" value="${v("venue")}"></label><div class="tg-row"><label>開始<input name="start" type="date" value="${ev ? v("start") : first}"></label><label>結束<input name="end" type="date" value="${ev ? v("end") : last}"></label></div><label>時間<input name="hours" maxlength="120" placeholder="例如：17:30–21:00" value="${v("hours")}"></label><label>費用<input name="fee" maxlength="80" placeholder="例如：免費" value="${v("fee")}"></label><label>官網<input name="url" inputmode="url" maxlength="500" value="${v("url")}"></label><label>備註<textarea name="note" rows="3" maxlength="500">${v("note")}</textarea></label>${Kit.btn(ev ? "儲存修改" : "加入活動", { type: "submit", variant: "primary", cls: "btn-block" })}</form>`,
    );
  }
  // 探索地點: a place picked from the list, or the venue Google found (from AI 填寫) added to 探索 now
  function eventPlaceId(f, g) {
    const q = g("placeQ");
    if (!q) return "";
    if (q.startsWith(NEW_PLACE) && f.elements.newPlace.value) {
      const n = JSON.parse(f.elements.newPlace.value),
        today = new Date().toISOString().slice(0, 10);
      return window.Together.savePlace({
        fields: [g("area") || meta.destination || "", n.name, n.type || "活動場地", n.address, "", "", "景點", "活動新增", "", `${today}｜活動新增`, [n.website, n.mapsUrl].filter(Boolean).join("\n"), ""],
        cats: ["景點"],
        lat: n.lat,
        lng: n.lng,
        mapsUrl: n.mapsUrl || "",
      });
    }
    const p = places.find((p) => evPlaceLabel(p) === q) || places.find((p) => p.v[1] === q);
    if (!p) toast(`找不到探索地點「${q}」，活動沒有連結地點。`);
    return p?.id || "";
  }
  function saveEvent(f) {
    const v = new FormData(f),
      g = (k) => String(v.get(k) || "").trim(),
      url = g("url");
    if (!g("title")) return;
    if (g("start") && g("end") && g("end") < g("start")) return toast("結束日期要在開始之後。");
    if (url && !/^https?:\/\//.test(url)) return toast("官網要以 http:// 或 https:// 開頭。");
    window.Together.saveItem("events", f.dataset.id || null, {
      placeId: eventPlaceId(f, g),
      title: g("title").slice(0, 100),
      area: g("area").slice(0, 40),
      venue: g("venue").slice(0, 120),
      start: g("start").slice(0, 10),
      end: g("end").slice(0, 10),
      hours: g("hours").slice(0, 120),
      time: EV_TIMES.includes(g("time")) ? g("time") : "",
      fee: g("fee").slice(0, 80),
      note: g("note").slice(0, 500),
      url: url.slice(0, 500),
    });
    $("#detail").close();
  }
  // Adds the event to a day's plan (the 方案 being viewed), at the first time in its hours.
  async function eventToPlan(ev) {
    const ds = evDays(ev);
    if (!ds.length) return;
    const pick = ds.some((d) => d.n === evDay) ? evDay : ds[0].n,
      day = ds.length === 1 ? pick : Number(await UI.choose("加入哪一天？", Object.fromEntries(ds.map((d) => [d.n, `D${d.n} ${d.date} · ${d.region}`])), String(pick)));
    if (!day) return;
    const p = evPlace(ev),
      at = p && (window.TRIP_GEO?.places?.[p.id] || [])[0];
    // at an explore place the stop shows the place (地點資料, position); the event's name and times go in its 備註
    const stop = {
      time: (String(ev.hours).match(/\d{1,2}:\d{2}/) || [""])[0],
      area: ev.area || "",
      title: ev.title,
      detail: [ev.venue, ev.hours, ev.fee, ev.note].filter(Boolean).join("｜"),
      transport: "",
      ref: ev.url || "",
      target: ev.venue || ev.title,
      ...(p ? { placeId: p.id, note: [ev.title, ev.hours, ev.fee].filter(Boolean).join("｜").slice(0, 500), ...(at ? { lat: at.lat, lng: at.lng } : {}) } : {}),
    };
    savePlan(day, insertByTime(stopsFor(day), stop));
    toast(`已加入 D${day}：${ev.title}`);
  }
  // AI 填寫: a web page (or a pasted screenshot) read by the AI (an eventFill job); only empty fields are filled, and the
  // venue is matched to an explore place within 150 m, else offered as a new one from Google Maps.
  async function eventFill(input) {
    const f = $("#eventForm"),
      info = $("#eventFillInfo");
    if (!f || !info) return;
    const done = Kit.busy(info, { seconds: 20 });
    info.textContent = input.images ? "AI 正在讀取截圖…" : "AI 正在讀取網頁…";
    let r;
    try {
      r = await window.Together.aiJob({ kind: "eventFill", file: input.images ? "活動截圖" : "活動網頁", ...input });
    } catch (e) {
      done();
      info.textContent = e.message || "AI 未能讀取，請自行填寫。";
      return;
    }
    done();
    if ($("#eventForm") !== f) return;
    const el = f.elements,
      put = (n, x) => {
        if (el[n] && x && !String(el[n].value).trim()) el[n].value = x;
      };
    for (const k of ["title", "area", "venue", "hours", "fee", "note"]) put(k, r[k]);
    if (r.start) el.start.value = r.start;
    if (r.end) el.end.value = r.end;
    if (EV_TIMES.includes(r.time)) el.time.value = r.time;
    if (input.url) put("url", input.url);
    let where = "";
    if (r.place && !el.placeQ.value.trim()) {
      const geo = window.TRIP_GEO?.places || {},
        near = places
          .map((p) => ({ p, d: Math.min(...(geo[p.id] || []).map((c) => window.Nearby.distance(r.place, c)), Infinity) }))
          .filter((x) => x.d <= 150)
          .sort((a, b) => a.d - b.d)[0];
      if (near) {
        el.placeQ.value = evPlaceLabel(near.p);
        where = `地點連到探索的「${near.p.v[1]}」。`;
      } else {
        el.placeQ.value = NEW_PLACE + r.place.name;
        el.newPlace.value = JSON.stringify(r.place);
        where = `「${r.place.name}」未在探索，儲存時會用 Google 地圖資料加入探索。`;
      }
    }
    info.textContent = `AI 已填入空白欄位，請檢查。${where}`;
  }
  document.addEventListener("click", (e) => {
    if (e.target.closest("#eventFill")) {
      e.preventDefault();
      const u = String($("#eventForm")?.elements.fillUrl.value || "").trim();
      if (!/^https?:\/\/\S+$/.test(u)) return toast("請先貼上 http:// 或 https:// 開頭的網頁連結。");
      eventFill({ url: u.slice(0, 500) });
    }
  });
  document.addEventListener("paste", async (e) => {
    const f = e.target.closest?.("#eventForm");
    if (!f) return;
    const img = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith("image/")),
      text = e.clipboardData?.getData("text") || "";
    if (img) {
      e.preventDefault();
      try {
        eventFill({ images: [await window.Together.shrink(img, 1600, 0.8)] });
      } catch {
        toast("未能讀取這張圖片，請改用 JPG 或 PNG。");
      }
    } else if (e.target.name === "fillUrl" && /^https?:\/\/\S+$/.test(text.trim())) {
      e.preventDefault();
      e.target.value = text.trim();
      eventFill({ url: text.trim().slice(0, 500) });
    }
  });
  document.addEventListener("click", (e) => {
    const el = e.target.closest("button");
    if (!el) return;
    const find = (id) => lists().events.find((x) => x.id === id);
    if (el.dataset.eventDay !== undefined || el.dataset.eventTime) {
      if (el.dataset.eventDay !== undefined) evDay = Number(el.dataset.eventDay);
      else evTime = el.dataset.eventTime;
      $("#app").innerHTML = renderEvents();
    }
    if (el.dataset.eventNew !== undefined) eventForm(null);
    if (el.dataset.eventEdit) eventForm(find(el.dataset.eventEdit));
    if (el.dataset.eventPlan) eventToPlan(find(el.dataset.eventPlan));
    if (el.dataset.eventDel) {
      const id = el.dataset.eventDel;
      UI.confirm("刪除這個活動？", { danger: true, ok: "刪除" }).then((ok) => ok && window.Together.removeItem("events", id));
    }
  });
  document.addEventListener("submit", (e) => {
    if (e.target.id === "eventForm") {
      e.preventDefault();
      saveEvent(e.target);
    }
  });

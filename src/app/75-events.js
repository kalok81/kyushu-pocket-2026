  // ---- 活動 (events during the trip: festivals, light-ups, markets) ----
  let evDay = 0,
    evTime = "全部";
  const EV_TIMES = ["日間", "夜間", "全日"],
    evDays = (ev) => days.filter((d) => (!ev.start || ev.start <= isoDash(d)) && (!ev.end || isoDash(d) <= ev.end)),
    evTimeMatch = (ev) => evTime === "全部" || ev.time === evTime || ev.time === "全日";
  function eventCard(ev) {
    const on = evDays(ev).map((d) => `D${d.n}`).join(" ");
    return Kit.card({
      cls: "event",
      top: `<span class="card-date">${esc(Kit.dateRange(ev.start, ev.end))}</span>${itemMenu("event", ev.id)}`,
      title: esc(ev.title),
      body: `<div class="card-badges">${ev.area ? Kit.badge(esc(ev.area)) : ""}${ev.time ? Kit.badge(esc(ev.time), ev.time === "夜間" ? "night" : "") : ""}${ev.fee ? Kit.badge(esc(ev.fee)) : ""}${on ? Kit.badge(esc(on)) : ""}</div>${kv([["地點", ev.venue], ["時間", ev.hours], ["備註", ev.note]])}`,
      links: `${ev.url ? link(ev.url, "官網") : ""}${ev.venue ? link("https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(ev.venue), "地圖") : ""}${on ? Kit.btn("加入行程", { size: "sm", icon: "calendar", attrs: { "data-event-plan": ev.id } }) : ""}`,
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
      `${Kit.sheetHead(ev ? "修改活動" : "新增活動")}<form class="tg-form" id="eventForm" data-id="${ev ? esc(ev.id) : ""}"><label>活動名稱<input name="title" required maxlength="100" value="${v("title")}"></label><div class="tg-row"><label>區域<input name="area" maxlength="40" placeholder="例如：博多" value="${v("area")}"></label><label>時段<select name="time">${EV_TIMES.map((t) => `<option${(ev?.time || "夜間") === t ? " selected" : ""}>${t}</option>`).join("")}</select></label></div><label>地點<input name="venue" maxlength="120" value="${v("venue")}"></label><div class="tg-row"><label>開始<input name="start" type="date" value="${ev ? v("start") : first}"></label><label>結束<input name="end" type="date" value="${ev ? v("end") : last}"></label></div><label>時間<input name="hours" maxlength="120" placeholder="例如：17:30–21:00" value="${v("hours")}"></label><label>費用<input name="fee" maxlength="80" placeholder="例如：免費" value="${v("fee")}"></label><label>官網<input name="url" inputmode="url" maxlength="500" value="${v("url")}"></label><label>備註<textarea name="note" rows="3" maxlength="500">${v("note")}</textarea></label>${Kit.btn(ev ? "儲存修改" : "加入活動", { type: "submit", variant: "primary", cls: "btn-block" })}</form>`,
    );
  }
  function saveEvent(f) {
    const v = new FormData(f),
      g = (k) => String(v.get(k) || "").trim(),
      url = g("url");
    if (!g("title")) return;
    if (g("start") && g("end") && g("end") < g("start")) return toast("結束日期要在開始之後。");
    if (url && !/^https?:\/\//.test(url)) return toast("官網要以 http:// 或 https:// 開頭。");
    window.Together.saveItem("events", f.dataset.id || null, {
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
    const stop = {
      time: (String(ev.hours).match(/\d{1,2}:\d{2}/) || [""])[0],
      area: ev.area || "",
      title: ev.title,
      detail: [ev.venue, ev.hours, ev.fee, ev.note].filter(Boolean).join("｜"),
      transport: "",
      ref: ev.url || "",
      target: ev.venue || ev.title,
    };
    savePlan(day, insertByTime(stopsFor(day), stop));
    toast(`已加入 D${day}：${ev.title}`);
  }
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

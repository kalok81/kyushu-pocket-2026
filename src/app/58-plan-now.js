  // ---- 而家: on a day of the trip, where the travellers are in the plan, the next stop and when to leave for it ----
  // Shown on 總覽 and on that day's plan, worked out again every 30 seconds. 「AI 調整餘下行程」 re-plans the stops not
  // started yet from where they are now (rain, running late, tired) and saves it as a new 方案 of the day.
  const nowMinute = () => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  };
  const todayDay = () => days.find((d) => d.iso === todayIso())?.n || 0;
  const span = (min) => (min >= 60 ? `${Math.floor(min / 60)} 小時${min % 60 ? ` ${min % 60} 分鐘` : ""}` : `${min} 分鐘`);
  // The day's time slots with their start and end minutes (end = start when only one time is given).
  function slotsOf(day, list = stopsFor(day)) {
    return stopGroups(list).map((g) => {
      const s = g[0].s,
        a = startMinute(s.time),
        e = startMinute(endClock(s.time));
      return { g, s, a, e: a != null && e != null && e > a ? e : a };
    });
  }
  // When to leave for the next stop: by the first train or bus time written in its transport (minus the walk to it
  // and 5 minutes to find the platform), else by the minutes the transport gives or a guess from the distance.
  function leaveFor(next, prev) {
    const t = String(next.s.transport || ""),
      dep = t.match(/(\d{1,2}):(\d{2})/),
      walk = t.match(/^\s*🚶\s*(?:步行\s*)?(\d+)\s*分/u);
    if (dep && !/^🚶 步行/u.test(t)) {
      const d = Number(dep[1]) * 60 + Number(dep[2]);
      if (d <= next.a && d >= next.a - 300) {
        const step = t.split("｜")[0].split(/ → (?=\p{Extended_Pictographic})/u).find((x) => x.includes(dep[0])) || "",
          name = step.slice(0, step.indexOf(dep[0])).replace(/[（(]\s*(\d+ 站，)?(約\s*)?$/, "").trim().slice(0, 40);
        return { at: d - (walk ? Number(walk[1]) : 0) - 5, ride: `${dep[0]}${name ? " " + name : " 班次"}` };
      }
    }
    return { at: next.a - (prev ? legMinutes(prev, next.s) : 15) };
  }
  function nowCard(day) {
    const m = nowMinute(),
      slots = slotsOf(day),
      timed = slots.filter((x) => x.a != null);
    if (!timed.length) return "";
    const here = [...timed].reverse().find((x) => x.a <= m && m < x.e),
      ni = slots.findIndex((x) => x.a != null && x.a > m),
      next = ni >= 0 ? slots[ni] : null,
      start = dayStartHotel(day),
      prev = ni > 0 ? slots[ni - 1].s : start && !slots[0].s.hotelId ? start : null,
      end = dayEndHotel(day);
    let body;
    if (next) {
      const lv = leaveFor(next, prev),
        left = lv.at - m;
      body = `<p class="now-next">下一站：<b>${esc(next.s.title)}</b><span>${esc(next.s.time)}</span></p><p class="now-leave${left < 0 ? " late" : left <= 15 ? " soon" : ""}">${icon("clock")}<span>最遲 <b>${hm(Math.max(0, lv.at))}</b> 出發${lv.ride ? `，搭 ${esc(lv.ride)}` : ""} · ${left < 0 ? `已過 ${span(-left)}` : left === 0 ? "現在出發" : `還有 ${span(left)}`}</span></p>`;
    } else body = `<p class="now-next">今天的行程已完成${end ? `，回「<b>${esc(end.name)}</b>」` : ""}。</p>`;
    const goTo = next ? next.s.target || next.s.title : end ? `${end.name} ${end.address || ""}`.trim() : "";
    const rest = slots.filter((x) => x.a == null || x.a > m).length;
    return `<section class="now-card" data-now="${day}" aria-live="polite"><p class="now-head"><b>而家 ${hm(m)}</b>${here ? `<span>在「${esc(here.s.title)}」，到 ${hm(here.e)}</span>` : ""}</p>${body}<div class="now-actions">${goTo ? Kit.btn("導航", { href: route(goTo), external: true, size: "sm", variant: "secondary", icon: "route" }) : ""}${rest ? Kit.btn("AI 調整餘下行程", { size: "sm", icon: "sparkles", attrs: { "data-now-replan": day } }) : ""}</div></section>`;
  }
  // On 總覽 and on the plan of today (the main 方案 or the one on screen)
  const nowFor = (day) => (day && day === todayDay() ? nowCard(day) : "");
  setInterval(() => {
    for (const el of document.querySelectorAll("[data-now]")) if (!el.contains(document.activeElement)) el.outerHTML = nowCard(Number(el.dataset.now)) || "<span></span>";
  }, 30000);

  // AI 調整餘下行程: the stops not started yet, re-planned from here and now; the result is a new 方案 of the day
  // (the plan as it was stays), made only after it has been seen.
  const WHY = ["遲咗", "落雨", "好攰", "想早啲返酒店", "想加食飯時間"];
  let replan = null;
  function replanForm(day) {
    const m = Math.ceil((nowMinute() + 5) / 5) * 5;
    openDialog(
      `${Kit.sheetHead("AI 調整餘下行程", `D${day}`)}<p class="note">AI 會由你現在的位置及時間，重新安排今天還未去的站點，可以按情況刪走趕不及的地方。結果會另存為新方案，原本的行程不變。</p><form class="tg-form" id="replanForm" data-day="${day}"><fieldset class="replan-why"><legend>現在的情況</legend>${WHY.map((w) => `<label class="tg-check"><input type="checkbox" name="why" value="${w}"> ${w}</label>`).join("")}</fieldset><label>其他（可不填）<input name="more" maxlength="150" placeholder="例如：想去附近買手信"></label><label>出發時間<input name="start" type="time" value="${hm(m)}" required></label>${Kit.toggle("由我現在的位置出發", { name: "here", checked: true })}${Kit.btn("開始調整", { type: "submit", variant: "primary", icon: "sparkles", cls: "btn-block" })}</form><div id="replanOut"></div>`,
    );
  }
  const myPosition = () =>
    new Promise((ok) =>
      navigator.geolocation
        ? navigator.geolocation.getCurrentPosition(
            (p) => ok({ lat: p.coords.latitude, lng: p.coords.longitude }),
            () => ok(null),
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
          )
        : ok(null),
    );
  async function aiReplan(day, form) {
    const out = $("#replanOut"),
      f = form.elements,
      startTime = f.start.value,
      m = startMinute(startTime) ?? nowMinute(),
      situation = [...[...f.why].filter((x) => x.checked).map((x) => x.value), f.more.value.trim()].filter(Boolean).join("；") || "沒有特別，按現在時間重新安排",
      list = stopsFor(day),
      slots = slotsOf(day, list),
      cut = slots.findIndex((x) => x.a == null || x.a >= m),
      done = cut < 0 ? slots : slots.slice(0, cut),
      todo = cut < 0 ? [] : slots.slice(cut),
      end = dayEndHotel(day);
    // the hotel the day ends at is where they go, not a stop to plan
    const gs = todo.map((x) => x.g).filter((g, n, all) => !(n === all.length - 1 && g[0].s.hotelId && all.length > 1));
    if (!gs.length) return (out.innerHTML = '<p class="note">今天已經沒有未去的站點。</p>');
    form.hidden = true;
    out.innerHTML = Kit.dots("正在取得你的位置…");
    const pos = f.here.checked ? await myPosition() : null,
      last = done.at(-1)?.s;
    const from = pos ? { name: "現在位置", ...pos } : last ? placeForAi(last) : null;
    out.innerHTML = Kit.progress({ text: "AI 正在調整，大約需要 20–60 秒…", seconds: 45 });
    try {
      const r = await window.Together.planDay({
        mode: "arrange",
        situation: situation.slice(0, 300),
        date: isoDash(days[day - 1]),
        weekday: days[day - 1].weekday,
        region: meta.destination || days[day - 1].region,
        currency: meta.currency || "JPY",
        startTime,
        start: from ? { k: "start", ...from } : null,
        end: end ? { k: "end", ...placeForAi({ title: end.name, address: end.address, lat: end.lat, lng: end.lng }) } : null,
        stops: aiStops(gs, (s) => !!s.manual && startMinute(s.time) != null),
      });
      if (!$("#replanOut")) return;
      const used = new Set([...done.map((x) => x.g), ...gs].flat().map(({ i }) => i));
      replan = { day, gs, r, startTime, done: done.flatMap((x) => x.g.map(({ s }) => s)), rest: list.filter((_, i) => !used.has(i)) };
      const legOf = (k) => r.legs.find((l) => l.k === k),
        dropped = Object.entries(r.dropped || {});
      out.innerHTML = `${r.advice ? `<div class="route-ai-head"><b>${icon("sparkles")} AI 建議</b><p>${esc(r.advice)}</p></div>` : ""}<ol class="ai-plan">${r.order
        .map((k) => {
          const g = gs[Number(k)],
            leg = legOf(k);
          return `${leg ? `<li class="ai-plan-leg">${esc(legText(leg))}</li>` : ""}<li class="card ai-plan-stop"><b>${esc(r.times[k] || "")}</b><span>${g.map((x) => esc(x.s.title)).join(" / ")}</span>${r.warnings[k] ? `<small class="stop-warn">${icon("clock")}<span>${esc(r.warnings[k])}</span></small>` : ""}</li>`;
        })
        .join("")}</ol>${dropped.length ? `<p class="note replan-dropped"><b>建議刪走：</b>${dropped.map(([k, why]) => `${esc(gs[Number(k)].map((x) => x.s.title).join(" / "))}（${esc(why)}）`).join("、")}</p>` : ""}<p class="note">時間、交通及車費由 AI 估算。套用後會另存為新方案「AI 調整 ${esc(startTime)}」，原本的行程不變。</p><div class="detail-actions">${Kit.btn("另存為新方案", { variant: "primary", icon: "check", attrs: { "data-replan-apply": true } })}${Kit.btn("重新調整", { icon: "redo", attrs: { "data-replan-again": true } })}</div>`;
    } catch (e) {
      console.error(e);
      out.innerHTML = `<p class="note">${esc(fnError(e, "AI 未能調整，請稍後再試。"))}</p>`;
      form.hidden = false;
    }
  }
  function applyReplan() {
    const a = replan;
    if (!a) return;
    const vs = variantsOf(a.day);
    if (vs.length >= 8) return toast("每天最多 9 個方案，請先刪除一個。");
    const { r, gs } = a,
      redone = r.order.flatMap((k) => {
        const leg = r.legs.find((l) => l.k === k);
        return gs[Number(k)].map(({ s }) => ({ ...s, manual: false, time: r.times[k] || s.time, transport: leg ? legText(leg).slice(0, 500) : s.transport, warn: r.warnings[k] || "" }));
      });
    const name = `AI 調整 ${a.startTime}`,
      v = { id: Date.now().toString(36), name, stops: [...a.done, ...redone, ...a.rest].map(stopFields) };
    replan = null;
    $("#detail").close();
    saveVariants(a.day, [...vs, v]);
    planView = { ...planView, [a.day]: v.id };
    location.hash = `#plan?day=${a.day}`;
    if (current === "plan") refreshPlan();
    toast(`已另存為「${name}」；滿意的話可在「⋯」設為主要方案`);
  }
  document.addEventListener("click", (e) => {
    const el = e.target.closest("button");
    if (!el) return;
    if (el.dataset.nowReplan) replanForm(Number(el.dataset.nowReplan));
    if (el.dataset.replanApply !== undefined) applyReplan();
    if (el.dataset.replanAgain !== undefined && replan) {
      const form = $("#replanForm");
      replan = null;
      if (form) aiReplan(Number(form.dataset.day), form);
    }
  });
  document.addEventListener("submit", (e) => {
    if (e.target.id !== "replanForm") return;
    e.preventDefault();
    aiReplan(Number(e.target.dataset.day), e.target);
  });

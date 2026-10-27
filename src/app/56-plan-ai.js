  // ---- 行程 tools: 查全日交通 and ✨ AI 安排 ----
  // Maps, trains in Japan by NAVITIME (lines, fares and estimated times), the rest by the AI.
  const placeForAi = (s) => {
    const p = pointOf(s);
    return { name: s.title || s.name, address: s.target || s.address || "", ...(p ? { lat: p.lat, lng: p.lng } : {}) };
  };
  const legText = (l) =>
    l.source === "navitime"
      ? `${routeText(l, "TRANSIT")}（NAVITIME，時間為估算）`
      : l.source === "google"
      ? `🚶 步行 ${l.minutes} 分（${l.meters >= 1000 ? `${(l.meters / 1000).toFixed(1)} 公里` : `${l.meters} 米`}）｜約 ${l.minutes} 分（Google 地圖）`
      : `${l.steps.map(aiStep).join(" → ")}｜約 ${l.minutes} 分${l.fare ? ` · ${fareText(l)}` : ""}（AI 估算）`;
  function dayLegs(day, all) {
    const list = stopsFor(day),
      gs = stopGroups(list),
      start = !gs[0]?.[0].s.hotelId && dayStartHotel(day);
    const legs = [];
    gs.forEach((g, n) => {
      const from = n ? gs[n - 1][0].s : start ? { title: start.name, target: `${start.name} ${start.address || ""}`.trim(), ...(Number.isFinite(start.lat) ? { lat: start.lat, lng: start.lng } : {}) } : null;
      if (from) for (const { s, i } of g) if (all || !s.transport) legs.push({ i, from, to: s, time: endClock(from.time) });
    });
    return legs;
  }
  async function fillRoutes(day, all = false) {
    const legs = dayLegs(day, all);
    if (!legs.length) {
      if (!dayLegs(day, true).length) return toast("最少要有兩個站點（或住宿）才可以查交通。");
      if (!(await UI.confirm("全部交通已經填好", { text: "要重新查詢全日的交通嗎？", ok: "重新查詢" }))) return;
      return fillRoutes(day, true);
    }
    const found = {},
      done = Kit.busy($("#planToolsInfo"), { text: `正在查詢 ${legs.length} 段交通（步行用 Google 地圖，火車用 NAVITIME 路線）…`, seconds: 10 + legs.length * 4 });
    let ai = false;
    try {
      const d = days[day - 1],
        r = await window.Together.planDay({
          mode: "routes",
          date: isoDash(d),
          weekday: d.weekday,
          region: meta.destination || d.region,
          currency: meta.currency || "JPY",
          legs: legs.map((l) => ({ k: String(l.i), from: placeForAi(l.from), to: placeForAi(l.to), time: l.time })),
        });
      for (const l of r.legs) {
        found[l.k] = legText(l);
        ai ||= !["google", "navitime"].includes(l.source);
      }
    } catch (e) {
      toast(fnError(e, "未能查詢交通，請稍後再試。"));
    } finally {
      done();
    }
    const list = stopsFor(day),
      n = Object.keys(found).length;
    if (!n) return;
    changeDay(day, list.map((s, i) => (found[i] ? { ...s, transport: found[i].slice(0, 500) } : s)), `已填入 ${n} 段交通${ai ? "（AI 估算的部分出發前請再確認）" : ""}`);
  }

  // ✨ AI 安排: order, times and transport for the whole day in one go, shown first and applied only when accepted.
  let aiPlan = null;
  function aiArrangeForm(day) {
    const list = stopsFor(day),
      timed = list.filter((s) => startMinute(s.time) != null).length,
      first = startMinute(list[0]?.time),
      startAt = first != null ? hm(first) : "09:00";
    openDialog(
      `${Kit.sheetHead("AI 安排這天", `D${day}`)}<p class="note">AI 會按距離、營業時間、星期幾及用餐時間，排好次序、時間及每段交通，並提示休息日或趕不及的地方。看過結果才決定是否套用。</p><form class="tg-form" id="aiPlanForm" data-day="${day}"><label>出發時間<input name="start" type="time" value="${startAt}" required></label>${timed ? Kit.toggle("保留我已填的時間（例如已預約的餐廳）", { name: "keep" }) : ""}${Kit.btn("開始安排", { type: "submit", variant: "primary", icon: "sparkles", cls: "btn-block" })}</form><div id="aiPlanOut"></div>`,
    );
  }
  async function aiArrange(day, keep, startTime = "") {
    const out = $("#aiPlanOut"),
      list = stopsFor(day),
      gs = stopGroups(list),
      d = days[day - 1];
    if (gs.length < 2) return (out.innerHTML = '<p class="note">最少要有兩個站點。</p>');
    const start = !gs[0][0].s.hotelId && dayStartHotel(day),
      end = dayEndHotel(day);
    out.innerHTML = Kit.progress({ text: "AI 正在安排，大約需要 20–60 秒…", seconds: 45 });
    $("#aiPlanForm").hidden = true;
    try {
      const r = await window.Together.planDay({
        mode: "arrange",
        date: isoDash(d),
        weekday: d.weekday,
        region: meta.destination || d.region,
        currency: meta.currency || "JPY",
        startTime,
        start: start ? { k: "start", ...placeForAi({ title: start.name, address: start.address, lat: start.lat, lng: start.lng }) } : null,
        end: end ? { k: "end", ...placeForAi({ title: end.name, address: end.address, lat: end.lat, lng: end.lng }) } : null,
        stops: gs.map((g, n) => {
          const s = g[0].s,
            p = placeOf(s);
          return {
            k: String(n),
            ...placeForAi(s),
            name: g.map((x) => x.s.title).join(" / "),
            type: isStation(s) ? "transport stop (station, bus stop, airport): only where they change trains or buses" : s.hotelId ? (n === 0 ? "hotel: where the day starts" : n === gs.length - 1 ? "hotel: where the day ends" : "hotel: check-in or leaving luggage on the way") : p?.v[2] || p?.cats.join("、") || "",
            hours: String(p?.v[5] || "").slice(0, 300),
            time: s.time || "",
            fixed: (keep && startMinute(s.time) != null) || (n === 0 && !!s.hotelId),
            stay: s.manual || isStation(s) ? stayOf(s, n === 0 || n === gs.length - 1 ? "edge" : "mid") : 0,
          };
        }),
      });
      aiPlan = { day, gs, r, before: list };
      const legOf = (k) => r.legs.find((l) => l.k === k);
      out.innerHTML = `${r.advice ? `<div class="route-ai-head"><b>${icon("sparkles")} AI 建議</b><p>${esc(r.advice)}</p></div>` : ""}<ol class="ai-plan">${r.order
        .map((k, j) => {
          const g = gs[Number(k)],
            leg = j ? legOf(k) : null;
          return `${leg ? `<li class="ai-plan-leg">${esc(legText(leg))}</li>` : ""}<li class="card ai-plan-stop"><b>${esc(r.times[k] || "")}</b><span>${g.map((x) => esc(x.s.title)).join(" / ")}</span>${r.warnings[k] ? `<small class="stop-warn">${icon("clock")}<span>${esc(r.warnings[k])}</span></small>` : ""}</li>`;
        })
        .join("")}</ol><p class="note">時間、交通及車費由 AI 估算，出發前請再確認。</p><div class="detail-actions">${Kit.btn("套用", { variant: "primary", icon: "check", attrs: { "data-ai-plan-apply": true } })}${Kit.btn("重新安排", { icon: "redo", attrs: { "data-ai-plan-again": true } })}</div>`;
    } catch (e) {
      console.error(e);
      out.innerHTML = `<p class="note">${esc(fnError(e, "AI 未能安排，請稍後再試。"))}</p>`;
      $("#aiPlanForm").hidden = false;
    }
  }
  function applyAiPlan() {
    const a = aiPlan;
    if (!a) return;
    const { r, gs } = a;
    const after = r.order.flatMap((k, j) => {
      const leg = j ? r.legs.find((l) => l.k === k) : null;
      return gs[Number(k)].map(({ s }) => ({ ...s, manual: false, time: r.times[k] || s.time, transport: leg ? legText(leg).slice(0, 500) : j ? "" : s.transport, warn: r.warnings[k] || "" }));
    });
    $("#detail").close();
    aiPlan = null;
    changeDay(a.day, after, "已套用 AI 安排");
  }

  // Another day: 與另一日對調 swaps two whole days (stops and titles); 移去其他日子 moves one stop, keeping its time.

  // ---- 行程 tools: order by distance, drag to reorder, every leg's transport at once, AI arrangement and times ----
  // Times and transport follow the order: a stop whose previous stop changed loses its transport (and AI warning),
  // and a reordered day that had times gets them worked out again. Each change can be undone from the snack bar.
  const placeOf = (s) => (s.placeId && places.find((p) => p.id === s.placeId)) || null;
  const pointOf = (s) => {
    const p = s && stopPoint(s);
    return p && Number.isFinite(p.lat) ? p : null;
  };
  const stopKey = (s) => s && (s.placeId || s.hotelId || s.title);
  // The hotel the day starts from (last night's) and the one it ends at.
  const hotelNamed = (name) => name && lists().hotels.find((h) => h.name === name);
  const dayStartHotel = (day) => hotelNamed(days[day - 2]?.hotel);
  const dayEndHotel = (day) => hotelNamed(days[day - 1]?.hotel);

  function legsChanged(before, after) {
    const prevOf = (list) => {
      const m = new Map();
      stopGroups(list).forEach((g, n, gs) => g.forEach(({ s }) => m.set(s, n ? stopKey(gs[n - 1][0].s) : null)));
      return m;
    };
    const was = new Map();
    stopGroups(before).forEach((g, n, gs) => g.forEach(({ s }) => was.set(stopKey(s), n ? stopKey(gs[n - 1][0].s) : null)));
    const now = prevOf(after);
    return after.map((s) => (was.has(stopKey(s)) && was.get(stopKey(s)) === now.get(s) ? s : { ...s, transport: "", warn: "" }));
  }

  // Minutes planned at a stop: a time range the traveller typed (修改), else a usual visit length for its kind of place.
  // Stations, bus stops, airports and piers are only where the travellers change (5 minutes, shown as the arrival time).
  // Ranges worked out here or by the AI are not kept, so a wrong guess is not repeated by the next 推算時間.
  const STATION = /(駅|站|車站|バス停|バスターミナル|空港|機場|港|ターミナル|station|terminal)$/i;
  const isStation = (s) => {
    const p = placeOf(s);
    return p?.cats.includes("交通") || STATION.test(String(s.title).trim()) || /駅|車站|バス停|空港|機場|フェリー乗り場|train station|bus station|airport/i.test(p?.v[2] || "");
  };
  // A hotel that starts or ends the day is only a time; in the middle of the day it is a check-in or luggage stop.
  function stayOf(s, role = "") {
    if (isStation(s)) return 5;
    const m = s.manual && String(s.time || "").match(/(\d{1,2}):(\d{2})\s*[–~\-－至到]+\s*(\d{1,2}):(\d{2})/);
    if (m) {
      const d = Number(m[3]) * 60 + Number(m[4]) - (Number(m[1]) * 60 + Number(m[2]));
      if (d > 0) return d;
    }
    if (s.hotelId) return role === "mid" ? 15 : 0;
    const p = placeOf(s),
      t = `${s.title} ${p?.v[2] || ""} ${p?.cats.join(" ") || ""}`;
    if (/展望|足湯|鳥居|タワー|塔$|塔 /.test(t)) return 30;
    if (/博物館|美術館|水族館|纜車|ロープウェイ|地獄|動物園|樂園|テーマパーク/.test(t)) return 75;
    if (/溫泉|温泉|湯$|浴場/.test(t)) return 60;
    if (/咖啡|甜品|cafe|カフェ|喫茶|茶屋|雪糕|布甸|ジェラート/i.test(t)) return 40;
    if (/公園|神社|寺|稻荷|稲荷|庭園|老街|商店街|街道|通り/.test(t)) return 45;
    if (/餐廳|拉麵|ラーメン|食堂|居酒屋|燒肉|焼肉|壽司|寿司|鍋|麵|うどん|そば|料理/.test(t)) return 60;
    if (/商店|購物|百貨|藥妝|手信|ショップ|モール/.test(t)) return 45;
    return 60;
  }
  // Minutes to get to a stop: its saved transport ("約 14 分"), else a guess from the distance.
  function legMinutes(prev, s) {
    const m = String(s.transport || "").match(/｜約\s*(\d+)\s*分/) || String(s.transport || "").match(/約\s*(\d+)\s*分/);
    if (m) return Number(m[1]);
    const a = pointOf(prev),
      b = pointOf(s);
    if (!a || !b) return 20;
    const d = window.Nearby.distance(a, b);
    return d < 1000 ? Math.max(3, Math.ceil((d * 1.3) / 75)) : Math.round(15 + (d / 1000) * 2.5);
  }
  const hm = (t) => `${String(Math.floor(t / 60) % 24).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
  function retimed(list) {
    const out = [...list];
    let t = startMinute(list[0]?.time) ?? 9 * 60;
    stopGroups(list).forEach((g, n, gs) => {
      if (n) t = Math.ceil((t + legMinutes(gs[n - 1][0].s, g[0].s)) / 5) * 5;
      const role = n === 0 || n === gs.length - 1 ? "edge" : "mid",
        stay = Math.max(...g.map(({ s }) => stayOf(s, role)));
      for (const { s, i } of g) out[i] = { ...s, time: stay > 5 ? `${hm(t)}–${hm(t + stay)}` : hm(t), manual: false };
      t += stay;
    });
    return out;
  }
  const hasTimes = (list) => list.some((s) => startMinute(s.time) != null);
  function changeDay(day, after, text) {
    const before = stopsFor(day);
    savePlan(day, after);
    Kit.snack(text, { action: "復原" }).then((undo) => undo && savePlan(day, before));
  }

  // 排順路: nearest stop next, then 2-opt, from the hotel the day starts at (or the first stop) to tonight's hotel.
  // Time slots with several choices move together; stops without a position stay at the end.
  function orderByDistance(day) {
    const before = stopsFor(day),
      gs = stopGroups(before);
    const head = gs[0]?.[0].s.hotelId || !dayStartHotel(day) ? [gs.shift()] : [];
    const tail = gs.length && gs.at(-1)[0].s.hotelId ? [gs.pop()] : [];
    const free = gs.filter((g) => pointOf(g[0].s)),
      lost = gs.filter((g) => !pointOf(g[0].s));
    if (free.length < 2) return toast("站點太少或未有位置，未能排順路。");
    const startH = dayStartHotel(day),
      endH = tail.length ? null : dayEndHotel(day);
    const S = head.length ? pointOf(head[0][0].s) : startH && Number.isFinite(startH.lat) ? startH : null,
      E = tail.length ? pointOf(tail[0][0].s) : endH && Number.isFinite(endH.lat) ? endH : null;
    const P = free.map((g) => pointOf(g[0].s)),
      dist = (a, b) => (a && b ? window.Nearby.distance(a, b) : 0);
    const cost = (o) => dist(S, P[o[0]]) + o.slice(1).reduce((t, k, j) => t + dist(P[o[j]], P[k]), 0) + dist(P[o.at(-1)], E);
    // Nearest neighbour from the start
    const left = new Set(P.keys()),
      order = [];
    let at = S || P[0];
    while (left.size) {
      const k = [...left].sort((a, b) => dist(at, P[a]) - dist(at, P[b]))[0];
      order.push(k);
      left.delete(k);
      at = P[k];
    }
    // 2-opt: reverse stretches while it shortens the day
    for (let better = true, rounds = 0; better && rounds < 50; rounds++) {
      better = false;
      for (let i = 0; i < order.length - 1; i++)
        for (let j = i + 1; j < order.length; j++) {
          const o = [...order.slice(0, i), ...order.slice(i, j + 1).reverse(), ...order.slice(j + 1)];
          if (cost(o) + 1 < cost(order)) {
            order.splice(0, order.length, ...o);
            better = true;
          }
        }
    }
    const after = [...head, ...order.map((k) => free[k]), ...lost, ...tail].flat().map((x) => x.s);
    if (after.every((s, i) => s === before[i])) return toast("現在的次序已經最順路。");
    const fixed = legsChanged(before, after);
    changeDay(day, hasTimes(before) ? retimed(fixed) : fixed, hasTimes(before) ? "已按距離排順路，並重新推算時間" : "已按距離排順路");
  }

  // Drag a time slot by its handle to a new place in the day.
  function moveGroup(day, from, to) {
    const before = stopsFor(day),
      gs = stopGroups(before),
      [g] = gs.splice(from, 1);
    gs.splice(to, 0, g);
    const after = legsChanged(before, gs.flat().map((x) => x.s));
    changeDay(day, hasTimes(before) ? retimed(after) : after, hasTimes(before) ? "已調整次序，並重新推算時間" : "已調整次序");
  }
  document.addEventListener("pointerdown", (e) => {
    const grip = e.target.closest(".stop-grip");
    if (!grip || e.button > 0) return;
    e.preventDefault();
    const card = grip.closest("article.stop"),
      items = [...card.parentElement.querySelectorAll(":scope > article.stop")],
      from = items.indexOf(card),
      y0 = e.clientY,
      s0 = scrollY;
    let to = from,
      lastY = y0,
      timer = 0;
    card.classList.add("dragging");
    grip.setPointerCapture(e.pointerId);
    const place = () => {
      card.style.transform = `translateY(${lastY - y0 + scrollY - s0}px)`;
      const r = card.getBoundingClientRect(),
        mid = (r.top + r.bottom) / 2;
      to = items.filter((x) => x !== card).filter((x) => {
        const q = x.getBoundingClientRect();
        return mid > (q.top + q.bottom) / 2;
      }).length;
      items.forEach((x) => x.classList.remove("drop-before", "drop-after"));
      const rest = items.filter((x) => x !== card);
      if (to !== from) to < rest.length ? rest[to].classList.add("drop-before") : rest.at(-1).classList.add("drop-after");
    };
    // Scroll while the finger is near the top or the bottom bar
    const edge = () => {
      const dy = lastY < 90 ? -14 : lastY > innerHeight - 130 ? 14 : 0;
      if (dy) {
        scrollBy(0, dy);
        place();
      }
      timer = requestAnimationFrame(edge);
    };
    timer = requestAnimationFrame(edge);
    const move = (ev) => {
      lastY = ev.clientY;
      place();
    };
    const up = () => {
      cancelAnimationFrame(timer);
      grip.removeEventListener("pointermove", move);
      items.forEach((x) => x.classList.remove("drop-before", "drop-after"));
      card.classList.remove("dragging");
      card.style.transform = "";
      if (to !== from) moveGroup(selectedDay, from, to);
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up, { once: true });
    grip.addEventListener("pointercancel", up, { once: true });
  });

  // 查全日交通: every leg without transport (or all of them, when asked) in one request: walks under 1.5 km by Google
  // Maps, trains and buses in Japan by NAVITIME timetables, the rest by the AI.
  const placeForAi = (s) => {
    const p = pointOf(s);
    return { name: s.title || s.name, address: s.target || s.address || "", ...(p ? { lat: p.lat, lng: p.lng } : {}) };
  };
  const legText = (l) =>
    l.source === "navitime"
      ? `${routeText(l, "TRANSIT")}（NAVITIME 班次）`
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
      done = Kit.busy($("#planToolsInfo"), { text: `正在查詢 ${legs.length} 段交通（步行用 Google 地圖，火車巴士用 NAVITIME 班次）…`, seconds: 10 + legs.length * 4 });
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
      `${Kit.sheetHead("AI 安排這天", `D${day}`)}<p class="note">AI 會按距離、營業時間、星期幾及用餐時間，排好次序、時間及每段交通，並提示休息日或趕不及的地方。看過結果才決定是否套用。</p><form class="tg-form" id="aiPlanForm" data-day="${day}"><label>出發時間<input name="start" type="time" value="${startAt}" required></label>${timed ? `<label class="tg-check"><input type="checkbox" name="keep"> 保留我已填的時間（例如已預約的餐廳）</label>` : ""}${Kit.btn("開始安排", { type: "submit", variant: "primary", icon: "sparkles", cls: "btn-block" })}</form><div id="aiPlanOut"></div>`,
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
          return `${leg ? `<li class="ai-plan-leg">${esc(legText(leg))}</li>` : ""}<li class="ai-plan-stop"><b>${esc(r.times[k] || "")}</b><span>${g.map((x) => esc(x.s.title)).join(" / ")}</span>${r.warnings[k] ? `<small class="stop-warn">${icon("clock")}<span>${esc(r.warnings[k])}</span></small>` : ""}</li>`;
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

  function planTools(stops) {
    return `<div class="plan-tools" role="toolbar" aria-label="安排這天">${[
      ["排順路", "route", "data-plan-order"],
      ["查全日交通", "train", "data-plan-routes"],
      ["AI 安排", "sparkles", "data-plan-ai"],
      ["推算時間", "clock", "data-plan-times"],
    ]
      .map(([label, ic, attr]) => Kit.btn(label, { size: "sm", variant: attr === "data-plan-ai" ? "secondary" : "outline", icon: ic, attrs: { [attr]: true, ...(stops.length < 2 && attr !== "data-plan-routes" ? { disabled: true } : {}) } }))
      .join("")}</div><p class="note" id="planToolsInfo" hidden></p>`;
  }
  document.addEventListener("click", (e) => {
    const el = e.target.closest("button");
    if (!el) return;
    const day = selectedDay;
    if (el.dataset.planInsert !== undefined) {
      const g = stopGroups(stopsFor(day))[Number(el.dataset.planInsert)];
      if (g) pickPlaceForPlan(day, null, g[0].i);
    }
    if (el.dataset.planOrder !== undefined) orderByDistance(day);
    if (el.dataset.planRoutes !== undefined) fillRoutes(day);
    if (el.dataset.planAi !== undefined) aiArrangeForm(day);
    if (el.dataset.planTimes !== undefined) {
      const after = retimed(stopsFor(day)),
        end = after.at(-1)?.time.match(/(\d{1,2}):(\d{2})\s*$/),
        late = end && (Number(end[1]) >= 22 || Number(end[1]) < 5);
      changeDay(day, after, late ? `已推算；最後一站 ${end[0]}，太夜了，可以考慮刪減` : "已按交通及停留時間推算（車站只計 5 分鐘）");
    }
    if (el.dataset.aiPlanApply !== undefined) applyAiPlan();
    if (el.dataset.aiPlanAgain !== undefined && aiPlan) aiArrange(aiPlan.day, $("#aiPlanForm")?.elements.keep?.checked, $("#aiPlanForm")?.elements.start?.value || "");
    if (el.dataset.ppAiAgain !== undefined) {
      ppAi = null;
      ppResults();
    }
  });
  document.addEventListener("submit", (e) => {
    if (e.target.id !== "aiPlanForm") return;
    e.preventDefault();
    aiArrange(Number(e.target.dataset.day), e.target.elements.keep?.checked, e.target.elements.start.value);
  });

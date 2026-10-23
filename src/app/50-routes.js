  // ---- 行程 links: getting from one stop to the next (Google routes and AI advice) ----
  // ---- Getting there: route suggestions from the previous stop (Google Routes API via the suggestRoutes function) ----
  const ROUTE_MODES = { TRANSIT: ["公共交通", "transit"], WALK: ["步行", "walking"], DRIVE: ["駕車", "driving"] };
  const VEHICLE_ICON = {
    SUBWAY: "🚇",
    METRO_RAIL: "🚇",
    HIGH_SPEED_TRAIN: "🚄",
    HEAVY_RAIL: "🚆",
    RAIL: "🚆",
    COMMUTER_TRAIN: "🚆",
    LONG_DISTANCE_TRAIN: "🚆",
    BUS: "🚌",
    INTERCITY_BUS: "🚌",
    TROLLEYBUS: "🚌",
    SHARE_TAXI: "🚐",
    TRAM: "🚊",
    LIGHT_RAIL: "🚊",
    MONORAIL: "🚝",
    FERRY: "⛴",
    CABLE_CAR: "🚡",
    GONDOLA_LIFT: "🚡",
    FUNICULAR: "🚞",
  };
  let routeCtx = null;
  // Where a stop is: its explore place's pin, its own coordinates, else its address text.
  function stopPoint(s) {
    const g = s.placeId && window.TRIP_GEO?.places?.[s.placeId]?.[0];
    if (g) return { lat: g.lat, lng: g.lng };
    if (Number.isFinite(s.lat) && Number.isFinite(s.lng)) return { lat: s.lat, lng: s.lng };
    const a = (s.target || `${s.title || ""} ${s.area || ""}`).trim();
    return a ? { address: a } : null;
  }
  const hotelPoint = (h) =>
    Number.isFinite(h.lat) && Number.isFinite(h.lng)
      ? { lat: h.lat, lng: h.lng }
      : { address: `${h.name} ${h.address || ""}`.trim() };
  const endClock = (t) => {
    const m =
      String(t || "").match(/(\d{1,2}):(\d{2})\s*[–~\-－至到]+\s*(\d{1,2}):(\d{2})/) ||
      String(t || "").match(/(\d{1,2}):(\d{2})/);
    return m ? (m[3] ? `${m[3].padStart(2, "0")}:${m[4]}` : `${m[1].padStart(2, "0")}:${m[2]}`) : "";
  };
  const fareText = (o) =>
    o.fare
      ? window.Split.currencies[o.fare.currency]
        ? window.Split.format(window.Split.toMinor(o.fare.amount, o.fare.currency), o.fare.currency)
        : `${o.fare.currency} ${o.fare.amount}`
      : "";
  function routeText(o, mode) {
    const km = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} 公里` : `${m} 米`);
    if (mode !== "TRANSIT") return `${mode === "WALK" ? "🚶 步行" : "🚗 駕車"}約 ${o.minutes} 分（${km(o.meters)}）`;
    const fare = fareText(o);
    return `${o.steps.map((s) => (s.mode === "TRANSIT" ? `${VEHICLE_ICON[s.vehicle] || "🚉"} ${s.line} ${s.from} → ${s.to}（${s.stops ? `${s.stops} 站，` : ""}${s.depart}${s.arrive ? `–${s.arrive}` : ""}）` : `🚶 ${s.minutes} 分`)).join(" → ")}｜約 ${o.minutes} 分${fare ? ` · ${fare}` : ""}`;
  }
  // The link between two time slots on the plan: a dot on the timeline with the chosen way to get to the next slot.
  // Trips with hotels also get a link before the first slot, from the hotel.
  const hotelLink = () => lists().hotels.length > 0;
  function stopLink(all, n) {
    const prev = all[n - 1],
      next = all[n],
      multi = next.length > 1;
    // One line per choice, total time first ("約 14 分 · ¥180 · 🚶 2 分 → 🚇 …"); long routes end in "…".
    const short = (t) => {
      const [steps, total] = String(t).split("｜");
      return total ? `${total.trim()} · ${steps.trim()}` : String(t);
    };
    const lines = next.filter(({ s }) => s.transport).map(({ s }) => `<span class="route-line">${multi ? `${esc(s.title)}：` : ""}${esc(short(s.transport))}</span>`);
    return `<div class="stop-link"><div></div><button type="button" class="route-dot${lines.length ? " has-route" : ""}" data-route-link="${n}" aria-label="${prev ? esc(prev[0].s.title) : "酒店"} 至 ${esc(next[0].s.title)} 的交通"><i aria-hidden="true"></i><span>${lines.length ? lines.join("") : `${icon(prev ? "train" : "bed")}${prev ? "查交通" : "由酒店出發 · 查交通"}`}</span></button></div>`;
  }
  function routeDialog(day, i, fromGroup = null, toGroup = null) {
    const list = stopsFor(day),
      to = list[i];
    if (!to) return;
    const groups = stopGroups(list),
      gi = groups.findIndex((g) => g.some((x) => x.i === i)),
      earlier = groups.slice(0, gi).flat().reverse();
    // Leave from the slot just above first (all its choices), then anything earlier, then the hotels.
    const first = fromGroup || (gi > 0 ? groups[gi - 1] : []),
      rest = earlier.filter((x) => !first.includes(x));
    const hs = lists().hotels,
      nightBefore = days[day - 2]?.hotel || days[day - 1]?.hotel;
    const origins = [...first, ...rest]
      .map(({ s, i: k }) => ({
        key: "s" + k,
        label: `${s.time ? s.time + " " : ""}${s.title}`,
        name: s.title,
        address: s.target || "",
        point: stopPoint(s),
        time: endClock(s.time),
      }))
      .concat(
        hs.map((h) => ({
          key: "h" + h.id,
          label: `🏨 ${h.name}`,
          name: h.name,
          address: h.address || "",
          point: hotelPoint(h),
          time: "",
        })),
      )
      .filter((o) => o.point);
    const night = hs.find((h) => h.name === nightBefore),
      def = first.length ? "s" + first[0].i : night ? "h" + night.id : origins[0]?.key;
    const dests = (toGroup || groups[gi] || []).map((x) => x.i);
    routeCtx = { day, i, origins, mode: "TRANSIT" };
    const start = origins.find((o) => o.key === def)?.time || "";
    openDialog(
      `<div class="eyebrow">GETTING THERE · DAY ${day}</div><h2 class="detailtitle" id="routeTitle">前往 ${esc(to.title)}</h2>${dests.length > 1 ? `<div class="tg-form route-form"><label>目的地（同一時間有 ${dests.length} 個選擇）<select id="routeTo">${dests.map((k) => `<option value="${k}"${k === i ? " selected" : ""}>${esc(list[k].title)}</option>`).join("")}</select></label></div>` : ""}${
        origins.length
          ? `<div class="tg-form route-form"><label>出發地<select id="routeFrom">${origins.map((o) => `<option value="${esc(o.key)}"${o.key === def ? " selected" : ""}>${esc(o.label)}</option>`).join("")}</select></label><div class="tg-row"><label>出發時間<input id="routeTime" type="time" value="${esc(start || "09:00")}"></label><label>方式<select id="routeMode">${Object.entries(
              ROUTE_MODES,
            )
              .map(([k, [v]]) => `<option value="${k}">${v}</option>`)
              .join(
                "",
              )}</select></label></div><button type="button" class="locate-button" id="routeGo">查詢路線建議</button></div><div id="routeResults" class="route-results"></div><div id="routeAi" class="route-results"></div>`
          : '<p class="note">這天前面沒有站點，亦未有住宿資料，未能查詢路線；可以自行填寫。</p>'
      }<form class="tg-form" id="routeManual"><label>交通（可自行修改）<textarea name="transport" rows="3" maxlength="500" placeholder="例如：地下鐵空港線 博多 → 天神，約 5 分">${esc(to.transport || "")}</textarea></label><button type="submit" class="action primary">儲存交通</button></form>`,
    );
  }
  async function runRoutes() {
    const c = routeCtx,
      box = $("#routeResults");
    if (!c || !box) return;
    const from = c.origins.find((o) => o.key === $("#routeFrom").value),
      to = stopsFor(c.day)[c.i],
      dest = stopPoint(to),
      mode = $("#routeMode").value,
      time = $("#routeTime").value || "09:00";
    c.mode = mode;
    const gm = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(from.point.address || `${from.point.lat},${from.point.lng}`)}&destination=${encodeURIComponent(dest.address || `${dest.lat},${dest.lng}`)}&travelmode=${ROUTE_MODES[mode][1]}`;
    const gmLink = `<a class="action" href="${gm}" target="_blank" rel="noopener">在 Google 地圖查看 ↗</a><button type="button" class="action primary" data-route-ai>✨ AI 分析</button>`;
    c.ai = { from, to, dest, time };
    if (mode === "TRANSIT" && meta.country === "JP") {
      box.innerHTML = `<div class="notice">Google 不向其他網站提供日本的公共交通路線，只可以在 Google 地圖 App 內查看。請按下面按鈕查看，揀好路線後在下面「交通」填寫；步行和駕車可以直接在這裡查詢。</div><div class="links">${gmLink}</div>`;
      return;
    }
    box.innerHTML = '<p class="note">正在查詢 Google 地圖…</p>';
    try {
      const r = await window.Together.suggestRoutes({
        origin: from.point,
        destination: dest,
        mode,
        country: meta.country || "",
        time: `${isoDash(days[c.day - 1])}T${time}`,
      });
      c.options = r.options;
      box.innerHTML = r.options.length
        ? `${r.estimated ? '<p class="note">行程日期太遠或已過，班次按下一個相同星期的時間估算，出發前請再確認。</p>' : ""}${r.options.map((o, k) => `<div class="route-option"><div class="route-head"><b>約 ${o.minutes} 分</b>${o.fare ? `<span>${esc(fareText(o))}</span>` : ""}${mode === "TRANSIT" && o.steps.find((s) => s.mode === "TRANSIT") ? `<span>${esc(o.steps.find((s) => s.mode === "TRANSIT").depart)} 開出</span>` : ""}</div><ol class="route-steps">${mode === "TRANSIT" ? o.steps.map((s) => (s.mode === "TRANSIT" ? `<li><b>${VEHICLE_ICON[s.vehicle] || "🚉"} ${esc(s.line)}</b>${s.headsign ? ` <small>往 ${esc(s.headsign)}</small>` : ""}<div>${esc(s.from)} → ${esc(s.to)}${s.stops ? ` · ${s.stops} 站` : ""} · ${esc(s.depart)}–${esc(s.arrive)}</div></li>` : `<li>🚶 步行 ${s.minutes} 分</li>`)).join("") : `<li>${esc(routeText(o, mode))}</li>`}</ol><button type="button" class="action primary" data-route-pick="${k}">選用這個</button></div>`).join("")}<div class="links">${gmLink}</div>`
        : `<p class="note">Google 地圖找不到${ROUTE_MODES[mode][0]}路線。</p><div class="links">${gmLink}</div>`;
    } catch (e) {
      box.innerHTML = `<p class="note">${esc(fnError(e, "未能查詢路線，請檢查網絡後再試。"))}</p><div class="links">${gmLink}</div>`;
    }
  }
  // AI route advice (aiRoutes function): several ways with lines and stations, times and fares are estimates.
  const AI_MODE_ICON = { WALK: "🚶", TAXI: "🚕", DRIVE: "🚗" };
  const aiStep = (s) =>
    s.mode === "TRANSIT"
      ? `${VEHICLE_ICON[s.vehicle] || "🚉"} ${s.line}${s.from || s.to ? ` ${s.from} → ${s.to}` : ""}${s.minutes ? `（約 ${s.minutes} 分）` : ""}`
      : `${AI_MODE_ICON[s.mode] || "🚶"} ${s.mode === "WALK" ? "步行" : s.mode === "TAXI" ? "的士" : "駕車"} ${s.minutes} 分`;
  const aiRouteText = (o) =>
    `${o.title ? o.title + "：" : ""}${o.steps.map(aiStep).join(" → ")}｜約 ${o.minutes} 分${o.fare ? ` · ${fareText(o)}` : ""}（AI 估算）`;
  async function runAiRoutes() {
    const c = routeCtx,
      box = $("#routeAi");
    if (!c?.ai || !box) return;
    const { from, to, dest, time } = c.ai;
    box.innerHTML = '<div class="route-ai-wait"><b>✨ AI 正在考慮路線…</b><p class="note">大約需要 10–30 秒。</p></div>';
    box.scrollIntoView({ block: "nearest", behavior: "smooth" });
    try {
      const r = await window.Together.aiRoutes({
        origin: {
          name: from.name,
          address: from.address || from.point.address || "",
          ...(from.point.lat != null ? { lat: from.point.lat, lng: from.point.lng } : {}),
        },
        destination: {
          name: to.title,
          address: to.target || "",
          region: meta.destination || days[c.day - 1].region || "",
          ...(dest.lat != null ? { lat: dest.lat, lng: dest.lng } : {}),
        },
        time: `${isoDash(days[c.day - 1])}T${time}`,
        currency: meta.currency || "JPY",
      });
      c.aiOptions = r.options;
      box.innerHTML = r.options.length
        ? `<div class="route-ai-head"><b>✨ AI 建議</b>${r.advice ? `<p>${esc(r.advice)}</p>` : ""}<p class="note">由 AI 按一般情況估算，班次、時間及車費可能不準，出發前請用 Google 地圖或車站資料確認。</p></div>${r.options.map((o, k) => `<div class="route-option ai"><div class="route-head"><b>${esc(o.title || `方案 ${k + 1}`)}</b><span class="ai-sure ${esc(o.confidence || "low")}">${{ high: "把握：高", medium: "把握：中", low: "把握：低，請核對" }[o.confidence] || "把握：低，請核對"}</span><span>約 ${o.minutes} 分</span>${o.fare ? `<span>${esc(fareText(o))}</span>` : ""}</div><ol class="route-steps">${o.steps.map((s) => `<li>${esc(aiStep(s))}</li>`).join("")}</ol>${o.note ? `<p class="note">${esc(o.note)}</p>` : ""}<button type="button" class="action primary" data-route-ai-pick="${k}">選用這個</button></div>`).join("")}`
        : '<p class="note">AI 未能提供路線建議。</p>';
    } catch (e) {
      box.innerHTML = `<p class="note">${esc(fnError(e, "未能進行 AI 分析，請檢查網絡後再試。"))}</p>`;
    }
  }
  function saveTransport(text) {
    const c = routeCtx;
    if (!c) return;
    const list = [...stopsFor(c.day)];
    if (!list[c.i]) return;
    list[c.i] = { ...list[c.i], transport: String(text).trim().slice(0, 500) };
    savePlan(c.day, list);
    toast("已儲存交通");
  }
  document.addEventListener("change", (e) => {
    if (e.target.id !== "routeTo" || !routeCtx) return;
    const i = Number(e.target.value),
      s = stopsFor(routeCtx.day)[i];
    if (!s) return;
    routeCtx.i = i;
    routeCtx.options = null;
    $("#routeTitle").textContent = `前往 ${s.title}`;
    $("#routeManual textarea").value = s.transport || "";
    $("#routeResults").innerHTML = "";
    $("#routeAi").innerHTML = "";
    routeCtx.ai = null;
  });
  document.addEventListener("submit", (e) => {
    if (e.target.id !== "routeManual") return;
    e.preventDefault();
    saveTransport(e.target.elements.transport.value);
    $("#detail").close();
  });
  document.addEventListener("click", (e) => {
    if (e.target.closest("#routeGo")) runRoutes();
    if (e.target.closest("[data-route-ai]")) runAiRoutes();
    const aiPick = e.target.closest("[data-route-ai-pick]");
    if (aiPick && routeCtx?.aiOptions) {
      const k = Number(aiPick.dataset.routeAiPick),
        text = aiRouteText(routeCtx.aiOptions[k]),
        ta = $("#routeManual textarea");
      if (ta) ta.value = text;
      saveTransport(text);
      document
        .querySelectorAll(".route-option")
        .forEach((o) => o.classList.toggle("picked", o === aiPick.closest(".route-option")));
    }
    const pick = e.target.closest("[data-route-pick]");
    if (pick && routeCtx?.options) {
      const text = routeText(routeCtx.options[Number(pick.dataset.routePick)], routeCtx.mode),
        ta = $("#routeManual textarea");
      if (ta) ta.value = text;
      saveTransport(text);
      document
        .querySelectorAll(".route-option")
        .forEach((o, k) => o.classList.toggle("picked", k === Number(pick.dataset.routePick)));
    }
  });

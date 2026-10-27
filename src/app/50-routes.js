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
    return `${o.steps.map((s) => (s.mode === "TRANSIT" ? `${VEHICLE_ICON[s.vehicle] || "🚉"} ${s.line} ${s.from} → ${s.to}（${s.stops ? `${s.stops} 站，` : ""}${s.approx ? "約 " : ""}${s.depart}${s.arrive ? `–${s.arrive}` : ""}${s.platform ? `，${s.platform}` : ""}）` : `🚶 ${s.minutes} 分`)).join(" → ")}｜約 ${o.minutes} 分${fare ? ` · ${fare}` : ""}`;
  }
  // 查實際班次: NAVITIME's times are estimates without train numbers, so each train in a saved way ("🚆 ソニック 博多 →
  // 別府（約 08:14–10:27）") links to Yahoo!乗換案内 for that station pair, day and time: real trains, numbers, platforms.
  // Rail legs only: Yahoo resolves bus stop names to the wrong place (二見ヶ浦 → 三重県の二見浦).
  function trainChecks(text, day) {
    const d = days[day - 1];
    if (meta.country !== "JP" || !d) return "";
    const [y, m, dd] = isoDash(d).split("-"),
      seen = new Set();
    const links = [...String(text).matchAll(/(?:^|→ )[🚆🚄🚇🚃🚅🚈🚝🚞]\uFE0F? ([^→]+?) (\S+) → (\S+)（(?:\d+ 站，)?(?:約 )?(\d{1,2}):(\d{2})/gu)]
      .filter(([, , from, to]) => !seen.has(from + to) && seen.add(from + to))
      .map(([, line, from, to, hh, mi]) =>
        Kit.btn(`查班次：${from} → ${to}`, {
          href: `https://transit.yahoo.co.jp/search/result?${new URLSearchParams({ from, to, y, m, d: dd, hh: hh.padStart(2, "0"), m1: mi[0], m2: mi[1], type: "1" })}`,
          external: true,
          size: "sm",
          variant: "ghost",
          icon: "train",
          attrs: { title: `${line}：在 Yahoo!乗換案内查看實際班次、列車號數及月台` },
        }),
      );
    return links.length ? `<p class="route-checks">${links.join("")}</p>` : "";
  }
  // Google's own directions by public transport, in an embedded map (Maps Embed API: Japan's trains and buses are only
  // there and in Google Maps itself, not in the routes APIs). No departure time can be set, so Google shows its usual way.
  const placeArg = (p) => (p ? (Number.isFinite(p.lat) && Number.isFinite(p.lng) ? `${p.lat},${p.lng}` : p.address || p.name || "") : "");
  async function transitFrame(box, from, to) {
    if (!box) return;
    box.innerHTML = Kit.dots("正在載入 Google 交通指引…");
    let key;
    try {
      key = await window.Together.embedKey();
    } catch (e) {
      box.innerHTML = `<p class="note">${esc(e.message === "offline" ? "離線中，有網絡時再試。" : fnError(e, "暫時未能載入 Google 交通指引，請稍後再試。"))}</p>`;
      return;
    }
    if (!box.isConnected) return;
    const o = placeArg(from),
      d = placeArg(to),
      q = new URLSearchParams({ key, origin: o, destination: d, mode: "transit", language: "zh-TW", ...(meta.country ? { region: meta.country } : {}) }),
      gm = `https://www.google.com/maps/dir/?${new URLSearchParams({ api: "1", origin: o, destination: d, travelmode: "transit" })}`;
    box.innerHTML = `<iframe class="transit-frame" title="Google 交通指引" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen src="https://www.google.com/maps/embed/v1/directions?${q}"></iframe><p class="note transit-note">Google 地圖建議的大眾運輸路線，按 Google 預設的出發時間，未必是行程的時間。${Kit.btn("在 Google 地圖看班次", { href: gm, external: true, size: "sm", variant: "ghost", icon: "map" })}</p>`;
  }
  // The link between two time slots on the plan: a dot on the timeline with the chosen way to get to the next slot.
  // The day starts at last night's hotel (from 住宿) unless its first stop is a hotel: shown above the first stop,
  // not saved, so it follows 住宿; the way from it is the first stop's transport.
  const startStop = (h) =>
    `<div class="stop stop-start"><div class="start-time">出發</div><div class="stop-alts"><div class="card stopcontent"><div class="card-top stop-top"><span class="eyebrow">起點 / 住宿</span></div><p class="start-title">${icon("bed")}<a href="#hotels">${esc(h.name)}</a></p><small class="note">按「住宿」的入住日子自動顯示</small></div></div></div>`;
  function stopLink(all, n, from = null) {
    const prev = all[n - 1],
      next = all[n],
      multi = next.length > 1;
    // The whole way, shown in full: the total time and fare first, then one line per step ("🚄 ひかり 博多 → 小倉（08:15–08:33）").
    const legHtml = (t) => {
      const [steps, total] = String(t).split("｜");
      const parts = total ? steps.split(/ → (?=\p{Extended_Pictographic})/u) : [String(t)];
      return `${total ? `<b class="route-total">${esc(total.trim())}</b>` : ""}${parts.map((p) => `<span class="route-step">${esc(p.trim())}</span>`).join("")}`;
    };
    const lines = next.filter(({ s }) => s.transport).map(({ s }) => `<span class="route-line">${multi ? `<b class="route-for">${esc(s.title)}</b>` : ""}${legHtml(s.transport)}</span>`);
    return `<div class="stop-link"><div class="link-side">${Kit.btn("在這裡加入地點", { size: "sm", variant: "ghost", icon: "plus", iconOnly: true, cls: "link-add", attrs: { "data-plan-insert": n } })}</div><button type="button" class="route-dot${lines.length ? " has-route" : ""}" data-route-link="${n}" aria-label="${esc(prev ? prev[0].s.title : from.name)} 至 ${esc(next[0].s.title)} 的交通"><i aria-hidden="true"></i><span>${lines.length ? lines.join("") : `${icon("train")}查交通`}</span></button>${trainChecks(next.map(({ s }) => s.transport || "").join("\n"), selectedDay)}</div>`;
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
    routeCtx = { day, i, origins };
    const start = origins.find((o) => o.key === def)?.time || "";
    openDialog(
      `<div class="eyebrow">交通 · D${day}</div><h2 class="detailtitle" id="routeTitle">前往 ${esc(to.title)}</h2>${dests.length > 1 ? `<div class="tg-form route-form"><label>目的地（同一時間有 ${dests.length} 個選擇）<select id="routeTo">${dests.map((k) => `<option value="${k}"${k === i ? " selected" : ""}>${esc(list[k].title)}</option>`).join("")}</select></label></div>` : ""}${
        origins.length
          ? `<div class="tg-form route-form"><label>出發地<select id="routeFrom">${origins.map((o) => `<option value="${esc(o.key)}"${o.key === def ? " selected" : ""}>${esc(o.label)}</option>`).join("")}</select></label><div class="tg-row"><label>出發時間<input id="routeTime" type="time" value="${esc(start || "09:00")}"></label><fieldset class="route-modes"><legend>方式（可選多個）</legend>${Object.entries(ROUTE_MODES).map(([k, [v]]) => `<label class="tg-check"><input type="checkbox" name="routeMode" value="${k}"${k === "TRANSIT" ? " checked" : ""}> ${v}</label>`).join("")}</fieldset></div><div class="route-actions">${Kit.btn("查路線", { variant: "primary", size: "sm", icon: "route", attrs: { id: "routeGo", title: "查詢路線建議" } })}${Kit.btn("Google", { href: "#", external: true, size: "sm", icon: "map", attrs: { id: "routeGm", title: "在 Google 地圖查看" } })}${meta.country === "JP" ? Kit.btn("Yahoo", { href: "#", external: true, size: "sm", icon: "train", attrs: { id: "routeYahoo", title: "Yahoo!乗換案内：實際班次" } }) : ""}${Kit.btn("AI 分析", { size: "sm", icon: "sparkles", attrs: { "data-route-ai": true } })}</div>${Kit.btn("Google 交通指引", { size: "sm", variant: "ghost", icon: "train", cls: "route-embed-btn", attrs: { "data-route-embed": true } })}<div id="routeEmbed"></div></div><div id="routeResults" class="route-results"></div><div id="routeAi" class="route-results"></div>`
          : '<p class="note">這天前面沒有站點，亦未有住宿資料，未能查詢路線；可以自行填寫。</p>'
      }<form class="tg-form" id="routeManual"><label>交通（可自行修改）<textarea name="transport" rows="3" maxlength="500" placeholder="例如：地下鐵空港線 博多 → 天神，約 5 分">${esc(to.transport || "")}</textarea></label>${Kit.btn("儲存交通", { type: "submit", variant: "secondary" })}</form>`,
    );
    routeLinks();
  }
  // The dialog's current from, to, time and way, with the Google Maps and Yahoo!乗換案内 links for them
  function routeInputs() {
    const c = routeCtx,
      from = c?.origins.find((o) => o.key === $("#routeFrom")?.value),
      to = c && stopsFor(c.day)[c.i],
      dest = to && stopPoint(to);
    if (!from || !dest) return null;
    // the ways ticked (公共交通 when none is); the Google Maps link uses the first
    const modes = [...document.querySelectorAll("[name=routeMode]:checked")].map((x) => x.value),
      mode = modes[0] || "TRANSIT",
      time = $("#routeTime").value || "09:00",
      [yy, mo, dd] = isoDash(days[c.day - 1]).split("-"),
      [hh, mi] = time.split(":");
    return {
      from,
      to,
      dest,
      mode,
      modes: modes.length ? modes : [mode],
      time,
      gm: `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(from.point.address || `${from.point.lat},${from.point.lng}`)}&destination=${encodeURIComponent(dest.address || `${dest.lat},${dest.lng}`)}&travelmode=${ROUTE_MODES[mode][1]}`,
      // the timetable in the browser, with the names, date and time filled in
      yahoo: `https://transit.yahoo.co.jp/search/result?${new URLSearchParams({ from: from.name, to: to.title, y: yy, m: mo, d: dd, hh, m1: mi[0], m2: mi[1], type: "1" })}`,
    };
  }
  function routeLinks() {
    const r = routeInputs();
    if (!r) return;
    $("#routeGm").href = r.gm;
    const y = $("#routeYahoo");
    if (y) {
      y.href = r.yahoo;
      y.hidden = !r.modes.includes("TRANSIT");
    }
  }
  document.addEventListener("click", (e) => {
    if (!e.target.closest("[data-route-embed]")) return;
    const r = routeInputs();
    if (r) transitFrame($("#routeEmbed"), { ...r.from.point, name: r.from.name }, r.dest);
  });
  document.addEventListener("change", (e) => {
    if (["routeFrom", "routeTime", "routeTo"].includes(e.target.id) || e.target.name === "routeMode") routeLinks();
  });
  // Each way ticked is asked for in turn and shown under its own heading; 選用這個 keeps that way's text.
  async function runRoutes() {
    const c = routeCtx,
      box = $("#routeResults"),
      r0 = routeInputs();
    if (!c || !box || !r0) return;
    const { from, to, dest, modes, time } = r0;
    box.innerHTML = Kit.progress({ text: "正在查詢 Google 地圖…", seconds: 6 * modes.length });
    c.options = [];
    const parts = [];
    let noTransit = false;
    for (const mode of modes) {
      let html;
      try {
        const r = await window.Together.suggestRoutes({
          origin: from.point,
          destination: dest,
          // for Yahoo!乗換案内 (Japan): names and addresses, which it finds door to door
          originName: from.name,
          originText: from.address || "",
          destinationName: to.title,
          destinationText: to.target || "",
          mode,
          country: meta.country || "",
          time: `${isoDash(days[c.day - 1])}T${time}`,
        });
        const base = c.options.length;
        c.options.push(...r.options.map((o) => ({ o, mode })));
        html = r.options.length
          ? `${r.source === "yahoo" ? '<p class="note">班次、月台及車費由 Yahoo!乗換案内 提供（實際時刻表，包括巴士及渡輪）；出發前可按「Yahoo」再看一次。</p>' : ""}${r.source === "navitime" ? '<p class="note">火車路線及車費由 NAVITIME 提供（車費＝車票＋自由席特急料金），時間按平均行車時間估算，沒有列車號數：實際班次請按上面的「Yahoo」（Yahoo!乗換案内）。不包括巴士，搭巴士較方便時請按「AI 分析」。</p>' : ""}${r.estimated ? '<p class="note">行程日期太遠或已過，班次按下一個相同星期的時間估算，出發前請再確認。</p>' : ""}${r.options.map((o, k) => `<div class="card route-option"><div class="route-head"><b>約 ${o.minutes} 分</b>${o.fare ? `<span>${esc(fareText(o))}</span>` : ""}${mode === "TRANSIT" && o.steps.find((s) => s.mode === "TRANSIT") ? `<span>${o.steps.find((s) => s.mode === "TRANSIT").approx ? "約 " : ""}${esc(o.steps.find((s) => s.mode === "TRANSIT").depart)} 開出</span>` : ""}</div><ol class="route-steps">${mode === "TRANSIT" ? o.steps.map((s) => (s.mode === "TRANSIT" ? `<li><b>${VEHICLE_ICON[s.vehicle] || "🚉"} ${esc(s.line)}</b>${s.headsign ? ` <small>往 ${esc(s.headsign)}</small>` : ""}<div>${esc(s.from)} → ${esc(s.to)}${s.stops ? ` · ${s.stops} 站` : ""} · ${s.approx ? "約 " : ""}${esc(s.depart)}–${esc(s.arrive)}${s.platform ? ` · ${esc(s.platform)}` : ""}</div></li>` : `<li>🚶 步行 ${s.minutes} 分</li>`)).join("") : `<li>${esc(routeText(o, mode))}</li>`}</ol>${Kit.btn("選用這個", { variant: "secondary", size: "sm", icon: "check", attrs: { "data-route-pick": base + k } })}</div>`).join("")}`
          : mode === "TRANSIT"
            ? `<p class="note">${meta.country === "JP" ? "這段沒有方便的火車，多數要搭巴士。下面是 Google 地圖的交通指引（有巴士）；亦可以按「AI 分析」或「Yahoo」。" : "Google 地圖找不到公共交通路線，下面是 Google 地圖的交通指引。"}</p>`
            : `<p class="note">Google 地圖找不到${ROUTE_MODES[mode][0]}路線。</p>`;
        if (mode === "TRANSIT" && !r.options.length) noTransit = true;
      } catch (e) {
        html = `<p class="note">${esc(fnError(e, "未能查詢路線，請檢查網絡後再試。"))}</p>`;
      }
      parts.push(modes.length > 1 ? `<h3 class="route-mode-head">${ROUTE_MODES[mode][0]}</h3>${html}` : html);
      if (routeCtx !== c || !$("#routeResults")) return;
    }
    box.innerHTML = parts.join("");
    // no train or bus found: Google's own directions (which have the buses) open by themselves
    if (noTransit && !$("#routeEmbed iframe")) transitFrame($("#routeEmbed"), { ...from.point, name: from.name }, dest);
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
    const r0 = routeInputs();
    if (!c || !box || !r0) return;
    const { from, to, dest, time } = r0;
    box.innerHTML = `<div class="route-ai-wait"><b>${icon("sparkles")} AI 正在考慮路線…</b>${Kit.progress({ text: "大約需要 10–30 秒。", seconds: 25 })}</div>`;
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
        ? `<div class="route-ai-head"><b>${icon("sparkles")} AI 建議</b>${r.advice ? `<p>${esc(r.advice)}</p>` : ""}<p class="note">由 AI 按一般情況估算，班次、時間及車費可能不準，出發前請用 Google 地圖或車站資料確認。</p></div>${r.options.map((o, k) => `<div class="card route-option ai"><div class="route-head"><b>${esc(o.title || `方案 ${k + 1}`)}</b><span class="ai-sure ${esc(o.confidence || "low")}">${{ high: "把握：高", medium: "把握：中", low: "把握：低，請核對" }[o.confidence] || "把握：低，請核對"}</span><span>約 ${o.minutes} 分</span>${o.fare ? `<span>${esc(fareText(o))}</span>` : ""}</div><ol class="route-steps">${o.steps.map((s) => `<li>${esc(aiStep(s))}</li>`).join("")}</ol>${o.note ? `<p class="note">${esc(o.note)}</p>` : ""}${Kit.btn("選用這個", { variant: "secondary", size: "sm", icon: "check", attrs: { "data-route-ai-pick": k } })}</div>`).join("")}`
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
  // 選用這個: the suggestion becomes the leg's 交通 and its card is marked
  function useRoute(text, btn) {
    const ta = $("#routeManual textarea");
    if (ta) ta.value = text;
    saveTransport(text);
    document.querySelectorAll(".route-option").forEach((o) => o.classList.toggle("picked", o === btn.closest(".route-option")));
  }
  document.addEventListener("click", (e) => {
    if (e.target.closest("#routeGo")) runRoutes();
    if (e.target.closest("[data-route-ai]")) runAiRoutes();
    const aiPick = e.target.closest("[data-route-ai-pick]");
    if (aiPick && routeCtx?.aiOptions) {
      useRoute(aiRouteText(routeCtx.aiOptions[Number(aiPick.dataset.routeAiPick)]), aiPick);
    }
    const pick = e.target.closest("[data-route-pick]");
    if (pick && routeCtx?.options) {
      const { o, mode } = routeCtx.options[Number(pick.dataset.routePick)];
      useRoute(routeText(o, mode), pick);
    }
  });

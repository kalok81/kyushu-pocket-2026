  // ---- 行程 (plan): day stops, the stop form and the in-page place picker ----
  // Each day's plan lives in Firestore planDays/{day}: the stop list and the day's title, plus other 方案 of the day
  // (variants: [{id, name, stops}], the main one named mainName). The plan page shows the 方案 picked in planView and its
  // tools change that one; every other page (overview, hotels, notebook) uses the main one.
  let planEdits = {},
    planView = {};
  const variantsOf = (day) => planEdits[day]?.variants || [];
  const viewedVariant = (day) => (current === "plan" && planView[day] && variantsOf(day).find((v) => v.id === planView[day])) || null;
  const mainName = (day) => planEdits[day]?.mainName || "方案 1";
  // A stop for an explore place or a hotel shows that place's current name, area, details and address, so editing the
  // place in 探索 (or the hotel in 住宿) updates every stop; the copy saved in the stop is only a fallback.
  function resolveStop(s) {
    const p = s.placeId && places.find((x) => x.id === s.placeId);
    if (p)
      return {
        ...s,
        title: p.v[1],
        area: areaOf(p) || p.v[0],
        detail: p.v[4],
        target: `${p.v[1]} ${p.v[3]}`.trim(),
        ref: urlList(p.v[10])[0] || "",
        linked: "place",
      };
    const h = s.hotelId && lists().hotels.find((x) => x.id === s.hotelId);
    if (h)
      return {
        ...s,
        title: h.name,
        area: "住宿",
        detail: h.address || "",
        target: `${h.name} ${h.address || ""}`.trim(),
        ...(Number.isFinite(h.lat) ? { lat: h.lat, lng: h.lng } : {}),
        linked: "hotel",
      };
    return s;
  }
  const stopsFor = (day) => ((viewedVariant(day) || planEdits[day])?.stops || []).map(resolveStop);
  const stopFields = (s) => ({
    time: String(s.time || "").slice(0, 30),
    area: String(s.area || "").slice(0, 60),
    title: String(s.title || "").slice(0, 80),
    detail: String(s.detail || "").slice(0, 1000),
    transport: String(s.transport || "").slice(0, 500),
    ref: String(s.ref || "").slice(0, 500),
    target: String(s.target || "").slice(0, 200),
    placeId: String(s.placeId || "").slice(0, 40),
    ...(s.warn ? { warn: String(s.warn).slice(0, 80) } : {}),
    ...(s.note ? { note: String(s.note).slice(0, 500) } : {}),
    ...(s.manual ? { manual: true } : {}),
    ...(s.hotelId ? { hotelId: String(s.hotelId).slice(0, 40) } : {}),
    ...(Number.isFinite(s.lat) && Number.isFinite(s.lng) ? { lat: s.lat, lng: s.lng } : {}),
  });
  const startMinute = (t) => {
    const m = String(t).match(/(\d{1,2}):(\d{2})/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  function insertByTime(list, stop) {
    const t = startMinute(stop.time);
    if (t == null) return [...list, stop];
    const i = list.findIndex((s) => {
      const u = startMinute(s.time);
      return u != null && u > t;
    });
    return i < 0 ? [...list, stop] : [...list.slice(0, i), stop, ...list.slice(i)];
  }
  function savePlan(day, stops) {
    const v = viewedVariant(day);
    if (v) saveVariants(day, variantsOf(day).map((x) => (x === v ? { ...x, stops: stops.map(stopFields) } : x)));
    else {
      planEdits = { ...planEdits, [day]: { ...planEdits[day], stops } };
      window.Together.savePlanDay(day, stops.map(stopFields));
    }
    if (current === "plan") refreshPlan();
  }
  // 方案: the day's main stops stay as they are; only the variants (and the main one's name) change
  function saveVariants(day, variants, extra = {}) {
    const main = planEdits[day]?.stops || [];
    planEdits = { ...planEdits, [day]: { ...planEdits[day], variants, mainName: mainName(day), ...extra } };
    window.Together.savePlanDay(day, main.map(stopFields), { variants, mainName: mainName(day), ...extra });
  }
  async function newVariant(day) {
    const vs = variantsOf(day);
    if (vs.length >= 8) return toast("每天最多 9 個方案。");
    const name = await UI.prompt("新方案的名稱", `方案 ${vs.length + 2}`, "例如：早一班火車");
    if (name == null || !name.trim()) return;
    // a copy of the 方案 on screen, to change without touching it
    const v = { id: Date.now().toString(36), name: name.trim().slice(0, 30), stops: stopsFor(day).map(stopFields) };
    saveVariants(day, [...vs, v]);
    planView = { ...planView, [day]: v.id };
    refreshPlan();
    toast(`已建立「${v.name}」，現在修改的是這個方案`);
  }
  async function renameVariant(day) {
    const v = viewedVariant(day),
      name = await UI.prompt("方案名稱", v ? v.name : mainName(day));
    if (name == null || !name.trim()) return;
    const n = name.trim().slice(0, 30);
    if (v) saveVariants(day, variantsOf(day).map((x) => (x === v ? { ...x, name: n } : x)));
    else saveVariants(day, variantsOf(day), { mainName: n });
    refreshPlan();
  }
  // 設為主要: the 方案 on screen and the main one trade places (the other pages then use it)
  function makeMainVariant(day) {
    const v = viewedVariant(day);
    if (!v) return;
    const old = { id: v.id, name: mainName(day), stops: (planEdits[day]?.stops || []).map(stopFields) },
      variants = variantsOf(day).map((x) => (x === v ? old : x));
    planEdits = { ...planEdits, [day]: { ...planEdits[day], stops: v.stops, variants, mainName: v.name } };
    window.Together.savePlanDay(day, v.stops, { variants, mainName: v.name });
    planView = { ...planView, [day]: null };
    refreshPlan();
    toast(`「${v.name}」已設為主要方案`);
  }
  async function deleteVariant(day) {
    const v = viewedVariant(day);
    if (!v || !(await UI.confirm(`刪除「${v.name}」？`, { text: "主要方案及其他方案不受影響。", danger: true, ok: "刪除" }))) return;
    saveVariants(day, variantsOf(day).filter((x) => x !== v));
    planView = { ...planView, [day]: null };
    refreshPlan();
  }
  // The day's 方案 as chips above the timeline (only once there is more than one)
  function variantChips(day) {
    const vs = variantsOf(day);
    if (!vs.length) return "";
    const on = viewedVariant(day)?.id || "main";
    return Kit.chips(
      [
        { label: `${esc(mainName(day))}<small>主要</small>`, active: on === "main", attrs: { "data-plan-variant": "main" } },
        ...vs.map((v) => ({ label: esc(v.name), active: on === v.id, attrs: { "data-plan-variant": v.id } })),
        { label: "＋", attrs: { "data-plan-variant-new": true, "aria-label": "新增方案" } },
      ],
      { cls: "plan-variants", label: "這天的方案" },
    );
  }
  function applyPlanEdits(map) {
    planEdits = map;
    refreshDays();
    if (current === "plan") refreshPlan();
    else if (current === "notebook" && $("#notebookResults")) notebookResults();
    else if (current === "jrpass") $("#app").innerHTML = renderJrPass();
  }
  function refreshPlan() {
    const j = $(".journey-day");
    if (j) {
      j.innerHTML = renderPlanDay(selectedDay);
      window.Together?.refresh();
      paintWeather();
    }
  }

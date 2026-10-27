  // ---- 行程 tools: another day (對調, 移去), the toolbar and its handlers ----
  let dayPick = null;
  function pickDay(title, note, onPick) {
    dayPick = onPick;
    openDialog(
      `${Kit.sheetHead(title, `D${selectedDay}`)}<p class="note">${note}</p><div class="list day-pick">${days
        .filter((d) => d.n !== selectedDay)
        .map((d) => Kit.row({ lead: `<span class="daynum">D${d.n}</span>`, title: esc(d.date), sub: `${esc(d.region)} · ${stopsFor(d.n).length} 個站點`, attrs: { "data-day-pick": d.n } }))
        .join("")}</div>`,
    );
  }
  function swapDays(a, b) {
    // whole days trade places: the main stops, the title and the other 方案
    const pick = (day) => ({ stops: (planEdits[day]?.stops || []).map(stopFields), variants: variantsOf(day), mainName: planEdits[day]?.mainName || "" }),
      A = pick(a),
      B = pick(b),
      la = days[a - 1].region,
      lb = days[b - 1].region;
    const put = (day, label, { stops, variants, mainName }) => {
      planEdits = { ...planEdits, [day]: { ...planEdits[day], stops, label, variants, mainName } };
      window.Together.setDayLabel(day, label, stops, { variants, mainName });
    };
    put(a, lb, B);
    put(b, la, A);
    planView = { ...planView, [a]: planView[b] || null, [b]: planView[a] || null };
    refreshDays();
    refreshPlan();
    Kit.snack(`已對調 D${a} 與 D${b}`, { action: "復原" }).then((undo) => {
      if (!undo) return;
      put(a, la, A);
      put(b, lb, B);
      refreshDays();
      refreshPlan();
    });
  }
  // 移去另一日: the 方案 on screen becomes a new 方案 of the other day (whose own plan stays as it is). A 方案 that was
  // not the main one leaves this day; the main one stays here too, so no day is left empty.
  function moveVariantToDay(from, to) {
    const v = viewedVariant(from),
      targets = variantsOf(to);
    if (targets.length >= 8) return toast(`D${to} 已有 9 個方案，請先刪除一個。`);
    const stops = stopsFor(from).map(stopFields);
    if (!stops.length) return toast("這個方案沒有站點。");
    const nv = { id: Date.now().toString(36), name: `${v ? v.name : mainName(from)}（由 D${from}）`.slice(0, 30), stops },
      before = { from: variantsOf(from), to: targets };
    saveVariants(to, [...targets, nv]);
    if (v) saveVariants(from, before.from.filter((x) => x !== v));
    planView = { ...planView, [from]: null, [to]: nv.id };
    location.hash = `#plan?day=${to}`;
    Kit.snack(`已把「${v ? v.name : mainName(from)}」移去 D${to}${v ? "" : "（D" + from + " 保留原本行程）"}`, { action: "復原" }).then((undo) => {
      if (!undo) return;
      saveVariants(to, before.to);
      if (v) saveVariants(from, before.from);
      planView = { ...planView, [from]: v ? v.id : null, [to]: null };
      location.hash = `#plan?day=${from}`;
      if (current === "plan") refreshPlan();
    });
  }
  function moveStopToDay(from, i, to) {
    // into the other day's main 方案, whichever of its 方案 was last on screen
    planView = { ...planView, [to]: null };
    const A = stopsFor(from),
      B = stopsFor(to),
      s = A[i];
    if (!s) return;
    const moved = { ...s, transport: "", warn: "" };
    savePlan(from, legsChanged(A, A.filter((_, j) => j !== i)));
    savePlan(to, insertByTime(B, moved));
    Kit.snack(`已把「${s.title}」移去 D${to}`, { action: "復原" }).then((undo) => {
      if (!undo) return;
      savePlan(from, A);
      savePlan(to, B);
    });
  }
  function planTools(stops) {
    return `<div class="plan-tools" role="toolbar" aria-label="安排這天">${[
      ["查全日交通", "train", "data-plan-routes"],
      ["AI 安排", "sparkles", "data-plan-ai"],
      ["推算時間", "clock", "data-plan-times"],
      ["地圖", "map", "data-day-map"],
    ]
      .map(([label, ic, attr]) => Kit.btn(label, { size: "sm", icon: ic, attrs: { [attr]: true, ...(stops.length < 2 && attr !== "data-plan-routes" && attr !== "data-day-map" ? { disabled: true } : {}) } }))
      .join("")}</div>${planAdvice?.day === selectedDay ? `<p class="note plan-advice">${icon("sparkles")} ${esc(planAdvice.text)}</p>` : ""}<p class="note" id="planToolsInfo" hidden></p>`;
  }
  document.addEventListener("click", (e) => {
    const el = e.target.closest("button");
    if (!el) return;
    const day = selectedDay;
    if (el.dataset.variantToDay !== undefined)
      pickDay(`把「${esc(viewedVariant(day)?.name || mainName(day))}」移去…`, "會成為那天的一個新方案，那天原本的行程不變；之後可在那天「⋯」設為主要方案。站點的時間及交通照搬，酒店起點會跟那天的住宿。", (to) => moveVariantToDay(day, to));
    if (el.dataset.daySwap !== undefined)
      pickDay("與另一日對調", "兩日的站點、時間、交通、備註及標題會整份對調，可以復原。", (to) => swapDays(day, to));
    if (el.dataset.stopToDay) {
      const i = Number(el.dataset.stopToDay),
        s = stopsFor(day)[i];
      if (s) pickDay(`把「${esc(s.title)}」移去…`, "保留原本時間，放在該日相應位置；交通需要重新查詢。", (to) => moveStopToDay(day, i, to));
    }
    if (el.dataset.dayPick && dayPick) {
      const go = dayPick;
      dayPick = null;
      $("#detail").close();
      go(Number(el.dataset.dayPick));
    }
    if (el.dataset.planInsert !== undefined) {
      const g = stopGroups(stopsFor(day))[Number(el.dataset.planInsert)];
      if (g) pickPlaceForPlan(day, null, g[0].i);
    }
    if (el.dataset.planRoutes !== undefined) fillRoutes(day);
    if (el.dataset.planAi !== undefined) aiArrangeForm(day);
    if (el.dataset.planTimes !== undefined) aiTimes(day);
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

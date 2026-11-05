  // ---- 行程: closed-day and opening-hours warnings, and moving the times of a stop and the ones after it ----
  // A place's hours are free text (探索「參考價格與營業時間」, or Google's lines from 自動填寫): "星期一休息",
  // "星期一、三至日 10:00–19:00；星期二休息", "定休日：水曜日", "月曜日: 定休日", "Monday: Closed".
  const WD_ZH = "一二三四五六日",
    WD_JA = "月火水木金土日",
    WD_EN = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const wdIndex = (c) => (c === "天" ? 6 : WD_ZH.includes(c) ? WD_ZH.indexOf(c) : WD_JA.indexOf(c));
  // weekdays named in a clause ("星期三至五" → 2,3,4; "月・火曜" → 0,1; "Monday" → 0)
  function weekdaysIn(clause) {
    const out = new Set(),
      add = (chars, seps) => {
        chars.forEach((c, k) => {
          const a = wdIndex(c);
          if (k && /[至到~〜～\-–－]/.test(seps[k - 1])) for (let x = wdIndex(chars[k - 1]); x !== a; x = (x + 1) % 7) out.add(x);
          out.add(a);
        });
      },
      walk = (re, set) => {
        for (const m of clause.matchAll(re)) {
          const chars = [],
            seps = [];
          for (const t of m[0].matchAll(new RegExp(`([${set}])|([至到~〜～\\-–－、,，・及和])`, "g"))) {
            if (t[1]) chars.push(t[1]);
            else if (chars.length) seps[chars.length - 1] = (seps[chars.length - 1] || "") + t[2];
          }
          add(chars, seps);
        }
      };
    walk(/(?:星期|週|周|禮拜|礼拜)[一二三四五六日天](?:\s*[至到~〜～\-–－、,，及和]\s*(?:星期|週|周)?[一二三四五六日天])*/g, "一二三四五六日天");
    walk(/[月火水木金土日](?:曜日?)?(?:\s*[至到~〜～\-–－、,，・]\s*[月火水木金土日](?:曜日?)?)*曜/g, WD_JA);
    for (const m of clause.toLowerCase().matchAll(/\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*/g)) out.add(WD_EN.indexOf(m[1]));
    return out;
  }
  const clausesOf = (text) =>
    String(text || "")
      .replace(/年中無休|全年無休|無休|不定休|不定期休/g, "")
      .split(/[\n；;。（）()【】\[\]]/)
      .map((c) => c.trim())
      .filter(Boolean);
  const CLOSED = /休|closed/i;
  // The hours text of a stop: its explore place's (and its notes), else what 自動填寫 put in a stop of its own.
  const hoursText = (s) => {
    const p = placeOf(s);
    if (p) return [p.v[5], p.v[11]].filter(Boolean).join("\n");
    // a stop of its own: only the hours 自動填寫 wrote (other times in its text may be a bus or a booking)
    const m = !s.linked && String(s.detail || "").match(/營業時間[:：]?([\s\S]*)/);
    return m ? m[1] : "";
  };
  // Opening ranges in minutes ("11:00–14:30、17:00–00:00", "10時00分～18時00分"); past midnight counts on.
  function rangesIn(text) {
    const out = [];
    for (const m of String(text).matchAll(/(\d{1,2})[:：時](\d{2})分?\s*[–~〜～\-－至到]\s*(?:翌\s*)?(\d{1,2})[:：時](\d{2})/g)) {
      const a = Number(m[1]) * 60 + Number(m[2]);
      let b = Number(m[3]) * 60 + Number(m[4]);
      if (b <= a) b += 24 * 60;
      out.push([a, b]);
    }
    return out;
  }
  // A warning for a stop on a day: "星期一休息" when the hours say it is closed that weekday, else "營業 10:00–17:00"
  // when the stop starts outside every opening range of the day (stations, hotels and 24-hour places are skipped).
  function hoursWarning(s, day) {
    const d = days[day - 1],
      wd = d && WD_ZH.indexOf(String(d.weekday).slice(-1));
    if (!d || wd < 0 || s.hotelId || isStation(s)) return "";
    const text = hoursText(s);
    if (!text || /24\s*小時|24\s*時間|24 hours/i.test(text)) return "";
    const clauses = clausesOf(text);
    // Google's one line per weekday ("火曜日: 定休日"): the day's own line decides
    const lines = clauses.filter((c) => /^\s*\S+\s*[:：]/.test(c) && weekdaysIn(c.split(/[:：]/)[0]).size === 1);
    const own = lines.length >= 5 ? lines.find((c) => weekdaysIn(c.split(/[:：]/)[0]).has(wd)) : null;
    if (own ? CLOSED.test(own) : clauses.some((c) => CLOSED.test(c) && weekdaysIn(c).has(wd))) return `${d.weekday}休息`;
    const t = startMinute(s.time);
    if (t == null) return "";
    // ranges for the day: its own line, or the clauses that name no weekday or name this one
    const open = own
      ? rangesIn(own)
      : clauses.filter((c) => !CLOSED.test(c) && (!weekdaysIn(c).size || weekdaysIn(c).has(wd))).flatMap(rangesIn);
    if (!open.length || open.some(([a, b]) => (t >= a && t < b) || (t + 1440 >= a && t + 1440 < b))) return "";
    return `營業 ${open.map(([a, b]) => `${hm(a)}–${hm(b)}`).join("、")}，這站時間不在其中`;
  }
  const closedNote = (s, day) => {
    const w = hoursWarning(s, day);
    return w ? `（注意：${s.title} ${w}）` : "";
  };

  // 調整之後的時間: the stop's time slot and every later one move by the same minutes (the transport text, which may
  // name a timetable, is left as it is).
  function shiftTimes(text, by) {
    return String(text).replace(/(\d{1,2}):(\d{2})/g, (_, h, m) => hm((((Number(h) * 60 + Number(m) + by) % 1440) + 1440) % 1440));
  }
  function shiftedFrom(list, i, by) {
    const gs = stopGroups(list),
      n = gs.findIndex((g) => g.some((x) => x.i === i)),
      from = new Set(gs.slice(Math.max(n, 0)).flatMap((g) => g.map((x) => x.i)));
    return list.map((s, j) => (from.has(j) && startMinute(s.time) != null ? { ...s, time: shiftTimes(s.time, by) } : s));
  }
  function shiftForm(day, i) {
    const list = stopsFor(day),
      s = list[i];
    if (!s) return;
    const n = list.filter((x, j) => j >= i && startMinute(x.time) != null).length;
    if (!n) return toast("這站及之後的站點未有時間，可以先用「推算時間」。");
    openDialog(
      `${Kit.sheetHead("調整之後的時間", `D${day} · 由「${esc(s.title)}」開始`)}<p class="note">這站${s.time ? `（${esc(s.time)}）` : ""}及之後 ${n} 個有時間的站點會一齊移後或提早；交通內寫的班次時間不變，請再確認。</p>${Kit.chips([-30, -15, 15, 30, 60].map((m) => ({ label: `${m < 0 ? "提早" : "延後"} ${Math.abs(m)} 分`, attrs: { "data-shift-by": m } })), { label: "快速調整" })}<form class="tg-form" id="shiftForm" data-day="${day}" data-index="${i}"><label>自訂分鐘（提早用負數，例如 -20）<input name="by" type="number" inputmode="numeric" step="5" min="-720" max="720" required placeholder="例如：25"></label>${Kit.btn("套用", { type: "submit", variant: "primary", cls: "btn-block" })}</form>`,
    );
  }
  function applyShift(day, i, by) {
    if (!by || !Number.isFinite(by)) return;
    const before = stopsFor(day),
      after = shiftedFrom(before, i, by),
      n = after.filter((s, j) => s !== before[j]).length;
    $("#detail").close();
    changeDay(day, after, `已把 ${n} 個站點${by > 0 ? "延後" : "提早"} ${Math.abs(by)} 分鐘`);
  }
  document.addEventListener("click", (e) => {
    const el = e.target.closest("button");
    if (!el) return;
    if (el.dataset.stopShift) shiftForm(selectedDay, Number(el.dataset.stopShift));
    if (el.dataset.shiftBy) {
      const f = $("#shiftForm");
      f && applyShift(Number(f.dataset.day), Number(f.dataset.index), Number(el.dataset.shiftBy));
    }
  });
  document.addEventListener("submit", (e) => {
    if (e.target.id !== "shiftForm") return;
    e.preventDefault();
    const f = e.target;
    applyShift(Number(f.dataset.day), Number(f.dataset.index), Math.round(Number(f.elements.by.value)));
  });

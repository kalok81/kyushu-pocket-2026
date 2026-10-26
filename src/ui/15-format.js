  // ---- Dates: one format on every page — 10/29（四）, with the year only when asked (year: true) ----
  const WEEK = "日一二三四五六",
    ymd = (s) => {
      const m = String(s ?? "").match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
      return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
    };
  // "2026-10-29", "2026/10/29" or "2026-10-29T08:15" → "10/29（四）"; weekday: false leaves out （四）
  function date(s, o = {}) {
    const p = ymd(s);
    if (!p) return String(s ?? "");
    const [y, m, d] = p;
    return `${o.year ? `${y}/` : ""}${m}/${d}${o.weekday === false ? "" : `（${WEEK[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}）`}`;
  }
  const dateRange = (a, b, o = {}) => (!b || b === a ? date(a, o) : `${date(a, o)} – ${date(b, o)}`);

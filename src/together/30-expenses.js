  // ---- 開支 (expenses): currencies, exchange rates, categories, statistics and settling up ----
  // The trip's local and home currencies (trips/{t}.currency, homeCurrency); names for the pickers.
  const CURRENCY_NAMES = {
    JPY: "日圓",
    HKD: "港幣",
    KRW: "韓圜",
    TWD: "新台幣",
    THB: "泰銖",
    CNY: "人民幣",
    SGD: "新加坡元",
    MYR: "馬幣",
    USD: "美元",
    EUR: "歐元",
    GBP: "英鎊",
    AUD: "澳元",
    CAD: "加元",
    VND: "越南盾",
    PHP: "菲律賓披索",
    IDR: "印尼盾",
  };
  const tripCurrencies = () => [...new Set([state.meta?.currency || "JPY", state.meta?.homeCurrency || "HKD"])];
  const curOptions = (sel) =>
    tripCurrencies()
      .map(
        (c) =>
          `<option value="${c}"${c === sel ? " selected" : ""}>${CURRENCY_NAMES[c] || c} ${window.Split.currencies[c]?.symbol || ""}</option>`,
      )
      .join("");
  const pickCur = (c) => (tripCurrencies().includes(c) ? c : tripCurrencies()[0]);
  const CATS = {
    food: "🍜 餐飲",
    transport: "🚃 交通",
    shopping: "🛍 購物",
    stay: "🏨 住宿",
    fun: "🎡 景點娛樂",
    other: "📦 其他",
  };
  const catOptions = (sel) =>
    Object.entries(CATS)
      .map(([k, v]) => `<option value="${k}"${k === sel ? " selected" : ""}>${v}</option>`)
      .join("");
  // Exchange rates into the home currency (home units per 1 unit): a rate a companion set (settings/fx, shared) wins over
  // the day's market rate from open.er-api.com (only currency codes are sent), cached on the phone for offline use.
  const home = () => state.meta?.homeCurrency || "HKD",
    FX_KEY = "pocket-fx-";
  const manualRate = (c) => {
    const r = state.fx?.rates?.[c];
    return typeof r === "number" && r > 0 ? r : null;
  };
  const liveRate = (c) => (state.liveFx?.home === home() && state.liveFx.rates[c]) || null;
  const rateOf = (c) => (c === home() ? 1 : manualRate(c) || liveRate(c));
  function loadFx() {
    const h = home();
    try {
      const c = JSON.parse(localStorage.getItem(FX_KEY + h) || "null");
      if (c?.home === h) state.liveFx = c;
    } catch {}
    if (!navigator.onLine || (state.liveFx && Date.now() - state.liveFx.fetched < 6 * 36e5)) return;
    fetch(`https://open.er-api.com/v6/latest/${h}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.result !== "success") return;
        const rates = {};
        for (const c of Object.keys(S.currencies)) if (j.rates?.[c] > 0) rates[c] = 1 / j.rates[c];
        state.liveFx = { home: h, rates, date: j.time_last_update_unix * 1000, fetched: Date.now() };
        try {
          localStorage.setItem(FX_KEY + h, JSON.stringify(state.liveFx));
        } catch {}
        refresh();
      })
      .catch(() => {});
  }
  const toHome = (e) => {
    const r = rateOf(e.currency);
    return r ? e.amount * r : null;
  };
  const fmtHome = (v) => S.format(Math.round(v * 10 ** S.currencies[home()].decimals), home());
  async function setRate(c) {
    const h = home(),
      live = liveRate(c),
      cur = manualRate(c);
    const v = await UI.prompt(
      `1 ${CURRENCY_NAMES[c] || c} = 幾多${CURRENCY_NAMES[h] || h}？`,
      cur ? String(cur) : "",
      live ? `留空＝自動匯率 ${+live.toPrecision(4)}` : "例如 0.052",
    );
    if (v == null) return;
    const n = Number(v.trim());
    if (v.trim() && !(n > 0 && n < 1e6)) return toast("匯率不正確。");
    const rates = { ...(state.fx?.rates || {}) };
    if (v.trim()) rates[c] = n;
    else delete rates[c];
    fb.fs
      .setDoc(tdoc("settings", "fx"), { rates, by: state.user.uid, byName: me().name, at: Date.now() })
      .catch(() => toast("未能儲存匯率，請再試。"));
    toast(v.trim() ? "已設定匯率，所有旅伴都會使用" : "已改回自動匯率");
  }
  const itemRow = (it = {}) =>
    `<div class="tg-line-row"><input name="itemName" maxlength="40" placeholder="物品" aria-label="物品" value="${esc(it.name ?? "")}"><input name="itemAmount" type="number" inputmode="decimal" min="0" max="10000000" step="0.01" placeholder="金額" aria-label="金額" value="${it.amount ?? ""}"><button type="button" class="smallbtn" data-tg="itemDel" aria-label="移除物品">×</button></div>`;
  // Same receipt twice: same amount and currency, plus the same day or the same shop name.
  const sameName = (a, b) => String(a).replace(/\s+/g, "").toLowerCase() === String(b).replace(/\s+/g, "").toLowerCase();
  const duplicateOf = ({ title, amount, currency, day }) =>
    state.expenses.find(
      (e) => e.currency === currency && Math.abs(e.amount - amount) < 0.005 && (e.day === day || sameName(e.title, title)),
    );
  const dupText = (e) =>
    `${dayLabel(e.day)}「${e.title}」${S.format(S.toMinor(e.amount, e.currency), e.currency)}（${e.byName || "旅伴"} 記錄）`;
  function expenseItem(e) {
    const h = e.currency !== home() && toHome(e);
    return `<article class="tg-item">${meta(e, `<span class="badge">${esc(dayLabel(e.day))}</span><button type="button" class="badge tg-cat${CATS[e.category] ? "" : " none"}" data-exp-cat="${esc(e.id)}" aria-label="更改分類">${CATS[e.category] || "＋ 分類"}</button>`)}<div class="tg-expense"><h3>${esc(e.title)}</h3><b>${esc(S.format(S.toMinor(e.amount, e.currency), e.currency))}${h ? `<small class="tg-conv">≈ ${esc(fmtHome(h))}</small>` : ""}</b></div>${e.items?.length ? `<ul class="tg-lines">${e.items.map((i) => `<li><span>${esc(i.name)}</span>${i.amount != null ? `<span>${esc(S.format(S.toMinor(i.amount, e.currency), e.currency))}</span>` : ""}</li>`).join("")}</ul>` : ""}<p class="note">${esc(nameOf(e.paidBy))} 付款 · 分給 ${esc((e.split || []).map(nameOf).join("、"))}</p><div class="links">${e.receipts?.length ? `<button class="action" data-receipts="${esc(e.id)}">🧾 收據（${e.receipts.length}）</button>` : ""}${del("expenses", e)}</div></article>`;
  }
  // Spending overview in the home currency: total, per companion, per day and per category, and the rates used.
  function stats() {
    const list = state.expenses.filter((e) => S.currencies[e.currency]);
    if (!list.length) return "";
    const h = home(),
      curs = [...new Set([...tripCurrencies(), ...list.map((e) => e.currency)])].filter((c) => c !== h);
    const rateRow = (c) => {
      const m = manualRate(c),
        r = rateOf(c);
      return `<li><span>1 ${c} = ${r ? +r.toPrecision(4) : "？"} ${h}</span><span class="note">${m ? `手動設定${state.fx?.byName ? `（${esc(state.fx.byName)}）` : ""}` : r ? `自動 · ${new Date(state.liveFx.date).toLocaleDateString("zh-HK", { month: "numeric", day: "numeric" })}` : "未有匯率（需要網絡）"}</span><button type="button" class="smallbtn" data-fx-set="${c}">設定</button></li>`;
    };
    const rates = curs.length
      ? `<details class="tg-fx"${state.fxOpen ? " open" : ""}><summary>匯率</summary><ul>${curs.map(rateRow).join("")}</ul><p class="note">自動匯率每日更新；可以改用你們實際兌換的匯率，所有旅伴共用。</p></details>`
      : "";
    const missing = [...new Set(list.map((e) => e.currency))].filter((c) => !rateOf(c));
    if (missing.length)
      return `<section class="panel tg-stats"><h3>開支統計</h3><p class="note">未有 ${missing.join("、")} 的匯率，暫時未能換算成${CURRENCY_NAMES[h] || h}。連上網絡或手動設定匯率即可。</p>${rates}</section>`;
    const add = (m, k, v) => m.set(k, (m.get(k) || 0) + v),
      days = new Map(),
      cats = new Map(),
      paid = new Map(),
      share = new Map();
    let total = 0;
    for (const e of list) {
      const v = toHome(e);
      total += v;
      add(days, e.day, v);
      add(cats, CATS[e.category] ? e.category : "", v);
      add(paid, e.paidBy, v);
      (e.split || []).forEach((u) => add(share, u, v / e.split.length));
    }
    const bars = (rows) => {
      const max = Math.max(...rows.map((r) => r[1]), 1);
      return `<div class="tg-bars">${rows.map(([k, v]) => `<div class="tg-bar"><span>${esc(k)}</span><div><i style="width:${Math.max(2, (v / max) * 100).toFixed(1)}%"></i></div><b>${esc(fmtHome(v))}</b></div>`).join("")}</div>`;
    };
    const ppl = [...new Set([...paid.keys(), ...share.keys()])],
      nDays = days.size;
    return `<section class="panel tg-stats"><h3>開支統計</h3><div class="tg-total"><b>${esc(fmtHome(total))}</b><span>合共 ${list.length} 筆${nDays > 1 ? ` · 平均每日 ${esc(fmtHome(total / nDays))}` : ""}</span></div>
  <h4>每人</h4><ul class="tg-people">${ppl.map((u) => `<li><b>${esc(nameOf(u))}</b><span>分擔 ${esc(fmtHome(share.get(u) || 0))}</span><span class="note">已付 ${esc(fmtHome(paid.get(u) || 0))}</span></li>`).join("")}</ul>
  <h4>按類別</h4>${bars([...cats].sort((a, b) => b[1] - a[1]).map(([k, v]) => [CATS[k] || "未分類", v]))}
  <h4>按日子</h4>${bars([...days].sort((a, b) => a[0] - b[0]).map(([d, v]) => [T().days[d - 1] ? `D${d} ${T().days[d - 1].date}` : `D${d}`, v]))}
  ${curs.some((c) => list.some((e) => e.currency === c)) ? `<p class="note">以${CURRENCY_NAMES[h] || h}計算。</p>` : ""}${rates}</section>`;
  }
  function summary() {
    const bal = S.balances(state.expenses),
      cs = Object.keys(bal),
      h = home();
    if (!cs.length) return "";
    const combined = cs.length > 1 || cs[0] !== h ? S.combine(bal, rateOf, h) : null,
      mode = combined ? state.settleMode || "home" : "each";
    const moveRows = (moves, c) =>
      moves.length
        ? moves
            .map((m) => `<p><b>${esc(nameOf(m.from))}</b> 要畀 <b>${esc(nameOf(m.to))}</b> ${esc(S.format(m.amount, c))}</p>`)
            .join("")
        : "<p>已經清數。</p>";
    const toggle = combined
      ? `<div class="chips tg-settle-mode"><button type="button" class="chip${mode === "home" ? " active" : ""}" data-settle="home">全部換成${CURRENCY_NAMES[h] || h}</button><button type="button" class="chip${mode === "each" ? " active" : ""}" data-settle="each">各貨幣分開</button></div>`
      : "";
    const body =
      mode === "home"
        ? `<div class="tg-currency">${moveRows(S.settle(combined), h)}</div><p class="note">按目前匯率把各貨幣換算成${CURRENCY_NAMES[h] || h}後一次過結算。</p>`
        : `${cs
            .map((c) => {
              const total = state.expenses.filter((e) => e.currency === c).reduce((t, e) => t + S.toMinor(e.amount, c), 0);
              return `<div class="tg-currency"><div class="eyebrow">${c} · 合共 ${esc(S.format(total, c))}</div>${moveRows(S.settle(bal[c]), c)}</div>`;
            })
            .join("")}<p class="note">各貨幣分開計算，不作匯率換算。</p>`;
    return `<section class="panel tg-summary"><h3>分帳結算</h3>${toggle}${body}</section>`;
  }

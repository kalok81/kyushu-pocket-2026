  // ---- 共用 page (notes, expenses, checklist): lists, forms and the slots on other pages ----
  const tabs = { notes: "筆記", expenses: "開支", checklist: "清單" };
  const CHECK_GROUPS = { pre: "行前準備", pack: "行李", other: "其他" };
  const CHECK_SUGGEST = {
    pre: ["旅遊保險", "網卡／eSIM", "兌換外幣", "入境登記／簽證", "預約機場交通"],
    pack: ["護照", "信用卡及現金", "手機充電器", "尿袋", "轉插", "常用藥物", "換洗衣物", "雨傘", "個人用品", "購物袋"],
  };
  function noteItem(n) {
    const place = n.placeName ? `<span class="badge">${esc(n.placeName)}</span>` : "",
      day = n.day ? `<span class="badge">${esc(dayLabel(n.day))}</span>` : "";
    return `<article class="tg-item">${meta(n, day + place)}<p class="tg-text">${esc(n.text)}</p>${del("notes", n)}</article>`;
  }
  const tripSwitch = () =>
    state.trips?.length > 1
      ? `<select class="trip-switch" data-trip-switch aria-label="切換旅程">${state.trips.map((t) => `<option value="${esc(t.id)}"${t.id === tripId ? " selected" : ""}>${esc(t.name)}</option>`).join("")}</select>`
      : `<span class="trip-name">${esc(state.meta?.name || "")}</span>`;
  function statusBar() {
    const online = navigator.onLine,
      pending = ["notes", "expenses", "shopping", "checklist"].reduce((t, k) => t + state[k].filter((x) => x.pending).length, 0);
    return `${tripSwitch()}<span>已登入：<b>${esc(me().name)}</b></span><span class="tg-pending-${online ? "on" : "off"}">${online ? (pending ? `${pending} 項同步中…` : "已同步") : "離線中 · 修改會在有網絡時同步"}</span><button class="smallbtn" data-tg="logout">登出</button>`;
  }
  function lists() {
    if (state.tab === "notes")
      return state.notes.length
        ? state.notes.map(noteItem).join("")
        : '<div class="empty"><h2>還沒有筆記</h2><p>寫下提醒、想吃的東西或任何旅程點滴。</p></div>';
    if (state.tab === "checklist") return checklist();
    if (state.tab === "expenses")
      return (
        stats() +
        summary() +
        (state.expenses.length
          ? state.expenses.map(expenseItem).join("")
          : '<div class="empty"><h2>還沒有開支</h2><p>每筆開支記下誰付款、分給誰，網站會計算誰要畀誰。</p></div>')
      );
  }
  // Shared checklist: everyone sees the same items and ticks them off for themselves (doneBy holds their uids).
  function checklist() {
    const me = state.user.uid,
      items = [...state.checklist].sort((a, b) => (a.at || 0) - (b.at || 0));
    if (!items.length)
      return '<div class="empty"><h2>還沒有清單</h2><p>加入要準備和要帶的東西，每位旅伴各自剔選。</p><button type="button" class="action primary" data-tg="checkSuggest">加入建議項目</button></div>';
    const mine = items.filter((i) => (i.doneBy || []).includes(me)).length,
      ppl = people();
    const row = (i) => {
      const done = (i.doneBy || []).includes(me),
        others = (i.doneBy || []).filter((u) => u !== me).map(nameOf);
      return `<li class="check-row${done ? " done" : ""}"><label><input type="checkbox" data-check="${esc(i.id)}"${done ? " checked" : ""}><span>${esc(i.text)}</span></label>${ppl.length > 1 ? `<small>${others.length ? `✓ ${esc(others.join("、"))}` : ""}</small>` : ""}<button type="button" class="smallbtn" data-tg-del="checklist:${esc(i.id)}" aria-label="刪除 ${esc(i.text)}">×</button></li>`;
    };
    return `<div class="check-progress"><b>你已完成 ${mine}／${items.length}</b><div class="tg-progress"><div style="width:${Math.round((mine / items.length) * 100)}%"></div></div></div>${Object.entries(
      CHECK_GROUPS,
    )
      .map(([g, label]) => {
        const list = items.filter((i) => (CHECK_GROUPS[i.group] ? i.group : "other") === g);
        return list.length
          ? `<section class="panel check-group"><h3>${label}</h3><ul>${list.map(row).join("")}</ul></section>`
          : "";
      })
      .join("")}<button type="button" class="smallbtn" data-tg="checkSuggest">＋ 加入未有的建議項目</button>`;
  }
  function addSuggestions() {
    const have = new Set(state.checklist.map((i) => i.text.trim()));
    let n = 0;
    for (const [group, list] of Object.entries(CHECK_SUGGEST))
      for (const text of list)
        if (!have.has(text)) {
          fb.fs
            .addDoc(tcol("checklist"), {
              text,
              group,
              doneBy: [],
              by: state.user.uid,
              byName: me().name,
              at: Date.now() + n,
              createdAt: fb.fs.serverTimestamp(),
            })
            .catch(() => {});
          n++;
        }
    toast(n ? `已加入 ${n} 項` : "建議項目已全部在清單內");
  }
  function forms() {
    if (state.tab === "checklist")
      return `<form class="panel tg-form check-form" data-tg-form="check"><div class="tg-row"><label>項目<input name="text" maxlength="60" required placeholder="例如：護照、尿袋"></label><label>分類<select name="group">${Object.entries(
        CHECK_GROUPS,
      )
        .map(([k, v]) => `<option value="${k}">${v}</option>`)
        .join("")}</select></label></div><button type="submit" class="locate-button">加入清單</button></form>`;
    if (state.tab === "notes")
      return `<form class="panel tg-form" data-tg-form="note"><label>筆記<textarea name="text" rows="3" maxlength="1000" required placeholder="例如：別府那天記得帶毛巾"></textarea></label><label>關於<select name="day"><option value="">整個旅程</option>${dayOptions(0)}</select></label><button type="submit" class="locate-button">加入筆記</button></form>`;
    if (state.tab === "expenses") {
      const ps = people();
      return `<form class="panel tg-form" data-tg-form="expense"><div class="tg-scan"><button type="button" class="action primary" data-tg="scan">📷 影收據／上載收據（可多張）</button><input type="file" accept="image/*" id="tgReceipt" multiple hidden><p class="note">AI 在背景讀出店名、金額、日期及物品，可以關閉網頁，稍後回來確認。同一張收據分開影的相片會提示合併，也可以自己選擇合併。加入或捨棄後相片會刪除。</p></div><div id="tgDrafts" class="tg-drafts"></div><label>項目<input name="title" maxlength="80" required placeholder="例如：一蘭晚餐"></label><label>分類<select name="category"><option value="">未分類</option>${catOptions("")}</select></label><fieldset class="tg-lines-edit"><legend>物品（可留空）</legend><div id="tgItemRows">${itemRow()}</div><button type="button" class="smallbtn" data-tg="itemAdd">＋ 加物品</button></fieldset><div class="tg-row"><label>金額<input name="amount" type="number" inputmode="decimal" min="0.01" max="10000000" step="0.01" placeholder="留空＝物品合計"></label><label>貨幣<select name="currency">${curOptions(tripCurrencies()[0])}</select></label></div><div class="tg-row"><label>誰付款<select name="paidBy">${ps.map((p) => `<option value="${esc(p.id)}"${p.id === state.user.uid ? " selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label><label>日子<select name="day">${dayOptions(today())}</select></label></div><fieldset><legend>分給</legend>${ps.map((p) => `<label class="tg-check"><input type="checkbox" name="split" value="${esc(p.id)}" checked> ${esc(p.name)}</label>`).join("")}</fieldset><p class="note">旅伴第一次登入後，才會出現在名單中。</p><button type="submit" class="locate-button">記下開支</button></form>`;
    }
    return "";
  }
  function page() {
    const s = state.status;
    if (["idle", "loading", "checking"].includes(s))
      return { sig: s, shell: '<div class="empty"><h2>正在連接…</h2><p>第一次載入需要數秒。</p></div>' };
    if (s === "error")
      return {
        sig: s + state.error,
        shell: `<div class="empty"><h2>${esc(state.error || "發生錯誤")}</h2><button class="action primary" data-tg="retry">再試</button></div>`,
      };
    if (s === "signedOut")
      return {
        sig: s,
        shell: `<section class="panel tg-login"><h2>旅伴專用</h2><p>行程、地點、住宿、筆記和開支只限旅伴登入查看，不會公開在網站上。</p><form class="tg-form" data-tg-form="login"><label>帳號<input name="id" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="60" required></label><label>密碼<input name="password" type="password" autocomplete="current-password" required></label><button type="submit" class="locate-button">登入</button></form><div class="tg-or">或</div><button class="action tg-google" data-tg="login">用 Google 帳戶登入</button><p class="note">這部手機會記住登入狀態，之後離線也可以查看。</p></section>`,
      };
    if (s === "notrip")
      return {
        sig: s,
        shell: `<section class="panel tg-login"><h2>建立你的第一個旅程</h2><p>填好目的地和日期，之後可以加入行程、地點、住宿和旅伴。</p>${tripForm(null)}</section>`,
      };
    if (s === "denied")
      return {
        sig: s + state.user?.uid,
        shell: `<section class="panel tg-login"><h2>這個帳戶未加入任何旅程</h2><p>你已用 <b>${esc(state.user?.email)}</b> 登入，但未加入任何旅程。請旅程負責人把你加入旅伴名單，然後按再試。</p><div class="links"><button class="action primary" data-tg="retry">再試</button><button class="action" data-tg="logout">登出／換帳戶</button></div></section>`,
      };
    if (!started) return { sig: "trip", shell: '<div class="empty"><h2>正在載入旅程資料…</h2></div>' };
    const sig = [
      "ready",
      state.tab,
      state.day,
      state.user.uid,
      people()
        .map((p) => p.id + p.name)
        .join(),
    ].join("|");
    return {
      sig,
      shell: `<div class="tg-status" data-tg-live="status"></div><div class="chips" role="tablist">${Object.entries(tabs)
        .map(
          ([k, v]) =>
            `<button class="chip ${k === state.tab ? "active" : ""}" data-tg-tab="${k}" aria-pressed="${k === state.tab}">${v}</button>`,
        )
        .join("")}</div>${forms()}<div class="tg-list" data-tg-live="list"></div>`,
      live: { status: statusBar(), list: lists() },
    };
  }
  function daySlot(n) {
    if (state.status !== "ready") return { sig: "wait", shell: "" };
    const ns = state.notes.filter((x) => x.day === n);
    return {
      sig: "ready",
      shell: '<div data-tg-live="list"></div>',
      live: {
        list: `<div class="sectionhead"><h2>旅伴筆記</h2><a class="action" href="#together?tab=notes">＋ 加入筆記</a></div>${ns.length ? ns.map(noteItem).join("") : '<p class="note">這天還沒有旅伴筆記。</p>'}`,
      },
    };
  }
  function placeSlot(id) {
    if (state.status !== "ready") return { sig: "out", shell: "" };
    return {
      sig: "ready" + id,
      shell: `<section class="detail-section"><h3>旅伴筆記</h3><div data-tg-live="list"></div><form class="tg-form" data-tg-form="note" data-place-id="${esc(id)}"><textarea name="text" rows="2" maxlength="1000" required placeholder="寫下對這個地點的筆記"></textarea><button type="submit" class="action primary">加入筆記</button></form></section>`,
      live: {
        list:
          state.notes
            .filter((x) => x.placeId === id)
            .map(noteItem)
            .join("") || '<p class="note">還沒有筆記。</p>',
      },
    };
  }

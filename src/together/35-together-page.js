  // ---- 共用 page (notes, expenses, checklist): lists, forms and the slots on other pages ----
  const tabs = { notes: "筆記", expenses: "開支", checklist: "清單" },
    TAB_ICONS = { notes: "note", expenses: "wallet", checklist: "checklist" };
  const CHECK_GROUPS = { pre: "行前準備", pack: "行李", other: "其他" };
  const CHECK_SUGGEST = {
    pre: ["旅遊保險", "網卡／eSIM", "兌換外幣", "入境登記／簽證", "預約機場交通"],
    pack: ["護照", "信用卡及現金", "手機充電器", "尿袋", "轉插", "常用藥物", "換洗衣物", "雨傘", "個人用品", "購物袋"],
  };
  // Notes and coupons (notes with kind "coupon"): photos are kept in the note itself (small JPEGs) so a coupon's
  // barcode can still be shown at the till without a connection; links in the text become clickable.
  const linkify = (t) =>
    esc(t).replace(/https?:\/\/[^\s<>"']+/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u.length > 48 ? u.slice(0, 45) + "…" : u}</a>`);
  const notePhotos = (n) =>
    n.photos?.length
      ? `<div class="note-photos">${n.photos.map((p, i) => `<button type="button" class="note-photo" data-note-photo="${esc(n.id)}:${i}" aria-label="放大相片 ${i + 1}"><img src="${photoSrc(p)}" alt=""></button>`).join("")}</div>`
      : "";
  const noteLink = (n) => (n.url ? Kit.btn("打開連結", { href: n.url, external: true, size: "sm", icon: "link" }) : "");
  const isoToday = () => new Date().toLocaleDateString("en-CA");
  function couponDue(c) {
    if (c.used) return Kit.badge(`✓ 已使用${c.usedBy ? `（${esc(c.usedBy)}）` : ""}`);
    if (!c.until) return "";
    const days = Math.round((Date.parse(c.until) - Date.parse(isoToday())) / 864e5);
    return days < 0
      ? Kit.badge(`已過期（${esc(c.until)}）`, "coupon-expired")
      : Kit.badge(`${days ? `還有 ${days} 天` : "今天到期"} · ${esc(c.until)}`, days <= 3 ? "coupon-soon" : "");
  }
  const noteEditItem = (n) => ({ label: "修改", icon: "edit", attrs: { "data-note-edit": n.id } });
  function noteItem(n) {
    const place = n.placeName ? Kit.badge(esc(n.placeName)) : "",
      day = n.day ? Kit.badge(esc(dayLabel(n.day))) : "";
    if (n.kind === "coupon")
      return `<article class="tg-item coupon${n.used ? " used" : ""}">${itemTop(n, `${Kit.badge(`${icon("ticket")}優惠券`, "coupon-tag")}${day}${place}`, [noteEditItem(n), del("notes", n)])}<h3>${esc(n.title)}</h3>${n.text ? `<p class="tg-text">${linkify(n.text)}</p>` : ""}${n.code ? `<div class="coupon-code"><span>優惠碼</span><b>${esc(n.code)}</b>${Kit.btn("複製", { size: "sm", icon: "copy", attrs: { "data-copy-code": n.code } })}</div>` : ""}<div class="coupon-due">${couponDue(n)}</div>${notePhotos(n)}<div class="links">${Kit.btn(n.used ? "改回未使用" : "已使用", { size: "sm", variant: n.used ? "outline" : "secondary", icon: n.used ? "undo" : "check", attrs: { "data-coupon-used": n.id } })}${noteLink(n)}</div></article>`;
    return `<article class="tg-item">${itemTop(n, day + place, [noteEditItem(n), del("notes", n)])}<p class="tg-text">${linkify(n.text)}</p>${notePhotos(n)}${n.url ? `<div class="links">${noteLink(n)}</div>` : ""}</article>`;
  }
  function syncText() {
    const pending = ["notes", "expenses", "shopping", "checklist"].reduce((t, k) => t + state[k].filter((x) => x.pending).length, 0);
    return navigator.onLine ? (pending ? `${pending} 項同步中…` : "已同步") : "離線中 · 修改會在有網絡時同步";
  }
  // Sync line on the together pages: only shown while offline or while changes are still being sent.
  function statusBar() {
    const t = syncText();
    return t === "已同步" ? "" : `<p class="tg-sync tg-pending-${navigator.onLine ? "on" : "off"}">${esc(t)}</p>`;
  }
  // Signed-in account for the ☰ menu.
  function account() {
    if (state.status !== "ready" || !state.user) return "";
    return `<section class="menu-account"><div><small>已登入</small><b>${esc(me().name)}</b><small>${esc(syncText())}</small></div>${Kit.btn("登出", { size: "sm", icon: "logout", attrs: { "data-tg": "logout" } })}</section>`;
  }
  // The add forms open in a sheet from the page's ＋ button.
  const FORM_TITLES = { notes: () => `${state.noteEdit ? "修改" : "新增"}${state.noteKind === "coupon" ? "優惠券" : "筆記"}`, expenses: () => "記一筆開支" };
  function openForm() {
    if (!FORM_TITLES[state.tab]) return;
    Kit.open(Kit.sheetHead(FORM_TITLES[state.tab]()) + forms());
  }
  // 寫筆記 from the plan: the note form with that day chosen
  function dayNote(day) {
    state.noteEdit = null;
    state.noteKind = "note";
    const tab = state.tab;
    state.tab = "notes";
    openForm();
    state.tab = tab;
    const sel = $('#detail [data-tg-form="note"] [name=day]');
    if (sel) sel.value = String(day);
  }
  function editNote(id) {
    const n = state.notes.find((x) => x.id === id);
    if (!n) return;
    state.noteEdit = id;
    state.noteKind = n.kind === "coupon" ? "coupon" : "note";
    notePhotoDraft = [...(n.photos || [])];
    openForm();
  }
  function lists() {
    if (state.tab === "notes") {
      // Coupons: unused ones first, soonest expiry first; notes newest first.
      const f = state.noteFilter,
        coupons = state.notes.filter((n) => n.kind === "coupon").sort((a, b) => a.used - b.used || String(a.until || "9").localeCompare(String(b.until || "9"))),
        notes = state.notes.filter((n) => n.kind !== "coupon"),
        list = f === "coupon" ? coupons : f === "note" ? notes : [...coupons.filter((c) => !c.used), ...notes, ...coupons.filter((c) => c.used)];
      const chips = Kit.chips(
        [
          ["all", "全部"],
          ["note", "筆記", "note"],
          ["coupon", `優惠券${coupons.length ? `（${coupons.filter((c) => !c.used).length}）` : ""}`, "ticket"],
        ].map(([k, label, ic]) => ({ label, icon: ic, active: f === k, attrs: { "data-note-filter": k } })),
        { cls: "note-filter", label: "篩選" },
      );
      return (
        chips +
        (list.length
          ? list.map(noteItem).join("")
          : f === "coupon"
            ? Kit.empty("還沒有優惠券", "按右下角「新增」，再選「優惠券」，影低優惠券或貼上連結。")
            : Kit.empty("還沒有筆記", "寫下提醒、想吃的東西或任何旅程點滴，可以加相片和連結。"))
      );
    }
    if (state.tab === "checklist") return checklist();
    if (state.tab === "expenses") {
      const found = expenseMatches();
      return (
        stats() +
        summary() +
        (!state.expenses.length
          ? Kit.empty("還沒有開支", "按右下角「記一筆」，或影收據讓 AI 讀出金額。")
          : state.expSearch.trim() && !found.length
            ? Kit.empty(`找不到「${esc(state.expSearch.trim())}」`, "試試其他字，或清除搜尋。")
            : (state.expSearch.trim() ? `<p class="note exp-found">找到 ${found.length} 筆${foundTotal(found)}</p>` : "") + found.map(expenseItem).join(""))
      );
    }
  }
  // Shared checklist: everyone sees the same items and ticks them off for themselves (doneBy holds their uids).
  function checklist() {
    const me = state.user.uid,
      items = [...state.checklist].sort((a, b) => (a.at || 0) - (b.at || 0));
    if (!items.length)
      return Kit.empty("還沒有清單", "加入要準備和要帶的東西，每位旅伴各自剔選。", Kit.btn("加入建議項目", { variant: "secondary", icon: "plus", attrs: { "data-tg": "checkSuggest" } }));
    const mine = items.filter((i) => (i.doneBy || []).includes(me)).length,
      ppl = people();
    const row = (i) => {
      const done = (i.doneBy || []).includes(me),
        others = (i.doneBy || []).filter((u) => u !== me).map(nameOf);
      return `<li class="check-row${done ? " done" : ""}"><label><input type="checkbox" data-check="${esc(i.id)}"${done ? " checked" : ""}><span>${esc(i.text)}</span></label>${ppl.length > 1 ? `<small>${others.length ? `✓ ${esc(others.join("、"))}` : ""}</small>` : ""}${Kit.btn(`刪除 ${esc(i.text)}`, { icon: "x", iconOnly: true, variant: "ghost", size: "sm", attrs: { "data-tg-del": `checklist:${i.id}` } })}</li>`;
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
      .join("")}${Kit.btn("加入未有的建議項目", { size: "sm", variant: "ghost", icon: "plus", attrs: { "data-tg": "checkSuggest" } })}`;
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
      return `<form class="check-form" data-tg-form="check"><input name="text" maxlength="60" required placeholder="新項目，例如：護照" aria-label="新項目"><select name="group" aria-label="分類">${Object.entries(
        CHECK_GROUPS,
      )
        .map(([k, v]) => `<option value="${k}">${v}</option>`)
        .join("")}</select>${Kit.btn("加入", { type: "submit", variant: "primary", icon: "plus" })}</form>`;
    if (state.tab === "notes") {
      // Editing keeps the kind: no 筆記／優惠券 switch; the fields start with the note's values
      const ed = state.noteEdit && state.notes.find((n) => n.id === state.noteEdit),
        val = (k) => esc(ed?.[k] ?? ""),
        edPlace = ed?.placeId && T().places.find((p) => p.id === ed.placeId),
        coupon = state.noteKind === "coupon",
        kinds = state.noteEdit
          ? ""
          : Kit.chips(
          [
            ["note", "筆記", "note"],
            ["coupon", "優惠券", "ticket"],
          ].map(([k, label, ic]) => ({ label, icon: ic, active: state.noteKind === k, attrs: { "data-note-kind": k } })),
          { cls: "note-kind", label: "類型" },
        ),
        photos = `<div class="note-photo-edit"><div id="notePhotoPreview">${notePhotoPreview()}</div>${Kit.btn(`${coupon ? "影優惠券／上載截圖" : "加相片"}（最多 ${NOTE_PHOTO_MAX} 張）`, { icon: "camera", cls: "btn-block", attrs: { "data-tg": "notePhoto" } })}<input type="file" accept="image/*" id="notePhotoInput" multiple hidden><p class="note" id="noteFillInfo">${coupon ? "加入優惠券相片或連結後，AI 會讀出店名、優惠、優惠碼及有效期，填入空白欄位。" : "加入相片或連結後，AI 會讀出重點，填入筆記。"}</p></div>`,
        about = `<div class="tg-row"><label>日子<select name="day"><option value="">整個旅程</option>${dayOptions(ed?.day || 0)}</select></label><label>地點<input name="placeQ" list="notePlaceList" maxlength="120" autocomplete="off" placeholder="不指定，或打字搜尋" value="${edPlace ? esc(placeLabel(edPlace)) : ""}"></label><datalist id="notePlaceList">${[...T().places]
          .sort((a, b) => a.v[1].localeCompare(b.v[1]))
          .map((p) => `<option value="${esc(placeLabel(p))}">`)
          .join("")}</datalist></div>`;
      return coupon
        ? `<form class="tg-form" data-tg-form="note" data-kind="coupon">${kinds}<label>店舖／優惠名稱<input name="title" maxlength="80" required placeholder="例如：Bic Camera 免稅 10% + 5%" value="${val("title")}"></label><label>優惠內容<textarea name="text" rows="2" maxlength="1000" placeholder="例如：滿 ¥5,000 用，需出示護照">${val("text")}</textarea></label><div class="tg-row"><label>優惠碼（可留空）<input name="code" maxlength="60" autocapitalize="characters" spellcheck="false" value="${val("code")}"></label><label>有效期至<input name="until" type="date" value="${val("until")}"></label></div><label>連結（可留空）<input name="url" type="url" inputmode="url" maxlength="500" placeholder="https://" value="${val("url")}"></label>${photos}${about}${Kit.btn(state.noteEdit ? "儲存修改" : "加入優惠券", { type: "submit", variant: "primary", cls: "btn-block" })}</form>`
        : `<form class="tg-form" data-tg-form="note">${kinds}<label>筆記<textarea name="text" rows="3" maxlength="1000" required placeholder="例如：別府那天記得帶毛巾；網址會變成連結">${val("text")}</textarea></label><label>連結（可留空）<input name="url" type="url" inputmode="url" maxlength="500" placeholder="https://" value="${val("url")}"></label>${photos}${about}${Kit.btn(state.noteEdit ? "儲存修改" : "加入筆記", { type: "submit", variant: "primary", cls: "btn-block" })}</form>`;
    }
    if (state.tab === "expenses") {
      const ps = people();
      return `<form class="tg-form" data-tg-form="expense"><div class="tg-scan">${Kit.btn("影收據／上載收據（可多張）", { variant: "secondary", icon: "camera", cls: "btn-block", attrs: { "data-tg": "scan" } })}<input type="file" accept="image/*" id="tgReceipt" multiple hidden><p class="note">AI 在背景讀出店名、金額、日期及物品，完成後在開支頁確認；可以關閉網頁。加入或捨棄後相片會刪除。</p></div><p class="form-divider"><span>或自己輸入</span></p><label>項目<input name="title" maxlength="80" required placeholder="例如：一蘭晚餐"></label><label>分類<select name="category"><option value="">未分類</option>${catOptions("")}</select></label><fieldset class="tg-lines-edit"><legend>物品（可留空）</legend><div id="tgItemRows">${itemRow()}</div>${Kit.btn("加物品", { size: "sm", icon: "plus", attrs: { "data-tg": "itemAdd" } })}</fieldset><div class="tg-row"><label>金額<input name="amount" type="number" inputmode="decimal" min="0.01" max="10000000" step="0.01" placeholder="留空＝物品合計"></label><label>貨幣<select name="currency">${curOptions(tripCurrencies()[0])}</select></label></div><div class="tg-row"><label>誰付款<select name="paidBy">${ps.map((p) => `<option value="${esc(p.id)}"${p.id === state.user.uid ? " selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label><label>日子<select name="day">${dayOptions(today())}</select></label></div><fieldset><legend>分給</legend>${ps.map((p) => `<label class="tg-check"><input type="checkbox" name="split" value="${esc(p.id)}" checked> ${esc(p.name)}</label>`).join("")}</fieldset><p class="note">旅伴第一次登入後，才會出現在名單中。</p>${Kit.btn("記下開支", { type: "submit", variant: "primary", cls: "btn-block" })}</form>`;
    }
    return "";
  }
  function page() {
    const s = state.status;
    if (["idle", "loading", "checking"].includes(s))
      return { sig: s, shell: Kit.empty("正在連接…", "第一次載入需要數秒。") };
    if (s === "error")
      return {
        sig: s + state.error,
        shell: Kit.empty(esc(state.error || "發生錯誤"), "", Kit.btn("再試", { variant: "primary", icon: "redo", attrs: { "data-tg": "retry" } })),
      };
    if (s === "signedOut")
      return {
        sig: s,
        shell: `<section class="panel tg-login"><h2>旅伴專用</h2><p>行程、地點、住宿、筆記和開支只限旅伴登入查看，不會公開在網站上。</p><form class="tg-form" data-tg-form="login"><label>帳號<input name="id" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="60" required></label><label>密碼<input name="password" type="password" autocomplete="current-password" required></label>${Kit.btn("登入", { type: "submit", variant: "primary", cls: "btn-block" })}</form><div class="tg-or">或</div>${Kit.btn("用 Google 帳戶登入", { cls: "btn-block tg-google", icon: "globe", attrs: { "data-tg": "login" } })}<p class="note">這部手機會記住登入狀態，之後離線也可以查看。</p></section>`,
      };
    if (s === "notrip")
      return {
        sig: s,
        shell: `<section class="panel tg-login"><h2>建立你的第一個旅程</h2><p>填好目的地和日期，之後可以加入行程、地點、住宿和旅伴。</p>${tripForm(null)}</section>`,
      };
    if (s === "denied")
      return {
        sig: s + state.user?.uid,
        shell: `<section class="panel tg-login"><h2>這個帳戶未加入任何旅程</h2><p>你已用 <b>${esc(state.user?.email)}</b> 登入，但未加入任何旅程。請旅程負責人把你加入旅伴名單，然後按再試。</p><div class="links">${Kit.btn("再試", { variant: "primary", icon: "redo", attrs: { "data-tg": "retry" } })}${Kit.btn("登出／換帳戶", { icon: "logout", attrs: { "data-tg": "logout" } })}</div></section>`,
      };
    if (!started) return { sig: "trip", shell: Kit.empty("正在載入旅程資料…") };
    const sig = [
      "ready",
      state.tab,
      state.tab === "notes" ? state.noteKind : "",
      state.day,
      state.user.uid,
      people()
        .map((p) => p.id + p.name)
        .join(),
    ].join("|");
    return {
      sig,
      shell: `<div data-tg-live="status"></div>${Kit.chips(
        Object.entries(tabs).map(([k, v]) => ({ label: v, icon: TAB_ICONS[k], active: k === state.tab, attrs: { "data-tg-tab": k } })),
        { cls: "tabs", label: "共用分頁" },
      )}${state.tab === "expenses" ? `<div id="tgDrafts" class="tg-drafts"></div><div class="searchrow"><input id="expSearch" class="search" type="search" placeholder="搜尋項目、物品、付款人、分類、日子…" aria-label="搜尋開支" value="${esc(state.expSearch)}"></div>` : ""}${state.tab === "checklist" ? forms() : ""}<div class="tg-list" data-tg-live="list"></div>${
        state.tab === "notes"
          ? Kit.fab("新增", { "data-tg": "newEntry" })
          : state.tab === "expenses"
            ? Kit.fab("記一筆", { "data-tg": "newEntry" })
            : ""
      }`,
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
        list: `${Kit.sectionHead("旅伴筆記", Kit.btn("寫筆記", { size: "sm", icon: "plus", attrs: { "data-tg": "dayNote", "data-note-day": n } }))}${ns.length ? ns.map(noteItem).join("") : '<p class="note">這天還沒有旅伴筆記。</p>'}`,
      },
    };
  }
  function placeSlot(id) {
    if (state.status !== "ready") return { sig: "out", shell: "" };
    return {
      sig: "ready" + id,
      shell: `<section class="detail-section"><h3>旅伴筆記</h3><div data-tg-live="list"></div><form class="tg-form" data-tg-form="note" data-place-id="${esc(id)}"><textarea name="text" rows="2" maxlength="1000" required placeholder="寫下對這個地點的筆記"></textarea>${Kit.btn("加入筆記", { type: "submit", variant: "secondary" })}</form></section>`,
      live: {
        list:
          state.notes
            .filter((x) => x.placeId === id)
            .map(noteItem)
            .join("") || '<p class="note">還沒有筆記。</p>',
      },
    };
  }

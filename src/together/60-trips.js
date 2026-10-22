  // ---- 我的旅程 (trips): switch, create, copy, edit and invite companions ----
  // 我的旅程: switch trips, create one, edit the current trip, invite or remove companions (all through manageTrip).

  const currencyOptions = (sel) =>
    Object.entries(CURRENCY_NAMES)
      .map(([k, v]) => `<option value="${k}"${k === sel ? " selected" : ""}>${v} ${k}</option>`)
      .join("");
  function tripForm(t) {
    const v = (k) => esc(t?.[k] ?? "");
    return `<form class="tg-form" data-trip-form="${t ? "update" : "create"}"><label>旅程名稱<input name="name" required maxlength="60" placeholder="例如：2027 首爾" value="${v("name")}"></label><label>目的地<input name="destination" required maxlength="80" placeholder="例如：韓國首爾" value="${v("destination")}"></label><div class="tg-row"><label>開始日期<input name="startDate" type="date" required value="${v("startDate")}"></label><label>結束日期<input name="endDate" type="date" required value="${v("endDate")}"></label></div><div class="tg-row"><label>當地貨幣<select name="currency">${currencyOptions(t?.currency || "JPY")}</select></label><label>你們的貨幣<select name="homeCurrency">${currencyOptions(t?.homeCurrency || "HKD")}</select></label></div><button type="submit" class="locate-button">${t ? "儲存旅程資料" : "建立旅程"}</button><p class="note" data-trip-msg></p></form>`;
  }
  const myEmail = () => String(state.user?.email || "").toLowerCase();
  function memberLabel(email) {
    const id = email.endsWith("@" + ACCOUNT_DOMAIN) ? email.split("@")[0] : email,
      prof = state.members.find((m) => String(m.email || "").toLowerCase() === email);
    return prof?.name && prof.name !== id ? `${prof.name}（${id}）` : id;
  }
  function tripsPage() {
    const t = state.meta;
    if (!["ready", "notrip"].includes(state.status) || (t && !started))
      return { sig: "wait", shell: '<div class="empty"><h2>正在連接…</h2></div>' };
    const members = (t?.members || [])
      .map(
        (e) =>
          `<div class="pp-row"><div><b>${esc(memberLabel(e))}</b>${e === myEmail() ? "<small>你</small>" : ""}</div>${e !== myEmail() ? `<button class="smallbtn" data-trip-remove="${esc(e)}">移除</button>` : ""}</div>`,
      )
      .join("");
    const trips =
      (state.trips || [])
        .map(
          (x) =>
            `<div class="pp-row"><div><b>${esc(x.name)}</b><small>${esc(x.destination || "")} · ${esc(x.startDate || "")} → ${esc(x.endDate || "")}</small></div>${x.id === tripId ? '<span class="badge">目前</span>' : `<button class="action primary" data-trip-open="${esc(x.id)}">開啟</button>`}</div>`,
        )
        .join("") || '<p class="note">還沒有旅程。</p>';
    return {
      sig: ["trips", tripId || "", state.status].join("|"),
      shell: `${t ? `<section class="panel trip-panel"><div class="eyebrow">目前旅程</div><h2>${esc(t.name)}</h2><p class="note">${esc(t.destination || "")} · ${esc(t.startDate || "")} → ${esc(t.endDate || "")} · ${esc(CURRENCY_NAMES[t.currency] || t.currency || "")}</p><details><summary>✎ 修改旅程資料</summary>${tripForm(t)}</details>${copyForm(t)}</section><section class="panel trip-panel"><h3>旅伴</h3><div class="pp-list" data-tg-live="members"></div><details><summary>＋ 邀請旅伴</summary><form class="tg-form" data-trip-invite><div class="chips" role="radiogroup" aria-label="帳戶類型"><label class="tg-check"><input type="radio" name="kind" value="account" checked> 建立帳號 ID</label><label class="tg-check"><input type="radio" name="kind" value="google"> Google 帳戶</label></div><div class="tg-row"><label>帳號 ID 或 Gmail<input name="who" required maxlength="80" autocapitalize="none" spellcheck="false" placeholder="例如：amy 或 amy@gmail.com"></label><label>顯示名稱（帳號 ID 用）<input name="name" maxlength="40"></label></div><button type="submit" class="locate-button">邀請</button><p class="note" data-trip-msg></p></form></details></section>` : ""}<section class="panel trip-panel"><h3>我的旅程</h3><div class="pp-list" data-tg-live="trips"></div></section><section class="panel trip-panel"><details${t ? "" : " open"}><summary>＋ 建立新旅程</summary>${tripForm(null)}</details></section>`,
      live: { members, trips },
    };
  }
  // Copy the current trip as a new one (only you as companion): places, day plans (days that fit), checklist and shopping list.
  function copyForm(t) {
    return `<details><summary>⧉ 複製為新旅程</summary><form class="tg-form" data-trip-copy><label>新旅程名稱<input name="name" required maxlength="60" value="${esc((t.name + "（複本）").slice(0, 60))}"></label><div class="tg-row"><label>開始日期<input name="startDate" type="date" required value="${esc(t.startDate || "")}"></label><label>結束日期<input name="endDate" type="date" required value="${esc(t.endDate || "")}"></label></div><fieldset><legend>一併複製</legend>${[
      ["places", "探索地點"],
      ["planDays", "每日行程"],
      ["checklist", "清單（不包括已剔選）"],
      ["shopping", "購物清單（全部改為未買）"],
    ]
      .map(([k, v]) => `<label class="tg-check"><input type="checkbox" name="copy" value="${k}" checked> ${v}</label>`)
      .join(
        "",
      )}</fieldset><p class="note">新旅程只有你一位旅伴；筆記、開支、住宿、機票及收藏不會複製。</p><button type="submit" class="locate-button">建立複本</button><p class="note" data-trip-msg></p></form></details>`;
  }
  async function copyTrip(newId, what, days) {
    const { fs, db } = fb,
      u = state.user,
      stamp = () => ({ by: u.uid, byName: me().name, at: Date.now(), createdAt: fs.serverTimestamp() });
    const strip = ({ id, pending, by, byName, at, createdAt, ...d }) => d,
      col = (n) => fs.collection(db, "trips", newId, n),
      ref = (n, id) => fs.doc(db, "trips", newId, n, String(id));
    const jobs = [];
    if (what.includes("places"))
      for (const p of state.places) jobs.push(fs.setDoc(ref("places", p.id), { ...strip(p), ...stamp() }));
    if (what.includes("planDays"))
      for (const d of state.planDays)
        if (Number(d.id) <= days) {
          const { stops, label } = d;
          jobs.push(
            fs.setDoc(ref("planDays", d.id), {
              stops: stops || [],
              ...(label ? { label } : {}),
              by: u.uid,
              byName: me().name,
              at: Date.now(),
            }),
          );
        }
    if (what.includes("checklist"))
      for (const c of state.checklist)
        jobs.push(fs.addDoc(col("checklist"), { text: c.text, group: c.group, doneBy: [], ...stamp() }));
    if (what.includes("shopping"))
      for (const s of state.shopping)
        jobs.push(fs.addDoc(col("shopping"), { ...strip(s), bought: false, boughtBy: null, boughtAt: null, ...stamp() }));
    const r = await Promise.allSettled(jobs);
    return r.filter((x) => x.status === "rejected").length;
  }
  function renderTrips() {
    return `${header("MY TRIPS", "我的旅程", "切換旅程、建立新旅程及邀請旅伴")}<div id="tripsPage"></div>`;
  }
  async function tripAction(form, data, done) {
    const msg = form.querySelector("[data-trip-msg]"),
      btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    if (msg) msg.textContent = "處理中…";
    try {
      const r = (await (await callable("manageTrip", 45000))(data)).data;
      done(r);
    } catch (e) {
      if (msg)
        msg.textContent =
          String(e?.code || "").startsWith("functions/") && e.message
            ? e.message.replace(/\s*\[\d+\]$/, "")
            : "未能完成，請檢查網絡後再試。";
      console.error(e);
    } finally {
      btn.disabled = false;
    }
  }

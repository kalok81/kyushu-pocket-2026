  // ---- 購物 (shopping list): page, AI product photos, matching shops and geocoding ----
  // Product photos for the shopping list go through the same background jobs; the function adds the item itself.
  async function queueProducts(files) {
    if (files.length > 10) {
      toast("一次最多 10 張，已取頭 10 張。");
      files = files.slice(0, 10);
    }
    const { fs, db } = fb;
    let n = 0;
    for (const f of files) {
      try {
        let image = await shrink(f, 1000, 0.72);
        if (image.length > 380000) image = await shrink(f, 800, 0.65);
        fs.addDoc(tcol("receiptJobs"), {
          images: [image],
          kind: "product",
          file: String(f.name || "相片").slice(0, 120),
          status: "pending",
          by: state.user.uid,
          byName: me().name,
          at: Date.now(),
          createdAt: fs.serverTimestamp(),
        }).catch((e) => {
          toast("未能上載相片，請確認你仍在旅伴名單。");
          console.error(e);
        });
        n++;
      } catch (e) {
        toast(`${f.name || "相片"}：${scanError(e)}`);
        console.error(e);
      }
    }
    if (n) toast(`已加入 ${n} 張物品相片，AI 會在背景辨識並加入清單`);
  }
  // A product page or picture link: the function reads it in the background and adds the item like a photo.
  function queueProductLink(url) {
    let host = "";
    try {
      host = new URL(url).hostname;
    } catch {}
    if (!/^https?:\/\//i.test(url) || !host) return toast("請貼上 http:// 或 https:// 開頭的連結。");
    const { fs } = fb;
    fs.addDoc(tcol("receiptJobs"), { url: url.slice(0, 500), kind: "product", file: host.slice(0, 120), status: "pending", by: state.user.uid, byName: me().name, at: Date.now(), createdAt: fs.serverTimestamp() }).catch(() => toast("未能送出連結，請確認你仍在旅伴名單。"));
    toast("已送出連結，AI 會在背景讀取並加入清單");
  }
  // An article link that lists several products comes back as choices: tick the ones to buy, then add them together.
  const articlePicks = {},
    repaintJobs = () => {
      const el = $('[data-tg-live="jobs"]');
      if (el) el.innerHTML = productJobsHtml();
    };
  function choicesHtml(j) {
    const r = j.result,
      picks = (articlePicks[j.id] ??= new Set()),
      cur = (c) => (c.price != null ? esc(S.format(S.toMinor(c.price, c.currency), c.currency)) : "");
    return `<article class="tg-item article-choices" data-draft="${esc(j.id)}"><div class="tg-meta">${Kit.badge(`找到 ${r.choices.length} 件`)}<span>${esc(r.title || j.file)}</span></div><ul class="choice-list">${r.choices
      .map(
        (c, i) =>
          `<li><label><input type="checkbox" data-article-pick="${esc(j.id)}:${i}"${picks.has(i) ? " checked" : ""}>${c.photo ? `<img src="${photoSrc(c.photo)}" alt="">` : `<span class="choice-ph">${icon("bag")}</span>`}<span><b>${esc(c.name)}</b><small>${[c.qty, cur(c), c.place].filter(Boolean).map(esc).join(" · ")}</small>${c.detail ? `<small>${esc(c.detail)}</small>` : ""}</span></label></li>`,
      )
      .join("")}</ul><div class="links">${Kit.btn(`加入所選（${picks.size}）`, { variant: "primary", size: "sm", icon: "plus", attrs: { "data-article-add": j.id, disabled: !picks.size } })}${Kit.btn(picks.size === r.choices.length ? "全部不選" : "全選", { size: "sm", attrs: { "data-article-all": j.id } })}${Kit.btn("捨棄", { size: "sm", icon: "trash", attrs: { "data-draft-drop": j.id } })}</div></article>`;
  }
  async function addArticlePicks(id) {
    const j = jobs.find((x) => x.id === id),
      picks = [...(articlePicks[id] || [])].sort((a, b) => a - b);
    if (!j?.result?.choices || !picks.length) return;
    const { fs } = fb;
    let n = 0;
    for (const i of picks) {
      const c = j.result.choices[i];
      if (!c) continue;
      await fs
        .addDoc(tcol("shopping"), {
          name: c.name,
          qty: c.qty || "",
          detail: c.detail || "",
          cat: SHOP_CATS[c.cat] ? c.cat : "other",
          place: c.place || "",
          price: c.price ?? null,
          currency: pickCur(c.currency),
          photo: c.photo && c.photo.length <= 400000 ? c.photo : null,
          ...(j.result.link ? { url: j.result.link } : {}),
          bought: false,
          boughtBy: null,
          boughtAt: null,
          ai: true,
          by: state.user.uid,
          byName: me().name,
          at: Date.now() + n,
          createdAt: fs.serverTimestamp(),
        })
        .then(() => n++, (e) => console.error(e));
    }
    if (n) {
      fs.deleteDoc(jobRef(id)).catch(() => {});
      delete articlePicks[id];
      toast(`已加入 ${n} 件物品`);
    } else toast("未能加入，請再試。");
  }
  function productJobsHtml() {
    const pj = jobs.filter((j) => j.kind === "product" && !j.result?.choices),
      lists = jobs.filter((j) => j.kind === "product" && j.status === "done" && j.result?.choices?.length);
    if (!pj.length && !lists.length) return "";
    if (!pj.length) return `<div class="tg-drafts">${lists.map(choicesHtml).join("")}</div>`;
    const busy = pj.filter((j) => j.status !== "failed").length;
    return `<div class="tg-drafts">${lists.map(choicesHtml).join("")}<div class="tg-drafts-head"><b>${busy ? `AI 辨識中 ${busy} 項` : "未能辨識"}</b></div>${pj
      .map((j) => {
        const st = jobState(j),
          fail = st === "fail",
          retry = canRetry(j);
        return `<article class="tg-item tg-draft" data-draft="${esc(j.id)}"><div class="tg-meta">${Kit.badge(fail ? "未能辨識" : STATUS[st])}<span>${esc(j.file)}</span></div>${fail ? `<p class="note">${esc(j.error || "未能辨識。")}</p>` : Kit.progress({ seconds: j.url ? 25 : 20, since: j.at })}${fail || retry ? `<div class="links">${retry ? Kit.btn("重試", { size: "sm", icon: "redo", attrs: { "data-draft-retry": j.id } }) : ""}${Kit.btn("捨棄", { size: "sm", icon: "trash", attrs: { "data-draft-drop": j.id } })}</div>` : ""}</article>`;
      })
      .join("")}</div>`;
  }
  // Shopping list: item photos are stored inline (small JPEG) so they stay readable offline.
  let shopPhoto = null;
  const photoSrc = (b64) => `data:image/jpeg;base64,${b64}`;
  // Shopping categories (shopping/{id}.cat); the product AI picks one, and companions can change it.
  const SHOP_CATS = { drug: "💄 藥妝", food: "🍱 食品", fashion: "👕 衣服鞋袋", home: "🏠 生活用品", stationery: "✏️ 文具", toys: "🧸 玩具精品", electronics: "🔌 電器", other: "📦 其他" };
  const shopCat = (x) => (SHOP_CATS[x.cat] ? x.cat : "other");
  // Photos picked for the note or coupon being written (shrunk JPEG, base64), shown under the form until it is sent.
  const NOTE_PHOTO_MAX = 3;
  let notePhotoDraft = [];
  const notePhotoPreview = () =>
    notePhotoDraft.map((p, i) => `<span class="note-photo-thumb"><img src="${photoSrc(p)}" alt="">${Kit.btn("移除相片", { icon: "x", iconOnly: true, size: "sm", cls: "thumb-del", attrs: { "data-note-photo-del": i } })}</span>`).join("");
  async function addNotePhotos(files) {
    for (const file of files.slice(0, NOTE_PHOTO_MAX - notePhotoDraft.length)) {
      try {
        let b64 = await shrink(file, 1280, 0.8);
        if (b64.length > 300000) b64 = await shrink(file, 1000, 0.7);
        if (b64.length > 300000) {
          toast("相片太大，請截圖細一點。");
          continue;
        }
        notePhotoDraft.push(b64);
        if (notePhotoDraft.length === 1) requestNoteFill({ images: [b64] });
      } catch (e) {
        toast(scanError(e));
      }
    }
    if (files.length > NOTE_PHOTO_MAX) toast(`每則最多 ${NOTE_PHOTO_MAX} 張相片。`);
    const box = $("#notePhotoPreview");
    if (box) box.innerHTML = notePhotoPreview();
  }
  // AI fill for the note / coupon form: the first photo added, or a link typed in 連結, becomes a noteFill job;
  // the answer fills only the fields that are still empty.
  let noteFillJob = null,
    noteFillDone = () => {};
  function noteFillStatus(text, busy) {
    const i = $("#noteFillInfo");
    if (i) i.textContent = text;
    noteFillDone();
    noteFillDone = busy ? Kit.busy(i, { seconds: 15 }) : () => {};
  }
  function requestNoteFill({ images, url }) {
    if (!navigator.onLine) return noteFillStatus("離線中，AI 未能分析，請自行填寫。", false);
    const { fs } = fb,
      ref = fs.doc(tcol("receiptJobs"));
    noteFillJob = ref.id;
    fs.setDoc(ref, {
      ...(images ? { images } : { url: url.slice(0, 500) }),
      kind: "noteFill",
      mode: state.noteKind === "coupon" ? "coupon" : "note",
      file: images ? "筆記相片" : (() => { try { return new URL(url).hostname.slice(0, 120); } catch { return "網頁"; } })(),
      status: "pending",
      by: state.user.uid,
      byName: me().name,
      at: Date.now(),
      createdAt: fs.serverTimestamp(),
    }).catch(() => {
      noteFillJob = null;
      noteFillStatus("未能送出給 AI，請自行填寫。", false);
    });
    noteFillStatus(images ? "AI 正在讀取相片…" : "AI 正在讀取網頁…", true);
  }
  function handleNoteFillJobs() {
    for (const j of jobs.filter((j) => j.kind === "noteFill" && (j.status === "done" || j.status === "failed"))) {
      if (j.id === noteFillJob) {
        noteFillJob = null;
        const f = $('[data-tg-form="note"]:not([data-place-id])');
        if (j.status === "failed" || !f) noteFillStatus(j.error || "AI 未能分析，請自行填寫。", false);
        else {
          const el = f.elements,
            r = j.result || {},
            put = (n, v) => {
              if (el[n] && v && !String(el[n].value).trim()) el[n].value = v;
            };
          if (f.dataset.kind === "coupon") {
            put("title", r.title);
            put("text", r.text);
            put("code", r.code);
            put("until", r.until);
          } else put("text", [r.title, r.text].filter(Boolean).join("\n"));
          const p = r.place && placeFor(r.place);
          if (p && el.placeId && !el.placeId.value) el.placeId.value = p.id;
          noteFillStatus(
            r.kind === "coupon" && f.dataset.kind !== "coupon" ? "AI 已填入內容；看來是優惠券，可以按上面「🎟 優惠券」改為優惠券。" : "AI 已填入空白欄位，請檢查。",
            false,
          );
        }
      }
      fb.fs.deleteDoc(jobRef(j.id)).catch(() => {});
    }
  }
  function showNotePhoto(id, i) {
    const n = state.notes.find((x) => x.id === id),
      p = n?.photos?.[i];
    if (!p) return;
    $("#detailBody").innerHTML = `${Kit.sheetHead(esc(n.title || String(n.text || "").split("\n")[0].slice(0, 40)), n.kind === "coupon" ? "優惠券" : "筆記")}${n.code ? `<p class="coupon-code big"><b>${esc(n.code)}</b></p>` : ""}<img class="note-photo-full" src="${photoSrc(p)}" alt="">`;
    if (!$("#detail").open) $("#detail").showModal();
  }
  const shopPreview = () =>
    shopPhoto
      ? `<img src="${photoSrc(shopPhoto)}" alt="物品相片">${Kit.btn("移除相片", { size: "sm", icon: "x", iconOnly: true, cls: "shop-photo-del", attrs: { "data-tg": "shopPhotoClear" } })}`
      : "";
  const placeRow = (t) =>
    `<input name="place" maxlength="200" placeholder="店名、地址，或貼上 Google 地圖連結" aria-label="購買地點" value="${esc(t)}">`;
  // 購物 › AI 找購買地點: web search for where the item in the form is sold; fills empty address rows (adds rows as needed).
  // full (AI 按名稱填寫): also the product itself — a fuller name, spec, detail, category and usual price for empty fields.
  // Positions already known for 購買地點 lines in the open form (the item's pins, and shops the AI found on Google
  // Maps), so saving needs no new lookup when every line has one.
  let buyPins = new Map();
  function knownPins(place) {
    const lines = String(place || "").split("\n").filter(Boolean);
    return lines.length && lines.every((l) => buyPins.has(l)) ? lines.map((l) => buyPins.get(l)) : null;
  }
  async function findBuyPlaces(full = false) {
    const f = $('[data-tg-form="shop"]'),
      info = $("#shopPlaceInfo"),
      btn = f?.querySelector('[data-tg="shopFindAll"]'),
      name = f?.elements.name.value.trim();
    if (!f) return;
    if (!name) return toast("請先輸入物品名稱。");
    if (!navigator.onLine) return toast("離線中，未能搜尋。");
    btn.disabled = true;
    info.textContent = "AI 正在上網搜尋購買地點…";
    const placesDone = Kit.busy(info, { seconds: full ? 20 : 12 });
    if (full) fillStatus("AI 正在上網搜尋產品資料及相片…", true, 20);
    try {
      const r = (await (await callable("findBuyPlaces", 95000))({ name, qty: f.elements.qty.value, detail: f.elements.detail.value, trip: tripId, full, photo: full && !shopPhoto })).data;
      if (full) {
        const p = r.product,
          el = f.elements,
          put = (k, v) => {
            if (v != null && v !== "" && !String(el[k].value).trim()) el[k].value = v;
          };
        if (p) {
          // the product's name in its original language (as on the package) replaces what was typed; the Chinese
          // translation is added under it (translateNames)
          if (p.name) el.name.value = p.name;
          put("qty", p.qty);
          put("detail", p.detail);
          put("price", p.price);
          if (p.cat && SHOP_CATS[p.cat]) el.cat.value = p.cat;
          if (p.price != null && p.currency) el.currency.value = p.currency;
        }
        if (r.photo && !shopPhoto) {
          shopPhoto = r.photo;
          const pv = $("#shopPreview");
          if (pv) pv.innerHTML = shopPreview();
        }
        f.querySelector(".shop-more").open = true;
        fillStatus(p ? `AI 已按網上資料填入空白欄位${r.photo ? "，並加入網上的產品相片" : ""}，請檢查。` : "網上找不到這件產品的資料，請自行填寫。", false);
      }
      const rows = $("#shopPlaceRows"),
        have = new Set([...rows.querySelectorAll("input")].map((i) => i.value.trim()).filter(Boolean));
      for (const p of r.places) if (Number.isFinite(p.lat)) buyPins.set(p.name, { lat: p.lat, lng: p.lng });
      for (const p of r.places.filter((p) => !have.has(p.name))) {
        const empty = [...rows.querySelectorAll("input")].find((i) => !i.value.trim());
        if (empty) empty.value = p.name;
        else if (rows.querySelectorAll("input").length < 6) rows.insertAdjacentHTML("beforeend", placeRow(p.name));
      }
      const dropped = r.dropped ? `另有 ${r.dropped} 間在 Google 地圖找不到，已略去。` : "";
      info.textContent = r.places.length
        ? `AI 建議（已用 Google 地圖核實）：${r.places.map((p) => `${p.name}${p.why ? `（${p.why}）` : ""}`).join("；")}。${r.note ? `${r.note}。` : ""}${dropped}來源：${r.sources.join("、")}`
        : `${r.note || "網上找不到目的地有售的地方。"}${dropped}`;
    } catch (e) {
      info.textContent = fnError(e, "未能搜尋購買地點，請稍後再試。");
      if (full) fillStatus(fnError(e, "未能搜尋產品資料，請稍後再試。"), false);
    } finally {
      placesDone();
      btn.disabled = false;
    }
  }
  // One box for the item: its name, or a product page / article link. Two buttons: 相片 (photos; on a new item with no
  // name, AI adds each photographed item to the list) and AI 填寫 (by link, name, or the form's photo). The other
  // fields sit under 更多資料 until the AI has filled them or the item is edited.
  const isLink = (t) => /^https?:\/\/\S+$/i.test(String(t).trim());
  function shopForm(x) {
    const v = (k) => esc(x?.[k] ?? "");
    return `<form class="tg-form" data-tg-form="shop"><div class="shop-photo" id="shopPreview">${shopPreview()}</div><label>物品<input name="name" maxlength="500" required placeholder="${x ? "物品名稱" : "物品名稱，或貼上產品網址"}" value="${v("name")}"></label><div class="shop-actions">${Kit.btn("相片", { icon: "camera", attrs: { "data-tg": "shopPic" } })}${Kit.btn("AI 填寫", { variant: "secondary", icon: "sparkles", attrs: { "data-tg": "shopFindAll" } })}</div><input type="file" accept="image/*" id="shopPicInput" multiple hidden><p class="note" id="shopFillInfo">${
      x ? "按「AI 填寫」：AI 按名稱（或相片）上網找資料、相片及購買地點，只填空白欄位。" : "輸入名稱後按「AI 填寫」，AI 會上網找資料、相片及購買地點。貼上產品網址、或未輸入名稱時按「相片」（可多張），AI 會認出物品直接加入清單。"
    }</p><details class="shop-more"${x ? " open" : ""}><summary>更多資料（數量、購買地點、價錢…）</summary><div class="tg-row"><label>數量／規格<input name="qty" maxlength="30" placeholder="例如：2 盒、M 碼" value="${v("qty")}"></label><label>給誰<input name="forWhom" maxlength="60" placeholder="例如：媽媽、同事" value="${v("forWhom")}"></label></div><label>備註<input name="detail" maxlength="500" placeholder="例如：要辣味、限定口味" value="${v("detail")}"></label><label>分類<select name="cat">${Object.entries(SHOP_CATS)
      .map(([k, v]) => `<option value="${k}"${(x ? shopCat(x) : "food") === k ? " selected" : ""}>${v}</option>`)
      .join("")}</select></label><fieldset class="buy-places"><legend>購買地點／地址（可多個）</legend><div id="shopPlaceRows">${(x ? placesOf(x) : []).concat("").map(placeRow).join("")}</div>${Kit.btn("加入地點", { size: "sm", icon: "plus", attrs: { "data-tg": "shopPlaceAdd" } })}<p class="note" id="shopPlaceInfo">每行一個店名或地址，也可以貼上 Google 地圖連結。</p></fieldset><label>探索地點<select name="placeId"><option value="">自動（按購買地點名稱配對）</option><option value="-"${x?.placeId === "-" ? " selected" : ""}>不連結探索地點</option>${[...T().places]
      .sort((a, b) => a.v[0].localeCompare(b.v[0]) || a.v[1].localeCompare(b.v[1]))
      .map((p) => `<option value="${esc(p.id)}"${x?.placeId === p.id ? " selected" : ""}>${esc(p.v[1])}${p.v[0] ? ` · ${esc(p.v[0])}` : ""}</option>`)
      .join("")}</select></label><div class="tg-row"><label>價錢（可留空）<input name="price" type="number" inputmode="decimal" min="0" max="10000000" step="0.01" value="${x?.price ?? ""}"></label><label>貨幣<select name="currency">${curOptions(x?.currency || tripCurrencies()[0])}</select></label></div></details>${Kit.btn(x ? "儲存修改" : "加入購物清單", { type: "submit", variant: "primary", cls: "btn-block" })}</form>`;
  }
  // AI 填寫: a link goes to the AI as a product page (or an article to pick from); a name is searched on the web; with
  // only a photo, the photo is read again.
  function shopAiFill() {
    const f = $('[data-tg-form="shop"]');
    if (!f) return;
    const name = f.elements.name.value.trim();
    if (isLink(name)) {
      queueProductLink(name);
      Kit.close();
    } else if (name) findBuyPlaces(true);
    else if (shopPhoto) requestFill(shopPhoto);
    else toast("請先輸入物品名稱、貼上網址，或加相片。");
  }
  // 相片: on a new item with nothing typed, each photo becomes its own item (AI); otherwise the first is this item's photo.
  function shopPics(files) {
    const f = $('[data-tg-form="shop"]');
    if (!state.shopEdit && !f?.elements.name.value.trim()) {
      if (state.status === "ready") queueProducts(files);
      Kit.close();
    } else pickShopPhoto(files[0]);
  }
  function shopItem(x) {
    const price = x.price != null ? `<b class="shop-price">${esc(S.format(S.toMinor(x.price, x.currency), x.currency))}</b>` : "";
    return `<article class="tg-item shop-item${x.bought ? " bought" : ""}">${x.photo ? `<button type="button" class="shop-thumb" data-shop-open="${esc(x.id)}" aria-label="放大 ${esc(x.name)} 的相片"><img src="${photoSrc(x.photo)}" alt=""></button>` : ""}<div>${itemTop(x, `${Kit.badge(SHOP_CATS[shopCat(x)], "shop-cat")}${x.ai ? Kit.badge("AI 填寫") : ""}`, [{ label: "編輯", icon: "edit", attrs: { "data-shop-edit": x.id } }, del("shopping", x)])}<div class="tg-expense"><h3>${esc(x.name)}${x.qty ? ` <small>· ${esc(x.qty)}</small>` : ""}${zhLine(zhName(x, x.name))}</h3>${price}</div>${x.forWhom ? `<p class="shop-place shop-for">${icon("users")}<span>給：${esc(x.forWhom)}</span></p>` : ""}${x.detail ? `<p class="tg-text">${esc(x.detail)}</p>` : ""}${matchPlaces(x).length ? `<p class="shop-place">${icon("compass")}探索：${matchPlaces(x).map((p) => `<button type="button" class="buy-item" data-place="${esc(p.id)}">${esc(p.v[1])}</button>`).join("、")}</p>` : ""}${placesOf(x).map((t) => `<p class="shop-place">${icon("pin")}<span>${esc(t)}</span>${Kit.btn(`${esc(t)} 地圖`, { href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(t)}`, external: true, icon: "map", iconOnly: true, variant: "ghost", size: "sm" })}</p>`).join("")}${x.bought ? `<p class="note">✓ ${esc(x.boughtBy || "旅伴")} 已買 · ${esc(when(x.boughtAt))}</p>` : ""}<div class="links">${Kit.btn(x.bought ? "改回未買" : "已買", { size: "sm", variant: x.bought ? "outline" : "secondary", icon: x.bought ? "undo" : "check", attrs: { "data-shop-toggle": x.id } })}${x.url ? Kit.btn("產品網頁", { size: "sm", external: true, href: x.url }) : ""}</div></div></article>`;
  }
  // Photo grid: one tile per item; tapping opens the item with a large photo in the detail dialog.
  function shopTile(x) {
    const price = x.price != null ? esc(S.format(S.toMinor(x.price, x.currency), x.currency)) : "";
    return `<button type="button" class="shop-tile${x.bought ? " bought" : ""}" data-shop-open="${esc(x.id)}">${x.photo ? `<img src="${photoSrc(x.photo)}" alt="" loading="lazy">` : `<span class="shop-tile-ph" aria-hidden="true">${icon("bag")}</span>`}<span class="shop-tile-name">${x.bought ? "✓ " : ""}${esc(zhName(x, x.name) || x.name)}</span>${price ? `<span class="shop-tile-price">${price}</span>` : ""}</button>`;
  }
  // Add / edit sheet: AI from photos or a link first, then the form for typing an item in.
  function openShopSheet(x = null) {
    state.shopEdit = x?.id || null;
    shopPhoto = x?.photo || null;
    buyPins = new Map(x ? placesOf(x).map((t, i) => [t, pinOf(x, i)]).filter(([, p]) => p) : []);
    Kit.open(
      `${Kit.sheetHead(x ? "修改物品" : "加入購物清單")}${
        x
          ? ""
          : ""
      }${shopForm(x)}`,
    );
  }
  function openShopItem(id) {
    const x = state.shopping.find((i) => i.id === id);
    if (!x) return;
    $("#detailBody").innerHTML =
      `${x.photo ? `<img class="shop-detail-photo" src="${photoSrc(x.photo)}" alt="${esc(x.name)}">` : ""}${shopItem(x).replace(/<button type="button" class="shop-thumb"[\s\S]*?<\/button>/, "")}`;
    if (!$("#detail").open) $("#detail").showModal();
  }
  function shopPage() {
    if (state.status !== "ready") return { sig: "wait", shell: Kit.empty("正在連接…") };
    const todo = state.shopping.filter((x) => !x.bought),
      q = norm(state.shopSearch),
      match = (x) => !q || norm([x.name, zhName(x, x.name), x.qty, x.forWhom, x.detail, x.place].join(" ")).includes(q);
    const byStatus = (
        state.shopFilter === "todo" ? todo : state.shopFilter === "done" ? state.shopping.filter((x) => x.bought) : state.shopping
      ).filter(match),
      shown = state.shopCat === "all" ? byStatus : byStatus.filter((x) => shopCat(x) === state.shopCat);
    const count = (k) => byStatus.filter((x) => shopCat(x) === k).length,
      cats = [["all", "全部分類", byStatus.length], ...Object.entries(SHOP_CATS).map(([k, v]) => [k, v, count(k)]).filter(([k, , n]) => n || state.shopCat === k)]
        .map(([k, t, n]) => ({ label: `${t} ${n}`, active: state.shopCat === k, attrs: { "data-shop-cat": k } }));
    const filters = [
      ["todo", "未買", todo.length],
      ["done", "已買", state.shopping.length - todo.length],
      ["all", "全部", state.shopping.length],
    ].map(([k, t, n]) => ({ label: `${t} ${n}`, active: state.shopFilter === k, attrs: { "data-shop-filter": k } }));
    const sorted = [...shown].sort((a, b) => a.bought - b.bought || (b.at || 0) - (a.at || 0)),
      block = (xs) => (state.shopView === "grid" ? `<div class="shop-grid">${xs.map(shopTile).join("")}</div>` : xs.map(shopItem).join(""));
    // All categories: one heading per category, in the order of SHOP_CATS.
    const list = shown.length
      ? state.shopCat === "all"
        ? Object.keys(SHOP_CATS)
            .map((k) => [k, sorted.filter((x) => shopCat(x) === k)])
            .filter(([, xs]) => xs.length)
            .map(([k, xs]) => `<h3 class="shop-cat-head">${SHOP_CATS[k]} <small>${xs.length}</small></h3>${block(xs)}`)
            .join("")
        : block(sorted)
      : q
        ? Kit.empty(`找不到「${esc(state.shopSearch)}」`, "試試其他字，或清除搜尋。")
        : state.shopFilter === "done"
          ? Kit.empty("還沒有已買的東西", "買了之後按「已買」。")
          : Kit.empty("清單是空的", "按右下角「加入物品」，影相讓 AI 認物品，或自己輸入。");
    return {
      sig: ["shop", state.shopView, state.user.uid].join("|"),
      shell: `<div data-tg-live="status"></div><div data-tg-live="jobs"></div><div class="searchrow shop-tools"><input id="shopSearch" class="search" type="search" placeholder="搜尋物品、地點、備註…" aria-label="搜尋購物清單" value="${esc(state.shopSearch)}">${Kit.chips(
        [
          { label: '<span class="sr-only">列表</span>', icon: "list", active: state.shopView === "list", attrs: { "data-shop-view": "list", title: "列表" } },
          { label: '<span class="sr-only">相片</span>', icon: "grid", active: state.shopView === "grid", attrs: { "data-shop-view": "grid", title: "相片" } },
        ],
        { cls: "view-toggle", label: "顯示方式" },
      )}</div><div data-tg-live="filters"></div><div data-tg-live="cats"></div><div class="tg-list" data-tg-live="list"></div>${Kit.fab("加入物品", { "data-tg": "shopAdd" })}`,
      live: {
        status: statusBar(),
        jobs: productJobsHtml(),
        filters: Kit.chips(filters, { cls: "tabs", label: "篩選" }),
        cats: Kit.chips(cats, { cls: "shop-cats", label: "分類" }),
        list,
      },
    };
  }
  // Match a 購買地點 to an explore shop: the whole name, or one distinctive word of it (島本, 唐十), compared without
  // spaces/brackets/punctuation and with 雞/鶏 treated alike; generic words (博多, 本店…) never match on their own.
  const norm = (t) =>
    String(t)
      .toLowerCase()
      .replace(/[雞鷄]/g, "鶏")
      .replace(/[\s（）()【】「」『』・･,，、.。:：\-－−&＆’']/g, "");
  const GENERIC = new Set([
    "博多",
    "天神",
    "福岡",
    "本店",
    "博多店",
    "天神店",
    "jr",
    "博多駅",
    "博多站",
    "由布院",
    "湯布院",
    "別府",
    "佐賀",
    "太宰府",
    "中洲",
    "大名",
    "店",
    "分店",
    "cafe",
    "coffee",
    "shop",
  ]);
  const nameWords = (n) =>
    String(n)
      .split(/[\s（）()【】「」『』・･,，、]+/)
      .map(norm)
      .filter((x) => x.length >= (/^[a-z0-9]+$/.test(x) ? 4 : 2) && !GENERIC.has(x));
  const placeFor = (text) => {
    const t = norm(text);
    if (!t) return null;
    const ps = T().places;
    return (
      ps.find((p) => norm(p.v[1]).length >= 2 && t.includes(norm(p.v[1]))) ||
      ps.find((p) => nameWords(p.v[1]).some((k) => t.includes(k)))
    );
  };
  // The explore place an item is bought at: the one chosen on the item ("-" = none), else matched from 購買地點.
  // 購買地點 can hold several addresses, one per line (the first is the main one); pins[i] are their coordinates.
  const placesOf = (x) =>
    String(x.place || "")
      .split("\n")
      .map((t) => t.trim())
      .filter(Boolean);
  // (only while the coordinates still belong to the current addresses: geoFor)
  const pinOf = (x, i) => {
    if (x.geoFor !== x.place) return null;
    const p = x.pins?.[i] ?? (i === 0 && { lat: x.lat, lng: x.lng });
    return p && Number.isFinite(p.lat) && Number.isFinite(p.lng) ? p : null;
  };
  // The explore place of address i: the one chosen on the item (for the first address; "-" = none), else matched by name.
  const linePlace = (x, i) =>
    x.placeId === "-"
      ? null
      : (i === 0 && x.placeId && T().places.find((p) => p.id === x.placeId)) || placeFor(placesOf(x)[i] || "") || null;
  const matchPlaces = (x) => [...new Set(placesOf(x).map((_, i) => linePlace(x, i)).filter(Boolean))];
  const matchPlace = (x) => matchPlaces(x)[0] || null;
  // Set when 加入探索 turns a 購買地點 into an explore place: its items point at the new place.
  function linkShopping(ids, placeId) {
    for (const id of ids) if (state.shopping.some((x) => x.id === id)) update("shopping", id, { placeId });
  }
  // 附近 › 購物: spots where unbought list items can be bought. An explore shop named in 購買地點 uses its pin;
  // otherwise the item's own coordinates (geocoded from 購買地點). Items at the same spot share one card.
  const shopLabel = (t) =>
    String(t)
      .split(/\s*(?:日本、|日本,|〒)/)[0]
      .trim()
      .slice(0, 40) || String(t).slice(0, 40);
  // Shopping list items at a place: by its explore place (購買地點 naming that place), or by a stop's own name.
  let buyMemo = null;
  function shoppingFor() {
    const ps = T().places;
    if (buyMemo && buyMemo.list === state.shopping && buyMemo.n === ps.length) return buyMemo.map;
    const map = new Map();
    for (const x of state.shopping)
      for (const p of matchPlaces(x)) (map.get(p.id) || map.set(p.id, []).get(p.id)).push({ id: x.id, name: x.name, bought: !!x.bought });
    buyMemo = { list: state.shopping, n: ps.length, map };
    return map;
  }
  function shoppingAt({ placeId, title }) {
    if (placeId) {
      const m = shoppingFor().get(placeId);
      if (m) return m;
    }
    const t = norm(title || "");
    if (t.length < 2) return [];
    return state.shopping
      .filter((x) => x.place && norm(x.place).includes(t))
      .map((x) => ({ id: x.id, name: x.name, bought: !!x.bought }));
  }
  // Places to buy unbought items, for adding to the plan (coordinates not needed): explore place, else the 購買地點 text.
  function shoppingPlaces() {
    const spots = {};
    for (const x of state.shopping.filter((x) => !x.bought))
      placesOf(x).forEach((line, i) => {
        const p = linePlace(x, i),
          pin = pinOf(x, i),
          key = p ? "p:" + p.id : "t:" + norm(shopLabel(line));
        const spot = (spots[key] ??= {
          name: p ? p.v[1] : shopLabel(line),
          placeId: p ? p.id : null,
          address: p ? p.v[3] : line,
          ...(pin ? { lat: pin.lat, lng: pin.lng } : {}),
          items: [],
          ids: [],
        });
        if (spot.ids.includes(x.id)) return;
        spot.items.push(x.name);
        spot.ids.push(x.id);
      });
    return Object.values(spots);
  }
  function shoppingSpots() {
    const spots = {},
      geo = window.TRIP_GEO?.places || {};
    for (const x of state.shopping.filter((x) => !x.bought))
      placesOf(x).forEach((line, i) => {
        const p = linePlace(x, i),
          pin = p && geo[p.id]?.[0],
          own = pinOf(x, i);
        let key, spot;
        if (pin) {
          key = "p:" + p.id;
          spot = { name: p.v[1], lat: pin.lat, lng: pin.lng, placeId: p.id, address: p.v[3] };
        } else if (own) {
          key = `${own.lat.toFixed(4)},${own.lng.toFixed(4)}`;
          spot = { name: shopLabel(line), lat: own.lat, lng: own.lng, placeId: null, address: line };
        } else return;
        const s = (spots[key] ??= { ...spot, items: [] });
        if (!s.items.includes(x.name)) s.items.push(x.name);
      });
    return Object.values(spots);
  }
  // Geocode 購買地點 once per text (geoFor remembers which text the coordinates belong to); one at a time.
  let geocoding = false;
  async function geocodeShopping() {
    if (geocoding || !navigator.onLine || state.status !== "ready" || !started) return;
    const todo = state.shopping.filter((x) => x.place && x.geoFor !== x.place && !x.pending).slice(0, 10);
    if (!todo.length) return;
    geocoding = true;
    try {
      const call = await callable("lookupPlace", 45000);
      for (const x of todo) {
        try {
          // one lookup per address; an address Google cannot find gets no pin
          const pins = [];
          for (const line of placesOf(x).slice(0, 6))
            try {
              const r = (await call({ query: line, country: state.meta?.country || "" })).data;
              pins.push(Number.isFinite(r.lat) && Number.isFinite(r.lng) ? { lat: r.lat, lng: r.lng } : null);
            } catch (e) {
              if (!String(e?.code || "").endsWith("not-found")) throw e;
              pins.push(null);
            }
          await fb.fs.updateDoc(tdoc("shopping", x.id), { lat: pins[0]?.lat ?? null, lng: pins[0]?.lng ?? null, pins, geoFor: x.place });
        } catch (e) {
          console.error("geocode", e);
          break;
        }
      }
    } finally {
      geocoding = false;
    }
  }
  // A Google Maps link pasted into 購買地點 becomes the shop name and address.
  const MAPS_LINK = /^https:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|(www\.)?google\.[a-z.]+\/maps|maps\.google\.[a-z.]+)/i;
  async function placeFromMaps(input) {
    const url = input.value.trim().match(/https:\/\/\S+/)?.[0];
    if (!url || !MAPS_LINK.test(url) || input.dataset.looking) return;
    const hint = $("#shopPlaceInfo");
    input.disabled = true;
    input.dataset.looking = "1";
    if (hint) hint.textContent = "正在查詢 Google 地圖…";
    const mapDone = Kit.busy(hint, { seconds: 5 });
    try {
      const r = await lookupPlace(url);
      input.value = [r.name, r.address].filter(Boolean).join(" ").slice(0, 200);
      if (hint) hint.textContent = "已由 Google 地圖填入。";
    } catch (e) {
      if (hint) hint.textContent = "未能讀取地圖連結，請手動輸入店名或地址。";
      console.error(e);
    } finally {
      mapDone();
      input.disabled = false;
      delete input.dataset.looking;
    }
  }
  function renderShopping() {
    return `${header("購物清單")}<div id="shopPage"></div>`;
  }
  async function pickShopPhoto(file) {
    try {
      let b = await shrink(file, 900, 0.7);
      if (b.length > 380000) b = await shrink(file, 600, 0.6);
      shopPhoto = b;
      const p = $("#shopPreview");
      if (p) p.innerHTML = shopPreview();
      requestFill(b);
    } catch (e) {
      toast("未能讀取這張相片，請改用 JPG 或 PNG，或直接影相。");
      console.error(e);
    }
  }
  // Form photo → a productFill job; when the function answers, fill the empty fields of the open form.
  let fillJob = null,
    fillDone = () => {};
  function fillStatus(text, busy, seconds = 15) {
    const i = $("#shopFillInfo");
    if (i) i.textContent = text;
    fillDone();
    fillDone = busy ? Kit.busy(i, { seconds }) : () => {};
  }
  function requestFill(image) {
    if (!navigator.onLine) return fillStatus("離線中，AI 未能辨識，請手動輸入。", false);
    const { fs, db } = fb,
      ref = fs.doc(tcol("receiptJobs"));
    fillJob = ref.id;
    fs.setDoc(ref, {
      images: [image],
      kind: "productFill",
      file: "購物表格相片",
      status: "pending",
      by: state.user.uid,
      byName: me().name,
      at: Date.now(),
      createdAt: fs.serverTimestamp(),
    }).catch((e) => {
      fillJob = null;
      fillStatus("未能上載相片給 AI，請手動輸入。", false);
      console.error(e);
    });
    fillStatus("AI 正在辨識物品…", true);
  }
  function handleFillJobs() {
    for (const j of jobs.filter((j) => j.kind === "productFill" && (j.status === "done" || j.status === "failed"))) {
      if (j.id === fillJob) {
        fillJob = null;
        const f = $('[data-tg-form="shop"]');
        if (j.status === "failed" || !f) fillStatus(j.error || "AI 未能辨識，請手動輸入。", false);
        else {
          const el = f.elements,
            r = j.result || {},
            put = (n, v) => {
              const input = f.querySelector(`[name="${n}"]`);
              if (v != null && v !== "" && input && !String(input.value).trim()) input.value = v;
            };
          put("name", r.name);
          put("qty", r.qty);
          put("detail", r.detail);
          put("place", r.place);
          put("price", r.price);
          if (r.cat && SHOP_CATS[r.cat]) el.cat.value = r.cat;
          if (r.price != null && r.currency) el.currency.value = r.currency;
          f.querySelector(".shop-more").open = true;
          fillStatus("AI 已填入空白欄位，請檢查。", false);
        }
      }
      fb.fs.deleteDoc(jobRef(j.id)).catch(() => {});
    }
  }

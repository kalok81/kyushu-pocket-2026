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
  function productJobsHtml() {
    const pj = jobs.filter((j) => j.kind === "product");
    if (!pj.length) return "";
    const busy = pj.filter((j) => j.status !== "failed").length;
    return `<div class="tg-drafts"><div class="tg-drafts-head"><b>${busy ? `AI 辨識中 ${busy} 項` : "未能辨識"}</b></div>${pj
      .map((j) => {
        const st = jobState(j),
          fail = st === "fail",
          retry = canRetry(j);
        return `<article class="tg-item tg-draft" data-draft="${esc(j.id)}"><div class="tg-meta"><span class="badge">${fail ? "未能辨識" : STATUS[st]}</span><span>${esc(j.file)}</span></div>${fail ? `<p class="note">${esc(j.error || "未能辨識。")}</p>` : '<div class="tg-progress tg-progress-busy"><div></div></div>'}${fail || retry ? `<div class="links">${retry ? `<button type="button" class="smallbtn" data-draft-retry="${esc(j.id)}">重試</button>` : ""}<button type="button" class="smallbtn" data-draft-drop="${esc(j.id)}">捨棄</button></div>` : ""}</article>`;
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
    notePhotoDraft.map((p, i) => `<span class="note-photo-thumb"><img src="${photoSrc(p)}" alt=""><button type="button" class="smallbtn" data-note-photo-del="${i}" aria-label="移除相片">×</button></span>`).join("");
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
      } catch (e) {
        toast(scanError(e));
      }
    }
    if (files.length > NOTE_PHOTO_MAX) toast(`每則最多 ${NOTE_PHOTO_MAX} 張相片。`);
    const box = $("#notePhotoPreview");
    if (box) box.innerHTML = notePhotoPreview();
  }
  function showNotePhoto(id, i) {
    const n = state.notes.find((x) => x.id === id),
      p = n?.photos?.[i];
    if (!p) return;
    $("#detailBody").innerHTML = `<div class="eyebrow">${n.kind === "coupon" ? "COUPON" : "NOTE"}</div><h2 class="detailtitle">${esc(n.title || String(n.text || "").split("\n")[0].slice(0, 40))}</h2>${n.code ? `<p class="coupon-code big"><b>${esc(n.code)}</b></p>` : ""}<img class="note-photo-full" src="${photoSrc(p)}" alt="">`;
    if (!$("#detail").open) $("#detail").showModal();
  }
  const shopPreview = () =>
    shopPhoto
      ? `<img src="${photoSrc(shopPhoto)}" alt="物品相片"><button type="button" class="smallbtn" data-tg="shopPhotoClear">移除相片</button>`
      : "";
  function shopForm(x) {
    const v = (k) => esc(x?.[k] ?? "");
    return `<form class="panel tg-form" data-tg-form="shop"><div class="shop-photo"><div id="shopPreview">${shopPreview()}</div><button type="button" class="action primary" data-tg="shopPhoto">📷 影相／上載圖片（AI 填寫）</button><input type="file" accept="image/*" id="shopPhotoInput" hidden><div class="tg-progress tg-progress-busy" id="shopFillBar" hidden><div></div></div><p class="note" id="shopFillInfo">加相片後，AI 會把物品資料填入下面的空白欄位。</p></div><label>物品<input name="name" maxlength="80" required placeholder="例如：明太子禮盒" value="${v("name")}"></label><div class="tg-row"><label>數量／規格<input name="qty" maxlength="30" placeholder="例如：2 盒、M 碼" value="${v("qty")}"></label><label>給誰／備註<input name="detail" maxlength="500" placeholder="例如：媽媽、要辣味" value="${v("detail")}"></label></div><label>分類<select name="cat">${Object.entries(SHOP_CATS)
      .map(([k, v]) => `<option value="${k}"${(x ? shopCat(x) : "food") === k ? " selected" : ""}>${v}</option>`)
      .join("")}</select></label><label>購買地點／地址<input name="place" maxlength="500" placeholder="店名、地址，或貼上 Google 地圖連結" value="${v("place")}"></label><label>探索地點<select name="placeId"><option value="">自動（按購買地點名稱配對）</option><option value="-"${x?.placeId === "-" ? " selected" : ""}>不連結探索地點</option>${[...T().places]
      .sort((a, b) => a.v[0].localeCompare(b.v[0]) || a.v[1].localeCompare(b.v[1]))
      .map((p) => `<option value="${esc(p.id)}"${x?.placeId === p.id ? " selected" : ""}>${esc(p.v[1])}${p.v[0] ? ` · ${esc(p.v[0])}` : ""}</option>`)
      .join("")}</select></label><p class="note" id="shopPlaceInfo"></p><div class="tg-row"><label>價錢（可留空）<input name="price" type="number" inputmode="decimal" min="0" max="10000000" step="0.01" value="${x?.price ?? ""}"></label><label>貨幣<select name="currency">${curOptions(x?.currency || tripCurrencies()[0])}</select></label></div><div class="links"><button type="submit" class="locate-button">${x ? "儲存修改" : "加入購物清單"}</button>${x ? '<button type="button" class="action" data-tg="shopCancel">取消</button>' : ""}</div></form>`;
  }
  function shopItem(x) {
    const price = x.price != null ? `<b class="shop-price">${esc(S.format(S.toMinor(x.price, x.currency), x.currency))}</b>` : "";
    return `<article class="tg-item shop-item${x.bought ? " bought" : ""}">${x.photo ? `<img class="shop-thumb" src="${photoSrc(x.photo)}" alt="${esc(x.name)}" data-shop-zoom>` : ""}<div>${meta(x, `<span class="badge shop-cat">${SHOP_CATS[shopCat(x)]}</span>${x.ai ? '<span class="badge">AI 填寫</span>' : ""}`)}<div class="tg-expense"><h3>${esc(x.name)}${x.qty ? ` <small>· ${esc(x.qty)}</small>` : ""}</h3>${price}</div>${x.detail ? `<p class="tg-text">${esc(x.detail)}</p>` : ""}${x.url ? `<p class="shop-place"><a class="action" href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">🔗 產品網頁 ↗</a></p>` : ""}${matchPlace(x) ? `<p class="shop-place">🏷 探索：<button type="button" class="buy-item" data-place="${esc(matchPlace(x).id)}">${esc(matchPlace(x).v[1])}</button></p>` : ""}${x.place ? `<p class="shop-place">📍 ${esc(x.place)} <a class="action" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(x.place)}" target="_blank" rel="noopener noreferrer">地圖 ↗</a></p>` : ""}${x.bought ? `<p class="note">✓ ${esc(x.boughtBy || "旅伴")} 已買 · ${esc(when(x.boughtAt))}</p>` : ""}<div class="links"><button class="action${x.bought ? "" : " primary"}" data-shop-toggle="${esc(x.id)}">${x.bought ? "↺ 改回未買" : "✓ 已買"}</button><button class="smallbtn" data-shop-edit="${esc(x.id)}">編輯</button>${del("shopping", x)}</div></div></article>`;
  }
  // Photo grid: one tile per item; tapping opens the item with a large photo in the detail dialog.
  function shopTile(x) {
    const price = x.price != null ? esc(S.format(S.toMinor(x.price, x.currency), x.currency)) : "";
    return `<button type="button" class="shop-tile${x.bought ? " bought" : ""}" data-shop-open="${esc(x.id)}">${x.photo ? `<img src="${photoSrc(x.photo)}" alt="" loading="lazy">` : '<span class="shop-tile-ph" aria-hidden="true">🛍</span>'}<span class="shop-tile-name">${x.bought ? "✓ " : ""}${esc(x.name)}</span>${price ? `<span class="shop-tile-price">${price}</span>` : ""}</button>`;
  }
  function openShopItem(id) {
    const x = state.shopping.find((i) => i.id === id);
    if (!x) return;
    $("#detailBody").innerHTML =
      `${x.photo ? `<img class="shop-detail-photo" src="${photoSrc(x.photo)}" alt="${esc(x.name)}">` : ""}${shopItem(x).replace(/<img class="shop-thumb"[^>]*>/, "")}`;
    if (!$("#detail").open) $("#detail").showModal();
  }
  function shopPage() {
    if (state.status !== "ready") return { sig: "wait", shell: '<div class="empty"><h2>正在連接…</h2></div>' };
    const edit = state.shopping.find((x) => x.id === state.shopEdit);
    if (state.shopEdit && !edit) {
      state.shopEdit = null;
      shopPhoto = null;
    }
    const todo = state.shopping.filter((x) => !x.bought),
      q = norm(state.shopSearch),
      match = (x) => !q || norm([x.name, x.qty, x.detail, x.place].join(" ")).includes(q);
    const byStatus = (
        state.shopFilter === "todo" ? todo : state.shopFilter === "done" ? state.shopping.filter((x) => x.bought) : state.shopping
      ).filter(match),
      shown = state.shopCat === "all" ? byStatus : byStatus.filter((x) => shopCat(x) === state.shopCat);
    const count = (k) => byStatus.filter((x) => shopCat(x) === k).length,
      cats = [["all", "全部分類", byStatus.length], ...Object.entries(SHOP_CATS).map(([k, v]) => [k, v, count(k)]).filter(([k, , n]) => n || state.shopCat === k)]
        .map(([k, t, n]) => `<button class="chip ${state.shopCat === k ? "active" : ""}" data-shop-cat="${k}" aria-pressed="${state.shopCat === k}">${t} ${n}</button>`)
        .join("");
    const filters = [
      ["todo", "未買", todo.length],
      ["done", "已買", state.shopping.length - todo.length],
      ["all", "全部", state.shopping.length],
    ]
      .map(
        ([k, t, n]) =>
          `<button class="chip ${state.shopFilter === k ? "active" : ""}" data-shop-filter="${k}" aria-pressed="${state.shopFilter === k}">${t} ${n}</button>`,
      )
      .join("");
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
        ? `<div class="empty"><h2>找不到「${esc(state.shopSearch)}」</h2><p>試試其他字，或清除搜尋。</p></div>`
        : `<div class="empty"><h2>${state.shopFilter === "done" ? "還沒有已買的東西" : "清單是空的"}</h2><p>${state.shopFilter === "done" ? "買了之後按「✓ 已買」。" : "把想買的東西加進來，旅伴都看得到。"}</p></div>`;
    return {
      sig: ["shop", state.shopEdit || "", state.shopView, state.user.uid].join("|"),
      shell: `<div class="tg-status" data-tg-live="status"></div>${edit ? "" : '<div class="panel shop-ai"><b>✨ AI 認物品，自動加入清單</b><div class="links"><button type="button" class="locate-button" data-tg="shopAiCam">📷 影相</button><button type="button" class="locate-button" data-tg="shopAi">🖼 上載相片（可多張）</button></div><input type="file" accept="image/*" capture="environment" id="shopAiCam" hidden><input type="file" accept="image/*" id="shopAiInput" multiple hidden><form class="tg-form shop-link" data-tg-form="shopLink"><label>或貼上連結（產品網頁或圖片）<span class="searchrow"><input name="url" class="search" type="url" inputmode="url" autocomplete="off" placeholder="https://…" required><button type="submit" class="action primary">讀取</button></span></label></form><p class="note">AI 會認出物品、規格，以及價錢牌或網頁上的價錢，自動加入清單，之後可以修改。也可以直接貼上截圖。可以關閉網頁，AI 會在背景完成。</p></div>'}<div data-tg-live="jobs"></div>${shopForm(edit)}<div class="searchrow shop-tools"><input id="shopSearch" class="search" type="search" placeholder="搜尋物品、地點、備註…" aria-label="搜尋購物清單" value="${esc(state.shopSearch)}"><div class="chips" role="group" aria-label="顯示方式"><button class="chip ${state.shopView === "list" ? "active" : ""}" data-shop-view="list" aria-pressed="${state.shopView === "list"}">☰ 列表</button><button class="chip ${state.shopView === "grid" ? "active" : ""}" data-shop-view="grid" aria-pressed="${state.shopView === "grid"}">▦ 相片</button></div></div><div class="chips" role="group" aria-label="篩選" data-tg-live="filters"></div><div class="chips shop-cats" role="group" aria-label="分類" data-tg-live="cats"></div><div class="tg-list" data-tg-live="list"></div>`,
      live: { status: statusBar(), jobs: productJobsHtml(), filters, cats, list },
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
  const matchPlace = (x) =>
    x.placeId === "-" ? null : (x.placeId && T().places.find((p) => p.id === x.placeId)) || (x.place ? placeFor(x.place) : null);
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
    for (const x of state.shopping) {
      if (!x.place) continue;
      const p = matchPlace(x);
      if (p) (map.get(p.id) || map.set(p.id, []).get(p.id)).push({ id: x.id, name: x.name, bought: !!x.bought });
    }
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
    for (const x of state.shopping.filter((x) => !x.bought && x.place)) {
      const p = matchPlace(x),
        key = p ? "p:" + p.id : "t:" + norm(shopLabel(x.place));
      const spot = (spots[key] ??= {
        name: p ? p.v[1] : shopLabel(x.place),
        placeId: p ? p.id : null,
        address: p ? p.v[3] : x.place,
        ...(Number.isFinite(x.lat) && Number.isFinite(x.lng) ? { lat: x.lat, lng: x.lng } : {}),
        items: [],
        ids: [],
      });
      spot.items.push(x.name);
      spot.ids.push(x.id);
    }
    return Object.values(spots);
  }
  function shoppingSpots() {
    const spots = {},
      geo = window.TRIP_GEO?.places || {};
    for (const x of state.shopping.filter((x) => !x.bought && x.place)) {
      const p = matchPlace(x),
        pin = p && geo[p.id]?.[0];
      let key, spot;
      if (pin) {
        key = "p:" + p.id;
        spot = { name: p.v[1], lat: pin.lat, lng: pin.lng, placeId: p.id, address: p.v[3] };
      } else if (Number.isFinite(x.lat) && Number.isFinite(x.lng)) {
        key = `${x.lat.toFixed(4)},${x.lng.toFixed(4)}`;
        spot = { name: shopLabel(x.place), lat: x.lat, lng: x.lng, placeId: null, address: x.place };
      } else continue;
      (spots[key] ??= { ...spot, items: [] }).items.push(x.name);
    }
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
          const r = (await call({ query: x.place, country: state.meta?.country || "" })).data;
          await fb.fs.updateDoc(tdoc("shopping", x.id), {
            lat: Number.isFinite(r.lat) ? r.lat : null,
            lng: Number.isFinite(r.lng) ? r.lng : null,
            geoFor: x.place,
          });
        } catch (e) {
          if (String(e?.code || "").endsWith("not-found"))
            await fb.fs.updateDoc(tdoc("shopping", x.id), { lat: null, lng: null, geoFor: x.place }).catch(() => {});
          else {
            console.error("geocode", e);
            break;
          }
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
    try {
      const r = await lookupPlace(url);
      input.value = [r.name, r.address].filter(Boolean).join(" ").slice(0, 200);
      if (hint) hint.textContent = "已由 Google 地圖填入。";
    } catch (e) {
      if (hint) hint.textContent = "未能讀取地圖連結，請手動輸入店名或地址。";
      console.error(e);
    } finally {
      input.disabled = false;
      delete input.dataset.looking;
    }
  }
  function renderShopping() {
    return `${header("SHOPPING LIST", "要買的，都記下來。", "相片、地點和價錢 · 旅伴共用，買了就打勾")}<div id="shopPage"></div>`;
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
  let fillJob = null;
  function fillStatus(text, busy) {
    const i = $("#shopFillInfo"),
      b = $("#shopFillBar");
    if (i) i.textContent = text;
    if (b) b.hidden = !busy;
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
              if (v != null && v !== "" && !String(el[n].value).trim()) el[n].value = v;
            };
          put("name", r.name);
          put("qty", r.qty);
          put("detail", r.detail);
          put("place", r.place);
          put("price", r.price);
          if (r.cat && SHOP_CATS[r.cat]) el.cat.value = r.cat;
          if (r.price != null && r.currency) el.currency.value = r.currency;
          fillStatus("AI 已填入空白欄位，請檢查。", false);
        }
      }
      fb.fs.deleteDoc(jobRef(j.id)).catch(() => {});
    }
  }

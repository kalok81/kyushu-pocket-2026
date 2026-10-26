  // ---- 購物: the add / edit sheet and its AI helpers (購買地點 search, AI 填寫) ----
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
    if (full) fillStatus("AI 正在上網搜尋產品資料、使用評價及相片…", true, 25);
    try {
      const r = (await (await callable("findBuyPlaces", 95000))({ name, qty: f.elements.qty.value, detail: f.elements.detail.value, trip: tripId, full, photo: full && !shopPhoto })).data;
      if (full) {
        const p = r.product,
          el = f.elements,
          put = (k, v) => {
            if (v != null && v !== "" && !String(el[k].value).trim()) el[k].value = v;
          };
        put("reviews", r.reviews);
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
        fillStatus(p ? `AI 已按網上資料填入空白欄位${r.reviews ? "（包括使用評價）" : ""}${r.photo ? "，並加入網上的產品相片" : ""}，請檢查。` : r.reviews ? "網上找不到這件產品的資料，只填入了使用評價，請檢查。" : "網上找不到這件產品的資料，請自行填寫。", false);
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
  // 探索地點 (shopping) and 地點 (notes): typed with suggestions ("名稱 · 區域"); for shopping, empty = matched by the
  // 購買地點 names and NO_PLACE = none ("-").
  const NO_PLACE = "不連結探索地點";
  const placeLabel = (p) => (p ? `${p.v[1]}${p.v[0] ? ` · ${p.v[0]}` : ""}` : "");
  function placeIdOf(text) {
    const t = String(text || "").trim();
    if (!t) return "";
    if (t === NO_PLACE) return "-";
    const p = T().places.find((p) => placeLabel(p) === t) || T().places.find((p) => p.v[1] === t);
    if (!p) toast(`找不到探索地點「${t}」，改為按購買地點自動配對。`);
    return p?.id || "";
  }
  function shopForm(x) {
    const v = (k) => esc(x?.[k] ?? "");
    return `<form class="tg-form" data-tg-form="shop"><div class="shop-photo" id="shopPreview">${shopPreview()}</div><label>物品<input name="name" maxlength="500" required placeholder="${x ? "物品名稱" : "物品名稱，或貼上產品網址"}" value="${v("name")}"></label><div class="shop-actions">${Kit.btn("相片", { icon: "camera", attrs: { "data-tg": "shopPic" } })}${Kit.btn("AI 填寫", { variant: "secondary", icon: "sparkles", attrs: { "data-tg": "shopFindAll" } })}</div><input type="file" accept="image/*" id="shopPicInput" multiple hidden><p class="note" id="shopFillInfo">${
      x ? "按「AI 填寫」：AI 按名稱（或相片）上網找資料、使用評價、相片及購買地點，只填空白欄位。" : "輸入名稱後按「AI 填寫」，AI 會上網找資料、使用評價、相片及購買地點。貼上產品網址、或未輸入名稱時按「相片」（可多張），AI 會認出物品直接加入清單。"
    }</p><details class="fold shop-more"${x ? " open" : ""}><summary>更多資料（數量、購買地點、價錢…）</summary><div class="tg-row"><label>數量／規格<input name="qty" maxlength="30" placeholder="例如：2 盒、M 碼" value="${v("qty")}"></label><label>給誰<input name="forWhom" maxlength="60" placeholder="例如：媽媽、同事" value="${v("forWhom")}"></label></div><label>備註<input name="detail" maxlength="500" placeholder="例如：要辣味、限定口味" value="${v("detail")}"></label><label>使用評價<textarea name="reviews" rows="3" maxlength="1000" placeholder="按「AI 填寫」由 AI 上網找用家評價">${v("reviews")}</textarea></label><label>分類<select name="cat">${Object.entries(SHOP_CATS)
      .map(([k, v]) => `<option value="${k}"${(x ? shopCat(x) : "food") === k ? " selected" : ""}>${v}</option>`)
      .join("")}</select></label><fieldset class="buy-places"><legend>購買地點／地址（可多個）</legend><div id="shopPlaceRows">${(x ? placesOf(x) : []).concat("").map(placeRow).join("")}</div>${Kit.btn("加入地點", { size: "sm", icon: "plus", attrs: { "data-tg": "shopPlaceAdd" } })}<p class="note" id="shopPlaceInfo">每行一個店名或地址，也可以貼上 Google 地圖連結。</p></fieldset><label>探索地點<input name="placeQ" list="shopPlaceList" maxlength="120" autocomplete="off" placeholder="留空＝按購買地點名稱自動配對；可打字搜尋" value="${esc(x?.placeId === "-" ? NO_PLACE : placeLabel(T().places.find((p) => p.id === x?.placeId)))}"></label><datalist id="shopPlaceList"><option value="${NO_PLACE}">${[...T().places]
      .sort((a, b) => a.v[0].localeCompare(b.v[0]) || a.v[1].localeCompare(b.v[1]))
      .map((p) => `<option value="${esc(placeLabel(p))}">`)
      .join("")}</datalist><div class="tg-row"><label>價錢（可留空）<input name="price" type="number" inputmode="decimal" min="0" max="10000000" step="0.01" value="${x?.price ?? ""}"></label><label>貨幣<select name="currency">${curOptions(x?.currency || tripCurrencies()[0])}</select></label></div></details>${Kit.btn(x ? "儲存修改" : "加入物品", { type: "submit", variant: "primary", cls: "btn-block" })}</form>`;
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
    // a round tick box on the left: empty until bought (like a to-do list); tapping it again sets it back
    const tick = `<button type="button" class="shop-check${x.bought ? " on" : ""}" data-shop-toggle="${esc(x.id)}" role="checkbox" aria-checked="${x.bought}" aria-label="${x.bought ? `${esc(x.name)} 已買，按一下改回未買` : `標記 ${esc(x.name)} 為已買`}">${x.bought ? icon("check") : ""}</button>`;
    return `<article class="card tg-item shop-item${x.bought ? " bought" : ""}">${tick}${x.photo ? `<button type="button" class="shop-thumb" data-shop-open="${esc(x.id)}" aria-label="放大 ${esc(x.name)} 的相片"><img src="${photoSrc(x.photo)}" alt=""></button>` : ""}<div>${itemTop(x, `${Kit.badge(SHOP_CATS[shopCat(x)], "shop-cat")}${x.ai ? Kit.badge("AI 填寫") : ""}`, [{ label: "編輯", icon: "edit", attrs: { "data-shop-edit": x.id } }, del("shopping", x)])}<div class="tg-expense"><h3>${esc(x.name)}${x.qty ? ` <small>· ${esc(x.qty)}</small>` : ""}${zhLine(zhName(x, x.name))}</h3>${price}</div>${x.forWhom ? `<p class="shop-place shop-for">${icon("users")}<span>給：${esc(x.forWhom)}</span></p>` : ""}${x.detail ? `<p class="tg-text">${esc(x.detail)}</p>` : ""}${x.reviews ? `<details class="fold shop-reviews"><summary>使用評價</summary><p class="tg-text">${esc(x.reviews)}</p></details>` : ""}${matchPlaces(x).length ? `<p class="shop-place">${icon("compass")}探索：${matchPlaces(x).map((p) => `<button type="button" class="buy-item" data-place="${esc(p.id)}">${esc(p.v[1])}</button>`).join("、")}</p>` : ""}${placesOf(x).map((t) => `<p class="shop-place">${icon("pin")}<span>${esc(t)}</span>${Kit.btn(`${esc(t)} 地圖`, { href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(t)}`, external: true, icon: "map", iconOnly: true, variant: "ghost", size: "sm" })}</p>`).join("")}${x.bought ? `<p class="note">✓ ${esc(x.boughtBy || "旅伴")} 已買 · ${esc(when(x.boughtAt))}</p>` : ""}${x.url ? `<div class="links">${Kit.btn("產品網頁", { size: "sm", external: true, href: x.url })}</div>` : ""}</div></article>`;
  }
  // Photo grid: one tile per item; tapping opens the item with a large photo in the detail dialog.
  function shopTile(x) {
    const price = x.price != null ? esc(S.format(S.toMinor(x.price, x.currency), x.currency)) : "";
    return `<button type="button" class="card shop-tile${x.bought ? " bought" : ""}" data-shop-open="${esc(x.id)}">${x.photo ? `<img src="${photoSrc(x.photo)}" alt="" loading="lazy">` : `<span class="shop-tile-ph" aria-hidden="true">${icon("bag")}</span>`}<span class="shop-tile-name">${x.bought ? "✓ " : ""}${esc(zhName(x, x.name) || x.name)}</span>${price ? `<span class="shop-tile-price">${price}</span>` : ""}</button>`;
  }
  // Add / edit sheet: AI from photos or a link first, then the form for typing an item in.
  function openShopSheet(x = null) {
    state.shopEdit = x?.id || null;
    shopPhoto = x?.photo || null;
    buyPins = new Map(x ? placesOf(x).map((t, i) => [t, pinOf(x, i)]).filter(([, p]) => p) : []);
    Kit.open(
      `${Kit.sheetHead(x ? "修改物品" : "加入物品")}${
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

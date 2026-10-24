  // ---- 探索 (places): areas, filters, cards, details and the place form ----
  // Sub-areas (trips/{t}.areas): nearest centre within the place's own region, else address keywords.
  const areas = meta.areas || [],
    areaCache = new WeakMap();
  function areaOf(p) {
    if (areaCache.has(p)) return areaCache.get(p);
    const own = areas.filter((a) => a.region === p.v[0]),
      pool = own.length ? own : areas,
      pt = window.TRIP_GEO.places[p.id]?.[0];
    let name = "";
    if (pt) {
      const best = pool.map((a) => ({ a, d: window.Nearby.distance(pt, a) })).sort((x, y) => x.d - y.d)[0];
      if (best && best.d <= 6000) name = best.a.name;
    }
    if (!name) {
      const t = `${p.v[3]} ${p.v[1]}`,
        hit = (a) => {
          try {
            return !!a.kw && new RegExp(a.kw).test(t);
          } catch {
            return false;
          }
        };
      name = (pool.find(hit) || areas.find(hit))?.name || "";
    }
    areaCache.set(p, name);
    return name;
  }
  const inRegion = (p) =>
    region === "全部區域" || (region.startsWith("a:") ? areaOf(p) === region.slice(2) : p.v[0] === region.slice(2));
  function regionOptions() {
    const opt = (value, label) => `<option value="${esc(value)}"${value === region ? " selected" : ""}>${esc(label)}</option>`;
    return (
      opt("全部區域", "全部區域") +
      [...new Set(places.map((p) => p.v[0]))]
        .map((r) => {
          const inR = places.filter((p) => p.v[0] === r),
            subs = areas
              .filter((a) => a.region === r)
              .map((a) => [a.name, places.filter((p) => areaOf(p) === a.name).length])
              .filter(([, n]) => n);
          return subs.length
            ? `<optgroup label="${esc(r)}">${opt("r:" + r, `${r}（全部 ${inR.length}）`)}${subs.map(([n, c]) => opt("a:" + n, `${n}（${c}）`)).join("")}</optgroup>`
            : opt("r:" + r, `${r}（${inR.length}）`);
        })
        .join("")
    );
  }
  function renderExplore() {
    const chip = (c, label, ic) => ({ label, icon: ic, active: category === c, attrs: { "data-cat": c } });
    return `${header("探索", "", `${Kit.btn("AI 推薦", { size: "sm", variant: "secondary", icon: "sparkles", attrs: { "data-discover": "" } })}${Kit.btn("附近", { href: "#nearby", size: "sm", icon: "locate" })}`)}<div class="controls"><div class="searchrow"><input id="search" class="search" type="search" placeholder="搜尋店名、美食、地址…" aria-label="搜尋地點" value="${esc(search)}"><select id="region" aria-label="選擇區域或小區">${regionOptions()}</select></div>${Kit.chips(
      [
        ...["全部", ...exploreCats].map((c) => chip(c, c)),
        chip("購物清單", "購物清單", "bag"),
        { label: "收藏", icon: "star", active: onlySaved, attrs: { id: "savedToggle" } },
      ],
      { label: "分類" },
    )}</div><div id="results"></div>${Kit.fab("新增地點", { "data-place-new": true })}`;
  }
  // 🛍 購物清單 also lists 購買地點 that are not explore places yet, with 加入探索 to make them one.
  let buySpots = [];
  const spotCard = (s, k) =>
    `<article class="card place shop-spot"><div class="place-top">${Kit.badge("購物清單", "shop")}</div><h3>${esc(s.name)}</h3>${s.address && s.address !== s.name ? `<div class="region">${esc(s.address)}</div>` : ""}<p class="buy-here">${icon("bag")} 要買：${s.items.map((n, i) => `<button type="button" class="buy-item" data-shop-open="${esc(s.ids[i])}">${esc(n)}</button>`).join("、")}</p><div class="actions">${Kit.btn("加入探索", { variant: "secondary", size: "sm", icon: "plus", attrs: { "data-spot-explore": k } })}${link(Number.isFinite(s.lat) ? `https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lng}` : maps(s.address || s.name), "地圖")}</div></article>`;
  function renderResults() {
    let q = search.toLocaleLowerCase();
    const ps = places.filter(
      (p) =>
        inCategory(p) && inRegion(p) && (!onlySaved || saved.has(p.id)) && (!q || `${p.v.join(" ")} ${p.zh}`.toLocaleLowerCase().includes(q)),
    );
    buySpots =
      category === "購物清單" && region === "全部區域" && !onlySaved
        ? (window.Together?.shoppingPlaces?.() || []).filter(
            (s) => !s.placeId && (!q || `${s.name} ${s.address} ${s.items.join(" ")}`.toLocaleLowerCase().includes(q)),
          )
        : [];
    const extra = buySpots.length
      ? `${Kit.sectionHead(`未在探索清單的購買地點（${buySpots.length}）`)}<div class="cardgrid">${buySpots.map(spotCard).join("")}</div>`
      : "";
    const filtered = category !== "全部" || region !== "全部區域" || onlySaved || q;
    $("#results").innerHTML =
      `<div class="resultsbar"><span>${ps.length} 個地點${onlySaved ? " · 我的收藏" : ""}${buySpots.length ? ` · 另有 ${buySpots.length} 個購買地點` : ""}</span>${filtered ? Kit.btn("清除篩選", { variant: "ghost", size: "sm", attrs: { id: "resetFilters" } }) : ""}</div><div class="cardgrid">${ps.map((p) => placeCard(p)).join("")}</div>${extra}${ps.length || buySpots.length ? "" : Kit.empty("暫時沒有符合的地點", onlySaved ? "按地點卡上的星號，建立這部手機的收藏。" : "試試其他關鍵字，或清除篩選。")}`;
  }
  // Shopping list items bought at a place (unbought first), shown on explore cards, place details and plan stops.
  const buysAt = (q) => [...(window.Together?.shoppingAt?.(q) || [])].sort((a, b) => a.bought - b.bought);
  const buyLine = (items) => {
    const todo = items.filter((x) => !x.bought);
    return todo.length
      ? `<p class="buy-here">${icon("bag")} 要買：${todo.map((x) => `<button type="button" class="buy-item" data-shop-open="${esc(x.id)}">${esc(x.name)}</button>`).join("、")}</p>`
      : "";
  };
  function shoppingChanged() {
    if (current === "plan") refreshPlan();
    else if (current === "explore" && $("#results")) renderResults();
    else if (current === "notebook" && $("#notebookResults")) notebookResults();
  }
  // Explore card: tap anywhere for the details; the map and the star are the only buttons.
  // Google Maps for a place: the link pasted when it was added opens exactly that place; else search by name and address.
  const placeMap = (p) => p.mapsUrl || maps(p.v[1] + " " + p.v[3]);
  // Card badge: the first category (手信 shops show as 手信店) and its colour.
  function placeCat(p) {
    const c0 = p.cats.find((x) => x !== "手信") || p.cats[0] || p.v[6],
      c = c0 === "手信" ? "手信店" : c0;
    return [c, { 餐廳: "food", 景點: "sights", 商店: "shop", 手信店: "gift" }[c] || ""];
  }
  function placeCard(p, near) {
    const [c, cls] = placeCat(p),
      on = saved.has(p.id);
    return `<article class="card place${p.photo ? " has-photo" : ""}" data-card-place="${esc(p.id)}">${p.photo ? `<img class="place-thumb" src="data:image/jpeg;base64,${p.photo}" alt="" loading="lazy">` : ""}<div class="place-top">${Kit.badge(esc(c), cls)}<span class="region" title="${esc(p.v[0])}">${esc(areaOf(p) || p.v[0])}</span>${Kit.btn(`${esc(p.v[1])} 地圖`, { href: placeMap(p), external: true, variant: "ghost", size: "sm", icon: "pin", iconOnly: true })}<button class="save btn btn-ghost btn-icon btn-sm${on ? " saved" : ""}" data-save="${p.id}" aria-label="${on ? "取消收藏" : "收藏"} ${esc(p.v[1])}" aria-pressed="${on}">${icon("star")}</button></div><h3><button type="button" class="card-title" data-place="${p.id}">${esc(p.v[1])}</button>${zhLine(p.zh)}</h3>${near && typeof near === "object" ? `<div class="distance-badge">距離約 ${Math.round(near.distance)} 米${near.point.label ? " · " + esc(near.point.label) : ""}</div>` : ""}${p.v[9]?.includes("已閉店") ? '<div class="closed">已結業 · 保留原有記錄</div>' : ""}${p.v[4] ? `<p class="feature">${esc(p.v[4])}</p>` : ""}${p.v[5] ? `<p class="hours">${icon("clock")}<span>${esc(p.v[5])}</span></p>` : ""}${buyLine(buysAt({ placeId: p.id }))}</article>`;
  }
  // Place details: category and area, the main actions, then the facts as icon rows and the links as a list.
  function placeDetail(id) {
    const p = places.find((p) => p.id === id);
    if (!p) return;
    const [cat, catCls] = placeCat(p),
      on = saved.has(p.id),
      row = (ic, label, html, extra = "") =>
        `<div class="info-row">${icon(ic)}<div><small>${label}</small><p>${html}</p></div>${extra}</div>`,
      linkRow = (u, label, ic) =>
        `<a class="info-row info-link" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${icon(ic)}<div><p>${esc(label)}</p></div>${icon("external")}</a>`,
      pins = window.TRIP_GEO.places[p.id] || [],
      // 網站／參考連結: the place's own website first (its own row, named by its address), Google Maps links named as such.
      isMaps = (u) => /(^|\.)google\.[a-z.]+\/maps|maps\.google\.|maps\.app\.goo\.gl|goo\.gl\/maps/i.test(u),
      host = (u) => {
        try {
          return new URL(u).hostname.replace(/^www\./, "");
        } catch {
          return u;
        }
      },
      linkName = (u) => (/tabelog\.com/.test(u) ? "Tabelog（食評及訂座）" : host(u)),
      webs = urlList(p.v[10]),
      tabelog = webs.find((u) => /tabelog\.com/.test(u)),
      site = webs.find((u) => !isMaps(u) && u !== tabelog),
      refs = [
        ...urlList(p.v[8]).map((u, i) => linkRow(u, `影片 ${i + 1}`, "image")),
        ...webs.filter((u) => u !== site && u !== tabelog).map((u) => (isMaps(u) ? linkRow(u, "Google 地圖", "map") : linkRow(u, linkName(u), "link"))),
      ],
      buys = buysAt({ placeId: p.id });
    openDialog(
      `${p.photo ? `<figure class="place-photo detail-photo"><img src="data:image/jpeg;base64,${p.photo}" alt=""><figcaption>${p.photoBy ? `相片：${esc(p.photoBy)} · Google 地圖` : "相片：Google 地圖"}</figcaption></figure>` : ""}<div class="detail-badges">${Kit.badge(esc(cat), catCls)}<span>${esc(areaOf(p) || p.v[0])}</span></div><h2 class="detailtitle">${esc(p.v[1])}${zhLine(p.zh)}</h2>${p.v[9]?.includes("已閉店") ? '<p class="closed">已結業 · 保留原有記錄</p>' : ""}<div class="detail-actions">${Kit.btn("加入行程", { variant: "primary", icon: "plus", attrs: { "data-place-plan": p.id } })}<button class="save btn btn-outline btn-icon${on ? " saved" : ""}" data-save="${p.id}" aria-label="${on ? "取消收藏" : "收藏"}" aria-pressed="${on}">${icon("star")}</button>${Kit.btn("編輯", { icon: "edit", iconOnly: true, attrs: { "data-place-edit": p.id } })}${Kit.menu([
        { label: "複製地址", icon: "copy", attrs: { "data-copy": p.v[3] || p.v[1] } },
        { label: "刪除地點", icon: "trash", danger: true, attrs: { "data-place-delete": p.id } },
      ])}</div><div class="info-list">${[
        // Address with its map, directions and copy buttons as small icons (map and directions even without an address).
        row("pin", "地址", esc(p.v[3] || "未有地址"), `<span class="row-tools">${Kit.btn("Google 地圖", { href: placeMap(p), external: true, icon: "map", iconOnly: true, variant: "ghost", size: "sm" })}${Kit.btn("導航", { href: route(p.v[1] + " " + p.v[3]), external: true, icon: "nav", iconOnly: true, variant: "ghost", size: "sm" })}${p.v[3] ? Kit.btn("複製地址", { icon: "copy", iconOnly: true, variant: "ghost", size: "sm", attrs: { "data-copy": p.v[3] } }) : ""}</span>`),
        p.v[4] && row("sparkles", "必吃・必買・特色", esc(p.v[4])),
        p.v[5] && row("clock", "價錢及營業時間", esc(p.v[5])),
        site && linkRow(site, linkName(site), "globe").replace("<div><p>", "<div><small>網站</small><p>"),
        tabelog && linkRow(tabelog, "Tabelog", "calendar").replace("<div><p>", "<div><small>食評及訂座</small><p>"),
        p.v[11] && row("note", "備註及預約", esc(p.v[11])),
      ]
        .filter(Boolean)
        .join("")}</div>${
        buys.length
          ? `<section class="detail-section"><h3>購物清單（${buys.length}）</h3><div class="links">${buys.map((x) => Kit.btn(esc(x.name), { size: "sm", icon: x.bought ? "check" : "bag", cls: x.bought ? "bought" : "", attrs: { "data-shop-open": x.id } })).join("")}</div></section>`
          : ""
      }${pins.length > 1 ? `<section class="detail-section"><h3>分店／地址（${pins.length}）</h3><div class="info-list">${pins.map((g, k) => linkRow(`https://www.google.com/maps/search/?api=1&query=${g.lat},${g.lng}`, g.label || (k ? `分店 ${k + 1}` : p.v[1]), "pin")).join("")}</div></section>` : ""}${refs.length ? `<section class="detail-section"><h3>其他連結</h3><div class="info-list">${refs.join("")}</div></section>` : ""}<section class="tg-slot" data-tg-place="${esc(p.id)}"></section>${p.v[9] || p.v[7] ? `<p class="note detail-foot">${esc([p.v[9], p.v[7]].filter(Boolean).join(" · "))}</p>` : ""}`,
    );
    window.Together?.refresh();
  }
  // Places are trips/{t}/places documents (id "u_" + document id); each may have several pins (branches).
  function applyPlaceEdits(list) {
    const geo = {},
      clean = (o) => ({
        fields: Array.from({ length: 12 }, (_, i) => String(o.fields?.[i] ?? "")),
        cats: (o.cats || []).filter((c) => categories.includes(c)),
      });
    const out = list
      .filter((o) => !o.deleted)
      .sort((a, b) => (a.at || 0) - (b.at || 0))
      .map((o) => {
        const c = clean(o);
        // zh: Traditional Chinese name from the translateNames function, while it still matches the name
        const zh = o.zh && o.zhFor === c.fields[1] ? String(o.zh) : "";
        return { id: "u_" + o.id, overlayId: o.id, custom: true, v: c.fields, cats: c.cats, zh, mapsUrl: String(o.mapsUrl || ""), photo: o.photo || null, photoBy: String(o.photoBy || "") };
      });
    for (const o of list) {
      if (o.deleted) continue;
      const id = "u_" + o.id,
        src = o.mapsUrl || "https://www.google.com/maps",
        pts = (o.points || []).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
      if (pts.length) geo[id] = pts.map((p) => ({ lat: p.lat, lng: p.lng, label: String(p.label || ""), source: src }));
      else if (Number.isFinite(o.lat) && Number.isFinite(o.lng)) geo[id] = [{ lat: o.lat, lng: o.lng, label: "", source: src }];
    }
    places.splice(0, places.length, ...out);
    window.TRIP_GEO.places = geo;
    if (current === "explore" && $("#results")) renderResults();
    else if (current === "notebook" && $("#notebookResults")) notebookResults();
    else if (current === "nearby") nearbyResults();
    else if (current === "home") render();
    else if (current === "plan") refreshPlan();
  }
  const placeFields = [
    [2, "類型（例如：拉麵、咖啡店）", 40],
    [3, "地址／位置", 200],
    [4, "必吃・必買・特色", 1000],
    [5, "參考價格與營業時間", 1000],
    [10, "網站／參考連結", 500],
    [11, "備註與預約", 500],
  ];
  // A place can have several pins (branches): the main one from 自動填寫, others added as 分店 rows.
  const branchRow = (b = {}) =>
    `<div class="branch-row"><input name="bLabel" maxlength="60" placeholder="分店名稱" aria-label="分店名稱" value="${esc(b.label || "")}"><span class="searchrow"><input name="bUrl" class="search" inputmode="url" autocomplete="off" placeholder="Google 地圖連結" aria-label="分店 Google 地圖連結">${Kit.btn("定位", { icon: "pin", attrs: { "data-branch-find": true } })}</span><small class="branch-at">${Number.isFinite(b.lat) ? "已定位" : "未定位"}</small><input type="hidden" name="bLat" value="${b.lat ?? ""}"><input type="hidden" name="bLng" value="${b.lng ?? ""}">${Kit.btn("移除分店", { icon: "x", iconOnly: true, variant: "ghost", attrs: { "data-branch-del": true } })}</div>`;
  // plan={day,slot}: 行程「＋ 新增站點」 uses the same form, adds a time, and also saves the place to 探索.
  function placeForm(p, plan = null) {
    const v = (i) => esc(p?.v[i] || ""),
      pins = p ? window.TRIP_GEO.places[p.id] || [] : [],
      pin = pins[0],
      alt = plan && plan.slot != null ? stopsFor(plan.day)[plan.slot] : null;
    openDialog(
      `${Kit.sheetHead(plan ? (alt ? "加入同一時間的選擇" : "新增站點") : p ? "修改地點" : "新增地點", plan ? `D${plan.day}` : "")}${plan ? `<p class="note">${alt ? `與「${esc(alt.title)}」同在 ${esc(alt.time || "這個時段")}。` : `${esc(days[plan.day - 1].date)} · ${esc(days[plan.day - 1].region)}。`}地點會同時加入「探索」。</p>` : ""}<form class="tg-form" id="placeForm" data-id="${p ? esc(p.id) : ""}"${plan ? ` data-day="${plan.day}" data-slot="${plan.slot ?? ""}"` : ""}><div id="placePhotoBox">${placePhotoHtml(p?.photo, p?.photoBy)}</div>${plan && !alt ? '<label>時間（可留空，留空會放在最後）<input name="time" maxlength="30" placeholder="例如：12:00–13:00"></label>' : ""}<label>Google 地圖連結<span class="searchrow"><input name="mapsUrl" class="search" inputmode="url" autocomplete="off" placeholder="貼上 Google 地圖分享連結" value="${esc(p?.mapsUrl || "")}">${Kit.btn("自動填寫", { variant: "secondary", icon: "sparkles", attrs: { id: "placeLookup" } })}</span></label><p class="note" id="placeLookupInfo">在 Google 地圖按「分享」→ 複製連結，貼上後按「自動填寫」。只會填入空白欄位；類型、「必吃・必買・特色」及「參考價格與營業時間」由 AI 按 Google 資料及評論整理。</p><label>名稱<input name="f1" required maxlength="80" value="${v(1)}"></label><fieldset><legend>分類</legend>${categories.map((c) => `<label class="tg-check"><input type="checkbox" name="cats" value="${c}"${p?.cats.includes(c) ? " checked" : ""}> ${c}</label>`).join("")}</fieldset><label>區域<input name="f0" list="placeRegions" maxlength="60" required value="${v(0)}"><datalist id="placeRegions">${[...new Set(places.map((x) => x.v[0]).filter(Boolean))].map((r) => `<option value="${esc(r)}">`).join("")}</datalist></label>${placeFields.map(([i, label, max]) => `<label>${label}${max > 200 ? `<textarea name="f${i}" rows="3" maxlength="${max}">${v(i)}</textarea>` : `<input name="f${i}" maxlength="${max}" value="${v(i)}">`}</label>`).join("")}<input type="hidden" name="photo" value="${esc(p?.photo || "")}"><input type="hidden" name="photoBy" value="${esc(p?.photoBy || "")}"><input type="hidden" name="lat" value="${pin ? pin.lat : ""}"><input type="hidden" name="lng" value="${pin ? pin.lng : ""}"><input type="hidden" name="mainLabel" value="${esc(pin?.label || "")}"><fieldset class="branches"><legend>其他分店／地址</legend><div id="branchRows">${pins.slice(1).map(branchRow).join("")}</div>${Kit.btn("加入分店／地址", { size: "sm", icon: "plus", attrs: { "data-branch-add": true } })}<p class="note">每個分店貼上 Google 地圖連結後按「定位」。附近頁會用最近的分店計算距離。</p></fieldset>${Kit.btn(plan ? "加入行程及探索" : p ? "儲存修改" : "加入地點", { type: "submit", variant: "primary", cls: "btn-block" })}</form>`,
    );
  }
  async function findBranch(row) {
    const url = row.querySelector("[name=bUrl]").value.trim(),
      at = row.querySelector(".branch-at");
    if (!url) return toast("請先貼上分店的 Google 地圖連結。");
    at.textContent = "查詢中…";
    try {
      const r = await window.Together.lookupPlace(url);
      if (!Number.isFinite(r.lat)) throw new Error("no location");
      row.querySelector("[name=bLat]").value = r.lat;
      row.querySelector("[name=bLng]").value = r.lng;
      const lab = row.querySelector("[name=bLabel]");
      if (!lab.value.trim()) lab.value = r.name || "";
      at.textContent = r.address || "已定位";
    } catch (e) {
      at.textContent =
        fnError(e, "未能定位");
    }
  }
  // The place form's photo (from 自動填寫): kept in hidden fields, shown with its Google credit and a remove button.
  const placePhotoHtml = (photo, by) =>
    photo
      ? `<figure class="place-photo"><img src="data:image/jpeg;base64,${photo}" alt=""><figcaption>${by ? `相片：${esc(by)} · Google 地圖` : "相片：Google 地圖"}</figcaption>${Kit.btn("移除相片", { icon: "x", iconOnly: true, size: "sm", cls: "place-photo-del", attrs: { "data-place-photo-del": true } })}</figure>`
      : "";
  function setPlacePhoto(photo, by = "") {
    const f = $("#placeForm");
    if (!f) return;
    f.elements.photo.value = photo || "";
    f.elements.photoBy.value = photo ? by : "";
    $("#placePhotoBox").innerHTML = placePhotoHtml(photo, by);
  }
  async function lookupPlaceForm() {
    const f = $("#placeForm"),
      btn = $("#placeLookup"),
      info = $("#placeLookupInfo"),
      el = f.elements,
      url = el.mapsUrl.value.trim();
    if (!url) return toast("請先貼上 Google 地圖連結。");
    btn.disabled = true;
    // The AI write-up (類型, 必吃・必買・特色, 參考價格與營業時間) is asked for only while one of them is empty (one AI use).
    const wantHighlights = ["f2", "f4", "f5"].some((k) => !el[k].value.trim());
    info.textContent = wantHighlights ? "正在查詢 Google 地圖，並由 AI 整理評論…" : "正在查詢 Google 地圖…";
    const done = Kit.busy(info, { seconds: wantHighlights ? 12 : 5 });
    try {
      const r = await window.Together.lookupPlace(url, { highlights: wantHighlights, photo: !el.photo.value }),
        put = (name, value) => {
          if (value && !el[name].value.trim()) el[name].value = value;
        };
      put("f1", r.name);
      put("f2", r.type);
      put("f3", r.address);
      put("f4", r.highlights);
      if (r.photo && !el.photo.value) setPlacePhoto(r.photo, r.photoBy);
      put("f5", r.priceHours || [r.price && "價格：" + r.price, r.hours && "時間：\n" + r.hours].filter(Boolean).join("\n"));
      put("f10", [r.website, r.tabelog, r.mapsUrl].filter(Boolean).join("\n"));
      if (r.category && ![...el.cats].some((c) => c.checked)) [...el.cats].forEach((c) => (c.checked = c.value === r.category));
      if (Number.isFinite(r.lat) && Number.isFinite(r.lng)) {
        el.lat.value = r.lat;
        el.lng.value = r.lng;
        const near = places
          .filter((p) => p.v[0])
          .map((p) => ({
            p,
            d: Math.min(...(window.TRIP_GEO.places[p.id] || []).map((g) => window.Nearby.distance(r, g)), Infinity),
          }))
          .sort((a, b) => a.d - b.d)[0];
        if (near && near.d < 8000) put("f0", near.p.v[0]);
      }
      put("f0", r.district);
      info.textContent = r.highlights || r.priceHours ? "已填入。類型、「必吃・必買・特色」及「參考價格與營業時間」由 AI 按 Google 資料及評論整理，請檢查後按儲存。" : "已填入，請檢查後按儲存。";
    } catch (e) {
      info.textContent =
        fnError(e, "未能自動填寫，請手動輸入。");
      console.error(e);
    } finally {
      done();
      btn.disabled = false;
    }
  }
  function savePlaceForm(f) {
    const v = new FormData(f),
      cats = v.getAll("cats").map(String);
    if (!cats.length) return toast("請最少選一個分類。");
    const p = places.find((x) => x.id === f.dataset.id),
      fields = Array.from({ length: 12 }, (_, i) => String(p?.v[i] ?? ""));
    for (const i of [0, 1, ...placeFields.map(([i]) => i)]) fields[i] = String(v.get("f" + i) || "").trim();
    fields[6] = cats[0];
    if (!p) {
      fields[7] = "旅伴新增";
      fields[9] = new Date().toISOString().slice(0, 10) + "｜旅伴新增";
    }
    const lat = parseFloat(v.get("lat")),
      lng = parseFloat(v.get("lng"));
    const bl = v.getAll("bLabel"),
      blat = v.getAll("bLat"),
      blng = v.getAll("bLng"),
      branches = bl
        .map((label, k) => ({ lat: parseFloat(blat[k]), lng: parseFloat(blng[k]), label: String(label).trim().slice(0, 60) }))
        .filter((b) => Number.isFinite(b.lat) && Number.isFinite(b.lng));
    const main =
        Number.isFinite(lat) && Number.isFinite(lng) ? [{ lat, lng, label: String(v.get("mainLabel") || "").slice(0, 60) }] : [],
      points = [...main, ...branches].slice(0, 10);
    const newId = window.Together.savePlace({
      place: p,
      fields,
      cats,
      lat: Number.isFinite(lat) ? lat : (points[0]?.lat ?? null),
      lng: Number.isFinite(lng) ? lng : (points[0]?.lng ?? null),
      points: points.length > 1 ? points : [],
      mapsUrl: String(v.get("mapsUrl") || "")
        .trim()
        .slice(0, 500),
      photo: String(v.get("photo") || "") || null,
      photoBy: String(v.get("photoBy") || "").slice(0, 60),
    });
    if (f.dataset.linkShop && newId) window.Together.linkShopping(f.dataset.linkShop.split(","), newId);
    if (f.dataset.day && newId) {
      // Also a plan stop for that place (as an alternative of a time slot, or at the time entered).
      const day = Number(f.dataset.day),
        list = stopsFor(day),
        url = urlList(fields[10])[0] || "",
        time = String(v.get("time") || "")
          .trim()
          .slice(0, 30);
      const stop = {
        time,
        area: fields[0],
        title: fields[1],
        detail: fields[4],
        transport: "",
        ref: url,
        target: `${fields[1]} ${fields[3]}`.trim(),
        placeId: newId,
        ...(points[0] ? { lat: points[0].lat, lng: points[0].lng } : {}),
      };
      if (f.dataset.slot !== "") {
        const at = slotEnd(list, Number(f.dataset.slot));
        stop.time = list[at].time;
        savePlan(day, [...list.slice(0, at + 1), stop, ...list.slice(at + 1)]);
      } else savePlan(day, insertByTime(list, stop));
    }
    $("#detail").close();
  }
  document.addEventListener("submit", (e) => {
    if (e.target.id === "placeForm") {
      e.preventDefault();
      savePlaceForm(e.target);
    }
  });
  function bindExplore() {
    renderResults();
    $("#search").addEventListener("input", (e) => {
      search = e.target.value;
      renderResults();
    });
    $("#region").addEventListener("change", (e) => {
      region = e.target.value;
      renderResults();
    });
  }

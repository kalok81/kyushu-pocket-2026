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
    return `${header("探索", "", `${Kit.btn("AI 推薦", { size: "sm", icon: "sparkles", attrs: { "data-discover": "" } })}${Kit.btn("附近", { href: "#nearby", size: "sm", icon: "locate", cls: "btn-compact", attrs: { "aria-label": "附近" } })}${Kit.btn("地圖", { size: "sm", icon: "map", cls: "btn-compact", attrs: { "data-explore-map": "", "aria-label": "探索地圖" } })}`)}<div class="controls"><div class="searchrow"><input id="search" class="search" type="search" placeholder="搜尋，或貼上 Google 地圖連結" aria-label="搜尋地點" value="${esc(search)}"><select id="region" aria-label="選擇區域或小區">${regionOptions()}</select></div>${Kit.chips(
      [
        ...["全部", ...exploreCats].map((c) => chip(c, c)),
        chip("購物清單", "購物", "bag"),
        { label: "收藏", icon: "star", active: onlySaved, attrs: { id: "savedToggle" } },
      ],
      { label: "分類" },
    )}</div><div id="results"></div>${Kit.fab("地點", { "data-place-new": true, "aria-label": "新增地點" })}`;
  }
  // 🛍 購物清單 also lists 購買地點 that are not explore places yet, with 加入探索 to make them one.
  let buySpots = [];
  const spotCard = (s, k) =>
    `<article class="card place shop-spot"><div class="card-top place-top">${Kit.badge("購物", "shop")}</div><h3>${esc(s.name)}</h3>${s.address && s.address !== s.name ? `<div class="region">${esc(s.address)}</div>` : ""}<p class="buy-here">${icon("bag")} 要買：${s.items.map((n, i) => `<button type="button" class="buy-item" data-shop-open="${esc(s.ids[i])}">${esc(n)}</button>`).join("、")}</p><div class="actions">${Kit.btn("加入探索", { size: "sm", icon: "plus", attrs: { "data-spot-explore": k } })}${link(Number.isFinite(s.lat) ? `https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lng}` : maps(s.address || s.name), "地圖")}</div></article>`;
  // The places the explore filters (category, area, 收藏, search) leave: the list and its map.
  function shownPlaces() {
    const q = search.toLocaleLowerCase();
    return places.filter(
      (p) =>
        inCategory(p) && inRegion(p) && (!onlySaved || saved.has(p.id)) && (!q || `${p.v.join(" ")} ${p.zh}`.toLocaleLowerCase().includes(q)),
    );
  }
  function renderResults() {
    const q = search.toLocaleLowerCase(),
      ps = shownPlaces();
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
    return [c, { 餐廳: "food", 景點: "sights", 商店: "shop", 交通: "transit", 手信店: "gift" }[c] || ""];
  }
  function placeCard(p, near) {
    const [c, cls] = placeCat(p),
      on = saved.has(p.id);
    return `<article class="card place${p.photo ? " has-photo" : ""}" data-card-place="${esc(p.id)}">${p.photo ? `<img class="place-thumb" src="data:image/jpeg;base64,${p.photo}" alt="" loading="lazy">` : ""}<div class="card-top place-top">${Kit.badge(esc(c), cls)}<span class="region" title="${esc(p.v[0])}">${esc(areaOf(p) || p.v[0])}</span>${Kit.btn(`${esc(p.v[1])} 地圖`, { href: placeMap(p), external: true, variant: "ghost", size: "sm", icon: "pin", iconOnly: true })}<button class="save btn btn-ghost btn-icon btn-sm${on ? " saved" : ""}" data-save="${p.id}" aria-label="${on ? "取消收藏" : "收藏"} ${esc(p.v[1])}" aria-pressed="${on}">${icon("star")}</button></div><h3><button type="button" class="card-title" data-place="${p.id}">${esc(p.v[1])}</button>${zhLine(p.zh)}</h3>${near && typeof near === "object" ? `<div class="distance-badge">距離約 ${Math.round(near.distance)} 米${near.point.label ? " · " + esc(near.point.label) : ""}</div>` : ""}${p.v[9]?.includes("已閉店") ? '<div class="closed">已結業 · 保留原有記錄</div>' : ""}${p.v[4] ? `<p class="feature">${esc(p.v[4])}</p>` : ""}${p.v[5] ? `<p class="hours">${icon("clock")}<span>${esc(p.v[5])}</span></p>` : ""}${buyLine(buysAt({ placeId: p.id }))}</article>`;
  }
  // Place details: category and area, the main actions, then the facts as icon rows and the links as a list.
  function placeDetail(id) {
    const p = places.find((p) => p.id === id);
    if (!p) return;
    const [cat, catCls] = placeCat(p),
      on = saved.has(p.id),
      row = (ic, label, html, extra = "") =>
        `<div class="list-row info-row">${icon(ic)}<div><small>${label}</small><p>${html}</p></div>${extra}</div>`,
      linkRow = (u, label, ic) =>
        `<a class="list-row info-row info-link" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${icon(ic)}<div><p>${esc(label)}</p></div>${icon("external")}</a>`,
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
      `${p.photo ? `<figure class="place-photo detail-photo"><img src="data:image/jpeg;base64,${p.photo}" alt=""><figcaption>${esc(photoCredit(p.photoBy))}</figcaption></figure>` : ""}<div class="detail-badges">${Kit.badge(esc(cat), catCls)}<span>${esc(areaOf(p) || p.v[0])}</span></div><h2 class="detailtitle">${esc(p.v[1])}${zhLine(p.zh)}</h2>${p.v[9]?.includes("已閉店") ? '<p class="closed">已結業 · 保留原有記錄</p>' : ""}<div class="detail-actions">${Kit.btn("加入行程", { variant: "primary", icon: "plus", attrs: { "data-place-plan": p.id } })}<button class="save btn btn-outline btn-icon${on ? " saved" : ""}" data-save="${p.id}" aria-label="${on ? "取消收藏" : "收藏"}" aria-pressed="${on}">${icon("star")}</button>${Kit.btn("編輯", { icon: "edit", iconOnly: true, attrs: { "data-place-edit": p.id } })}${Kit.menu([
        { label: "複製地址", icon: "copy", attrs: { "data-copy": p.v[3] || p.v[1] } },
        { label: "刪除地點", icon: "trash", danger: true, attrs: { "data-place-delete": p.id } },
      ])}</div><div class="list info-list">${[
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
          ? `<section class="detail-section"><h3>購物（${buys.length}）</h3><div class="links">${buys.map((x) => Kit.btn(esc(x.name), { size: "sm", icon: x.bought ? "check" : "bag", cls: x.bought ? "bought" : "", attrs: { "data-shop-open": x.id } })).join("")}</div></section>`
          : ""
      }${pins.length > 1 ? `<section class="detail-section"><h3>分店／地址（${pins.length}）</h3><div class="list info-list">${pins.map((g, k) => linkRow(`https://www.google.com/maps/search/?api=1&query=${g.lat},${g.lng}`, g.label || (k ? `分店 ${k + 1}` : p.v[1]), "pin")).join("")}</div></section>` : ""}${refs.length ? `<section class="detail-section"><h3>其他連結</h3><div class="list info-list">${refs.join("")}</div></section>` : ""}<section class="tg-slot" data-tg-place="${esc(p.id)}"></section>${p.v[9] || p.v[7] ? `<p class="note detail-foot">${esc([p.v[9], p.v[7]].filter(Boolean).join(" · "))}</p>` : ""}`,
    );
    window.Together?.refresh();
  }

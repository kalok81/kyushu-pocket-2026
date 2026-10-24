"use strict";
// One trip (trips/{id} in Firestore): days come from its dates; places, plan, hotels and flights come from Together.
// Generated from src/app/*.js by scripts/build.mjs — edit those files, not this one.
window.startTrip = (meta = {}) => {
  // ---- Shared helpers, trip days, favourites and page state ----
  const Kit = window.Kit,
    { icon } = Kit,
    zhLine = (z) => (z ? `<span class="zh-name">${esc(z)}</span>` : "");
  const $ = (s) => document.querySelector(s),
    esc = (s) =>
      String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const urlList = (s) =>
      [...new Set((s || "").match(/https?:\/\/[^\s<>]+/g) || [])].filter((u) => {
        try {
          return ["https:", "http:"].includes(new URL(u).protocol);
        } catch {
          return false;
        }
      }),
    link = (u, label) => Kit.btn(esc(label), { href: u, external: true, size: "sm" }),
    maps = (s) => "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(s),
    route = (s) => "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(s);
  // 交通: stations, bus terminals, airports and piers — only where travellers change (plan tools count 5 minutes there).
  const categories = ["餐廳", "景點", "商店", "交通", "手信"];
  // 手信 places are souvenir shops: explore lists them under 商店; the products themselves are on the shopping page.
  const exploreCats = categories.filter((c) => c !== "手信"),
    giftShop = (p) => p.cats.includes("手信") || p.v[6] === "手信",
    inCategory = (p) =>
      category === "全部" ||
      (category === "購物清單" && buysAt({ placeId: p.id }).some((x) => !x.bought)) ||
      p.cats.includes(category) ||
      (category === "商店" && giftShop(p));
  // Places (trips/{t}/places) and their pins (TRIP_GEO) are filled in by applyPlaceEdits.
  const places = [];
  const days = tripDays(meta);
  const storage = {
    get(k) {
      try {
        return JSON.parse(localStorage.getItem(k) || "[]");
      } catch {
        return [];
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, JSON.stringify(v));
        return true;
      } catch {
        return false;
      }
    },
  };
  let saved = new Set(storage.get("kyushu-saved-v1"));
  // Favourites sync per companion through Firestore (members/{uid}.saved).
  function setSaved(ids) {
    saved = new Set(ids);
    storage.set("kyushu-saved-v1", [...saved]);
    if ($("#results")) renderResults();
    if ($("#notebookResults")) notebookResults();
    if (current === "nearby") nearbyResults();
    if (current === "home") render();
  }
  let current = "home",
    selectedDay = 1,
    category = "全部",
    region = "全部區域",
    search = "",
    onlySaved = false;
  // Message for a failed Cloud Function call: the function's own (Chinese) message, a clear one when the App Check
  // security check failed (the SDK then waits a day before retrying), else the fallback.
  const fnError = (e, fallback) =>
    e?.code === "functions/unauthenticated" || /appCheck/i.test(String(e?.code || e?.message || ""))
      ? "這部手機未能通過安全驗證，地圖及 AI 功能暫時不能使用；請稍後再試，或用另一個瀏覽器。"
      : // the function's own (Chinese) message; a bare SDK code such as "internal" means the server could not be reached
        String(e?.code || "").startsWith("functions/") && e.message && !/^[a-z-]+$/.test(e.message)
        ? e.message.replace(/\s*\[\d+\]$/, "")
        : `${fallback}（伺服器未能處理請求）`;
  function toast(s) {
    window.UI.toast(s);
  }
  const openDialog = Kit.open,
    header = (title, sub = "", aside = "") => Kit.pageHead(title, { sub, aside });
  function footer() {
    return '<div class="sourcefooter">旅程資料由旅伴在網站內輸入 · 班次、營業時間及訂位請以出發前公告為準。</div>';
  }
  // Days of the trip: one per date from startDate to endDate (at most 60).
  function tripDays(m) {
    const out = [],
      wk = "日一二三四五六",
      end = Date.parse(`${m.endDate}T00:00:00Z`);
    for (let t = Date.parse(`${m.startDate}T00:00:00Z`), n = 1; t <= end && n <= 60; t += 864e5, n++) {
      const d = new Date(t),
        y = d.getUTCFullYear(),
        mo = d.getUTCMonth() + 1,
        da = d.getUTCDate();
      out.push({
        n,
        date: `${da}/${mo}/${y}`,
        weekday: "星期" + wk[d.getUTCDay()],
        region: m.destination || "",
        hotel: "",
        transport: "",
        iso: `${y}/${String(mo).padStart(2, "0")}/${String(da).padStart(2, "0")}`,
      });
    }
    return out;
  }
  const lists = () => window.Together?.lists() || { hotels: [], flights: [] };
  const isoDash = (d) => d.iso.replaceAll("/", "-");
  // Day titles (planDays label) and the hotel for each night (check-in ≤ night < check-out).
  function refreshDays() {
    const hs = lists().hotels;
    for (const d of days) {
      d.region = planEdits[d.n]?.label || meta.destination || "";
      const h = hs.find((h) => h.checkIn && h.checkOut && h.checkIn <= isoDash(d) && isoDash(d) < h.checkOut);
      d.hotel = h ? h.name : "";
    }
  }
  function refreshLists() {
    refreshDays();
    if (current === "notebook" && $("#notebookResults")) notebookResults();
    if (["hotels", "flights", "home"].includes(current) && !$("#detail").open) render();
    else if (current === "plan") refreshPlan();
  }
  const nights = (h) => (h.checkIn && h.checkOut ? Math.round((Date.parse(h.checkOut) - Date.parse(h.checkIn)) / 864e5) : 0);
  const fmtTime = (t) => (t ? t.replace("T", " ") : "");
  // ---- 總覽 (home): the trip at a glance, today's stops, shortcuts and every day ----
  const todayIso = () => {
    const n = new Date();
    return `${n.getFullYear()}/${String(n.getMonth() + 1).padStart(2, "0")}/${String(n.getDate()).padStart(2, "0")}`;
  };
  function renderHome() {
    const hs = lists().hotels,
      first = days[0],
      last = days.at(-1),
      iso = todayIso(),
      now = days.find((d) => d.iso === iso),
      until = first ? Math.round((Date.parse(first.iso) - Date.parse(iso)) / 864e5) : 0;
    const when = now
      ? `今天是第 ${now.n} 天`
      : !first
        ? ""
        : until > 0
          ? `還有 ${until} 天出發`
          : "旅程已完結";
    const todayStops = now ? stopsFor(now.n) : [];
    const today = now
      ? `${Kit.sectionHead(`今天 · ${esc(now.region)}`, Kit.btn("全日行程", { href: `#plan?day=${now.n}`, size: "sm", icon: "calendar" }))}<div class="panel today-list">${
          todayStops.length
            ? todayStops
                .map((s) => `<a class="today-row" href="#plan?day=${now.n}"><time>${esc(s.time || "—")}</time><span>${esc(s.title)}</span></a>`)
                .join("")
            : '<p class="note">這天還沒有安排。</p>'
        }</div>`
      : "";
    const tile = (href, ic, title, sub) => `<a class="quick" href="${href}">${icon(ic)}<span><b>${title}</b><small>${sub}</small></span></a>`;
    return `<section class="hero trip-card"><div class="eyebrow">${esc(meta.destination || "我們的旅程")}</div><h1>${esc(meta.name || "我們的旅程")}</h1>${
      first
        ? `<p class="trip-dates">${esc(first.iso.replaceAll("/", "."))} – ${esc(last.iso.slice(5).replace("/", "."))} · ${days.length} 天</p>`
        : ""
    }${when ? `<p class="trip-when">${when}</p>` : ""}${Kit.btn(now ? "今天的行程" : "打開行程", { href: `#plan?day=${now ? now.n : 1}`, variant: "primary", icon: "calendar", cls: "herobtn" })}</section>${today}<div class="quicklinks">${tile("#flights", "plane", "機票", `${lists().flights.length} 個航班`)}${tile("#hotels", "bed", "住宿", `${hs.length} 間`)}${tile("#nearby", "locate", "附近", "定位找地點")}${tile("#notebook", "book", "資料簿", "搜尋全部")}</div>${Kit.sectionHead("旅程一覽")}<div class="panel">${days
      .map(
        (d) =>
          `<a class="dayrow${now && d.n === now.n ? " today" : ""}" href="#plan?day=${d.n}"><span class="daynum">D${d.n}</span><div><strong>${esc(d.region)}</strong><small>${esc(d.date)} · ${esc(d.weekday)}${d.hotel ? ` · ${esc(d.hotel)}` : ""}</small></div>${icon("chevron")}</a>`,
      )
      .join("")}</div>`;
  }
  // ---- 附近 (nearby places and shops within 100/200/500 m) ----
  let nearbyRequest = 0;
  const nearbyState = { position: null, accuracy: null, loading: false, error: "", radius: 200, category: "全部", mode: "gps" };
  function renderNearby() {
    const coordinates = window.TRIP_GEO?.places || {},
      coverage = places.filter((p) => (coordinates[p.id] || []).length).length;
    return `${header("附近", "只找已加入的地點，按直線距離由近至遠排序")}<section class="nearby-panel"><div class="links">${Kit.btn(nearbyState.loading ? "正在取得位置…" : nearbyState.position ? "重新定位" : "定位看附近", { variant: "primary", icon: "locate", attrs: { id: "locateNow", disabled: nearbyState.loading, "aria-busy": nearbyState.loading ? "true" : null } })}${Kit.btn("在地圖選位置", { icon: "pin", attrs: { id: "pickOnMap" } })}</div><p class="nearby-help">手機定位：按下後請允許瀏覽器使用位置。你的位置只在這次網頁內計算，不會儲存或傳送到網站伺服器。</p>${Kit.chips(
      [100, 200, 500].map((r) => ({ label: `${r}米`, active: nearbyState.radius === r, attrs: { "data-radius": r } })),
      { label: "附近距離範圍" },
    )}${Kit.chips(
      ["全部", ...exploreCats, "購物"].map((c) => ({ label: c, icon: c === "購物" ? "bag" : "", active: nearbyState.category === c, attrs: { "data-near-category": c } })),
      { label: "附近地點分類" },
    )}${nearbyState.category === "購物" ? '<p class="note">按購物清單中未買物品的「購買地點」定位。</p>' : ""}<div id="nearbyStatus" role="status" aria-live="polite">${nearbyState.error ? `<div class="notice nearby-error">${esc(nearbyState.error)}</div>` : nearbyState.loading ? "<p>定位中，請稍候…</p>" : nearbyState.position && nearbyState.mode === "manual" ? '<p class="note">以地圖選取的位置為中心 · 距離並非從手機目前位置計算</p>' : nearbyState.position ? `<p class="note">已取得位置 · 定位精度約 ±${Math.ceil(nearbyState.accuracy)}米${nearbyState.accuracy > nearbyState.radius ? "；誤差大於所選範圍，建議到室外重新定位或選較大範圍。" : ""}</p>` : '<p class="note">尚未選取位置。選擇範圍後，可用手機定位或在地圖選位置。</p>'}</div></section><div id="nearbyResults"></div><p class="note">距離為直線估算，並非步行路程；樓層、入口及河道可能影響實際路程。已建立座標 ${coverage}/${places.length} 個地點；未有可靠座標的項目暫不納入附近結果。</p><p class="note">座標來源：店方／場地地圖及公開地點資料。</p>${Kit.btn("查看座標覆蓋情況", { size: "sm", variant: "ghost", attrs: { id: "nearbyCoverage" } })}`;
  }
  function nearbyResults() {
    const target = $("#nearbyResults");
    if (!target) return;
    if (!nearbyState.position) {
      target.innerHTML = "";
      return;
    }
    if (nearbyState.category === "購物") return shoppingNearby(target);
    const rs = window.Nearby.find(
      places,
      window.TRIP_GEO?.places || {},
      nearbyState.position,
      nearbyState.radius,
      nearbyState.category,
    );
    target.innerHTML = `<div class="resultsbar"><span>${nearbyState.radius}米內 · ${rs.length} 個已加入地點</span></div>${rs.length ? `<div class="cardgrid">${rs.map((r) => placeCard(r.place, r)).join("")}</div>` : Kit.empty("這個範圍內暫時沒有符合的地點", "可試試較大範圍、其他分類，或重新定位。", Kit.btn("查看全部地點", { href: "#explore", size: "sm" }))}`;
  }
  // 附近 › 購物: shopping spots (explore shops or geocoded 購買地點) within the radius, nearest first.
  function shoppingNearby(target) {
    const pos = nearbyState.position,
      spots = window.Together.shoppingSpots()
        .map((s) => ({ ...s, distance: window.Nearby.distance(pos, s) }))
        .filter((s) => s.distance <= nearbyState.radius)
        .sort((a, b) => a.distance - b.distance);
    target.innerHTML = `<div class="resultsbar"><span>${nearbyState.radius}米內 · ${spots.length} 個購物地點</span></div>${
      spots.length
        ? `<div class="cardgrid">${spots
            .map((s) => {
              const p = s.placeId && places.find((x) => x.id === s.placeId);
              return `<article class="card place"><div class="place-top">${Kit.badge("購物", "shop")}</div><h3>${esc(s.name)}</h3><div class="distance-badge">距離約 ${Math.round(s.distance)} 米</div><p class="buy-here">${icon("bag")} 可買：${s.items.map(esc).join("、")}</p>${s.address ? `<p class="note">${esc(s.address)}</p>` : ""}<div class="actions">${p ? Kit.btn("店舖資料", { variant: "secondary", size: "sm", attrs: { "data-place": p.id } }) : ""}${link(route(p ? `${p.v[1]} ${p.v[3]}` : s.address), "導航")}</div></article>`;
            })
            .join("")}</div>`
        : Kit.empty("這個範圍內暫時沒有可買清單物品的地方", "購物清單中未買、而且有「購買地點」的物品才會顯示。可試試較大範圍。", Kit.btn("查看購物清單", { href: "#shopping", size: "sm" }))
    }`;
  }
  function refreshNearby() {
    if (current !== "nearby") return;
    $("#app").innerHTML = renderNearby() + footer();
    nearbyResults();
  }
  function locateNearby() {
    if (nearbyState.loading) return;
    const request = ++nearbyRequest;
    if (location.hash !== "#nearby") location.hash = "nearby";
    nearbyState.error = "";
    if (!navigator.geolocation) {
      nearbyState.error = "這個瀏覽器不支援定位，請使用手機的Safari或Chrome開啟網頁。";
      refreshNearby();
      return;
    }
    if (!window.isSecureContext) {
      nearbyState.error = "定位需要安全連線，請用HTTPS網址開啟網頁。";
      refreshNearby();
      return;
    }
    nearbyState.position = null;
    nearbyState.accuracy = null;
    nearbyState.loading = true;
    refreshNearby();
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (request !== nearbyRequest) return;
        nearbyState.loading = false;
        const { latitude, longitude, accuracy } = pos.coords;
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(accuracy)) {
          nearbyState.error = "未能取得有效位置，請重新定位。";
          refreshNearby();
          return;
        }
        nearbyState.mode = "gps";
        nearbyState.position = { lat: latitude, lng: longitude };
        nearbyState.accuracy = accuracy;
        refreshNearby();
      },
      (err) => {
        if (request !== nearbyRequest) return;
        nearbyState.loading = false;
        nearbyState.error =
          {
            1: "未獲允許使用位置。請在瀏覽器的網站設定允許位置，再按重新定位。",
            2: "暫時無法取得位置。請開啟手機定位服務，或到室外再試。",
            3: "定位逾時。請檢查手機定位服務及網絡後再試。",
          }[err.code] || "定位失敗，請稍後再試。";
        refreshNearby();
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  }
  function openMapPicker() {
    window.MapPicker.open({
      areas: meta.center ? [[meta.destination, meta.center.lat, meta.center.lng]] : [],
      places,
      coordinates: window.TRIP_GEO?.places || {},
      radius: nearbyState.radius,
      category: nearbyState.category,
      initial: nearbyState.mode === "manual" ? nearbyState.position : null,
      onConfirm: (position) => {
        nearbyRequest++;
        nearbyState.position = position;
        nearbyState.accuracy = null;
        nearbyState.error = "";
        nearbyState.loading = false;
        nearbyState.mode = "manual";
        refreshNearby();
      },
      openDialog,
      esc,
    });
  }
  function nearbyCoverage() {
    const geo = window.TRIP_GEO?.places || {},
      missing = places.filter((p) => !(geo[p.id] || []).length);
    openDialog(
      `${Kit.sheetHead("座標覆蓋情況")}<p>已建立 ${places.length - missing.length}/${places.length} 個地點座標。範圍較大的景點以標示位置計算；沒有可靠位置的項目不以區域中心代替。</p>${missing.length ? `<h3>尚未納入附近結果</h3><ul>${missing.map((p) => `<li>${esc(p.v[1])}</li>`).join("")}</ul>` : "<p>所有清單地點均已建立座標。</p>"}`,
    );
  }
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
    return [c, { 餐廳: "food", 景點: "sights", 商店: "shop", 交通: "transit", 手信店: "gift" }[c] || ""];
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
      const r = await window.Together.lookupPlace(url, { highlights: wantHighlights, photo: !el.photo.value, name: `${el.f1.value} ${el.f3.value}`.trim() }),
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
  // ---- ✨ AI 推薦新地點: places not on the list yet (web search + Google Maps check, discoverPlaces) ----
  // From 探索 (any area) or from a day of the plan (near that day's stops, its weekday, rain-day ideas when rain is
  // likely). Adding one opens the place form with its Google Maps link and runs 自動填寫, as for a pasted link.
  const DISCOVER_KIND = [
    ["any", "全部"],
    ["sight", "景點"],
    ["food", "餐廳"],
    ["cafe", "咖啡甜品"],
    ["shop", "手信購物"],
    ["onsen", "溫泉"],
  ];
  const DISCOVER_PREF = [
    ["rain", "雨天好去"],
    ["kids", "親子"],
    ["elder", "長者友善"],
    ["local", "地道"],
    ["quiet", "人少"],
    ["night", "夜景"],
    ["photo", "影相打卡"],
  ];
  let discover = { kind: "any", prefs: new Set(), day: null, results: null, area: "" };
  const WEEKDAY_KEY = { 星期一: "月", 星期二: "火", 星期三: "水", 星期四: "木", 星期五: "金", 星期六: "土", 星期日: "日" };
  // Google's hours line for the day's weekday ("月曜日: 10時00分～18時00分", "星期一: 10:00–18:00", "Monday: …")
  function hoursOn(hours, weekday) {
    const k = WEEKDAY_KEY[weekday];
    if (!k || !hours?.length) return "";
    const line = hours.find((h) => h.startsWith(k + "曜") || h.startsWith(weekday)) || hours[["月", "火", "水", "木", "金", "土", "日"].indexOf(k)] || "";
    return line.replace(/^[^:：]+[:：]\s*/, "");
  }
  function discoverSheet(day = null) {
    const d = day && days[day - 1];
    if (discover.day !== day) discover = { kind: "any", prefs: new Set(), day, results: null, area: d ? d.region : "" };
    const regions = [...new Set([...(d ? [d.region] : []), ...areas.map((a) => a.name), ...places.map((p) => p.v[0])].filter(Boolean))];
    openDialog(
      `${Kit.sheetHead("AI 推薦新地點", d ? `D${day} · ${esc(d.date)} ${esc(d.weekday)}` : "")}<p class="note">AI 上網搜尋${d ? "這天站點附近" : ""}你清單未有的好去處，每個都用 Google 地圖核實，附評分、營業時間及相片。</p><form class="tg-form" id="discoverForm">${
        d
          ? ""
          : `<label>區域<input name="area" list="discoverAreas" maxlength="60" placeholder="例如：由布院、天神" value="${esc(discover.area)}"><datalist id="discoverAreas">${regions.map((r) => `<option value="${esc(r)}">`).join("")}</datalist></label>`
      }<div><span class="field-label">類型</span>${Kit.chips(
        DISCOVER_KIND.map(([k, t]) => ({ label: t, active: discover.kind === k, attrs: { "data-discover-kind": k } })),
        { label: "類型" },
      )}</div><div><span class="field-label">喜好（可多選）</span>${Kit.chips(
        DISCOVER_PREF.map(([k, t]) => ({ label: t, active: discover.prefs.has(k), attrs: { "data-discover-pref": k } })),
        { label: "喜好" },
      )}</div><p class="note" id="discoverRain" hidden></p><label>其他要求（可留空）<input name="note" maxlength="120" placeholder="例如：想看海、適合下午茶"></label>${Kit.btn("開始推薦", { type: "submit", variant: "primary", icon: "sparkles", cls: "btn-block" })}</form><div id="discoverOut">${discover.results ? discoverResults() : ""}</div>`,
    );
    // Rain likely that day: suggest indoor places
    if (d && window.Weather && !discover.results) {
      const pt = dayPoint(day);
      pt &&
        window.Weather.forecast(pt.lat, pt.lng).then((all) => {
          const w = all?.[isoDash(d)],
            note = $("#discoverRain");
          if (!w || w.rain == null || w.rain < 50 || !note) return;
          discover.prefs.add("rain");
          $('[data-discover-pref="rain"]')?.classList.add("active");
          note.textContent = `這天降雨機會 ${w.rain}%，已選「雨天好去」。`;
          note.hidden = false;
        });
    }
  }
  function discoverResults() {
    const r = discover.results,
      d = discover.day && days[discover.day - 1],
      have = new Set(places.map((p) => p.v[1]));
    if (r.error) return `<p class="note">${esc(r.error)}</p>`;
    if (!r.places.length) return `<p class="note">找不到合適的新地點，可以換個類型或喜好再試。</p>`;
    const stars = (p) => (p.rating ? `★ ${p.rating.toFixed(1)}${p.ratings ? `（${p.ratings.toLocaleString("en-US")}）` : ""}` : "");
    return `<div class="discover-list">${r.places
      .map((p, k) => {
        const open = d ? hoursOn(p.hours, d.weekday) : "";
        return `<article class="discover-card">${p.photo ? `<img src="data:image/jpeg;base64,${p.photo}" alt="" loading="lazy">` : `<span class="discover-ph">${icon("pin")}</span>`}<div><h3>${esc(p.name)}</h3><p class="discover-meta">${[p.type, stars(p)].filter(Boolean).map(esc).join(" · ")}</p>${p.reason ? `<p class="discover-reason">${esc(p.reason)}</p>` : ""}${open ? `<p class="discover-meta">${icon("clock")} ${esc(d.weekday)}：${esc(open)}</p>` : ""}<p class="discover-meta">${esc(p.address.replace(/^〒\d{3}-\d{4}\s*/, "").replace(/^日本、?/, ""))}</p><div class="links">${have.has(p.name) ? Kit.badge("✓ 已加入探索") : Kit.btn(d ? `加入 D${discover.day}` : "加入探索", { size: "sm", variant: "secondary", icon: "plus", attrs: { "data-discover-add": k } })}${Kit.btn(`${esc(p.name)} 地圖`, { href: p.mapsUrl, external: true, size: "sm", icon: "map", iconOnly: true })}</div>${p.photo ? `<small class="discover-credit">相片：${esc(p.photoBy || "Google 地圖")}</small>` : ""}</div></article>`;
      })
      .join("")}</div>${r.dropped ? `<p class="note">另有 ${r.dropped} 個在 Google 地圖找不到或已在清單，已略去。</p>` : ""}`;
  }
  async function runDiscover(f) {
    const out = $("#discoverOut"),
      d = discover.day && days[discover.day - 1];
    discover.area = d ? d.region : String(f.elements.area?.value || "").trim();
    if (!discover.area && !d) return toast("請輸入區域。");
    out.innerHTML = Kit.progress({ text: "AI 正在上網搜尋，並用 Google 地圖核實…", seconds: 35 });
    f.querySelector("[type=submit]").disabled = true;
    try {
      const r = await window.Together.discoverPlaces({
        area: discover.area,
        kind: discover.kind,
        prefs: [...discover.prefs],
        note: String(f.elements.note.value || "").trim(),
        have: places.flatMap((p) => [p.v[1], p.zh].filter(Boolean)).slice(0, 300),
        ...(d ? { near: dayPoint(discover.day), weekday: d.weekday } : {}),
      });
      discover.results = r;
    } catch (e) {
      console.error(e);
      discover.results = { places: [], error: fnError(e, "AI 未能推薦，請稍後再試。") };
    }
    f.querySelector("[type=submit]").disabled = false;
    if ($("#discoverOut")) $("#discoverOut").innerHTML = discoverResults();
  }
  // 加入: the place form with the Google Maps link and name, then 自動填寫 (highlights, hours, photo, Tabelog)
  function addDiscovered(k) {
    const p = discover.results?.places[k];
    if (!p) return;
    placeForm(null, discover.day ? { day: discover.day, slot: null } : null);
    const el = $("#placeForm").elements;
    // a Maps link with the place id, so 自動填寫 finds exactly this place (Google's ?cid= links carry no name)
    el.mapsUrl.value = p.placeId ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name)}&query_place_id=${p.placeId}` : p.mapsUrl;
    el.f1.value = p.name;
    if (Number.isFinite(p.lat)) {
      el.lat.value = p.lat;
      el.lng.value = p.lng;
    }
    lookupPlaceForm();
  }
  document.addEventListener("click", (e) => {
    const el = e.target.closest("button, a");
    if (!el) return;
    if (el.dataset.discover !== undefined) discoverSheet(el.dataset.discover ? Number(el.dataset.discover) : null);
    if (el.dataset.discoverKind) {
      discover.kind = el.dataset.discoverKind;
      document.querySelectorAll("[data-discover-kind]").forEach((b) => b.classList.toggle("active", b === el));
    }
    if (el.dataset.discoverPref) {
      const k = el.dataset.discoverPref;
      discover.prefs.has(k) ? discover.prefs.delete(k) : discover.prefs.add(k);
      el.classList.toggle("active", discover.prefs.has(k));
    }
    if (el.dataset.discoverAdd) addDiscovered(Number(el.dataset.discoverAdd));
  });
  document.addEventListener("submit", (e) => {
    if (e.target.id !== "discoverForm") return;
    e.preventDefault();
    runDiscover(e.target);
  });
  // ---- 行程 (plan): day stops, the stop form and the in-page place picker ----
  // Each day's plan lives in Firestore planDays/{day}: the stop list and the day's title.
  let planEdits = {};
  // A stop for an explore place or a hotel shows that place's current name, area, details and address, so editing the
  // place in 探索 (or the hotel in 住宿) updates every stop; the copy saved in the stop is only a fallback.
  function resolveStop(s) {
    const p = s.placeId && places.find((x) => x.id === s.placeId);
    if (p)
      return {
        ...s,
        title: p.v[1],
        area: areaOf(p) || p.v[0],
        detail: p.v[4],
        target: `${p.v[1]} ${p.v[3]}`.trim(),
        ref: urlList(p.v[10])[0] || "",
        linked: "place",
      };
    const h = s.hotelId && lists().hotels.find((x) => x.id === s.hotelId);
    if (h)
      return {
        ...s,
        title: h.name,
        area: "住宿",
        detail: h.address || "",
        target: `${h.name} ${h.address || ""}`.trim(),
        ...(Number.isFinite(h.lat) ? { lat: h.lat, lng: h.lng } : {}),
        linked: "hotel",
      };
    return s;
  }
  const stopsFor = (day) => (planEdits[day]?.stops || []).map(resolveStop);
  const stopFields = (s) => ({
    time: String(s.time || "").slice(0, 30),
    area: String(s.area || "").slice(0, 60),
    title: String(s.title || "").slice(0, 80),
    detail: String(s.detail || "").slice(0, 1000),
    transport: String(s.transport || "").slice(0, 500),
    ref: String(s.ref || "").slice(0, 500),
    target: String(s.target || "").slice(0, 200),
    placeId: String(s.placeId || "").slice(0, 40),
    ...(s.warn ? { warn: String(s.warn).slice(0, 80) } : {}),
    ...(s.note ? { note: String(s.note).slice(0, 500) } : {}),
    ...(s.manual ? { manual: true } : {}),
    ...(s.hotelId ? { hotelId: String(s.hotelId).slice(0, 40) } : {}),
    ...(Number.isFinite(s.lat) && Number.isFinite(s.lng) ? { lat: s.lat, lng: s.lng } : {}),
  });
  const startMinute = (t) => {
    const m = String(t).match(/(\d{1,2}):(\d{2})/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  function insertByTime(list, stop) {
    const t = startMinute(stop.time);
    if (t == null) return [...list, stop];
    const i = list.findIndex((s) => {
      const u = startMinute(s.time);
      return u != null && u > t;
    });
    return i < 0 ? [...list, stop] : [...list.slice(0, i), stop, ...list.slice(i)];
  }
  function savePlan(day, stops) {
    planEdits = { ...planEdits, [day]: { ...planEdits[day], stops } };
    window.Together.savePlanDay(day, stops.map(stopFields));
    if (current === "plan") refreshPlan();
  }
  function applyPlanEdits(map) {
    planEdits = map;
    refreshDays();
    if (current === "plan") refreshPlan();
    else if (current === "notebook" && $("#notebookResults")) notebookResults();
  }
  function refreshPlan() {
    const j = $(".journey-day");
    if (j) {
      j.innerHTML = renderPlanDay(selectedDay);
      window.Together?.refresh();
      paintWeather();
    }
  }
  // Editing a stop: time and transport always; the place itself is edited in 探索 / 住宿 when the stop is linked to one.
  function stopForm(day, index) {
    const s = stopsFor(day)[index] || {},
      v = (k) => esc(s[k] || ""),
      own = !s.linked;
    openDialog(
      `${Kit.sheetHead("修改站點", `D${day} · ${esc(days[day - 1].date)}`)}<form class="tg-form" id="stopForm" data-day="${day}" data-index="${index}">${own ? `<label>Google 地圖連結<span class="searchrow"><input name="mapsUrl" class="search" inputmode="url" autocomplete="off" placeholder="貼上 Google 地圖分享連結">${Kit.btn("自動填寫", { variant: "secondary", icon: "sparkles", attrs: { id: "stopLookup" } })}</span></label><p class="note" id="stopLookupInfo">在 Google 地圖按「分享」→ 複製連結，貼上後按「自動填寫」。只會填入空白欄位。</p>` : `<div class="notice">「${esc(s.title)}」的名稱、地址及介紹跟隨${s.linked === "place" ? "探索地點" : "住宿資料"}，修改後所有行程會一併更新。<div class="links">${s.linked === "place" ? Kit.btn("修改地點資料", { size: "sm", icon: "edit", attrs: { "data-place-edit": s.placeId } }) : Kit.btn("修改住宿資料", { size: "sm", icon: "edit", attrs: { "data-hotel-edit": s.hotelId } })}</div></div>`}<div class="tg-row"><label>時間<input name="time" maxlength="30" placeholder="例如：14:00–15:30" value="${v("time")}"></label>${own ? `<label>區域<input name="area" maxlength="60" value="${v("area")}"></label>` : ""}</div>${own ? `<label>地點／活動<input name="title" required maxlength="80" value="${v("title")}"></label><label>內容<textarea name="detail" rows="3" maxlength="1000">${v("detail")}</textarea></label>` : ""}<label>備註（這一站的提示，例如要預約、只收現金）<textarea name="note" rows="2" maxlength="500">${v("note")}</textarea></label><label>交通<textarea name="transport" rows="2" maxlength="500">${v("transport")}</textarea></label>${own ? `<label>導航目的地（可留空）<input name="target" maxlength="200" value="${v("target")}"></label>` : ""}${Kit.btn("儲存修改", { type: "submit", variant: "primary", cls: "btn-block" })}</form>`,
    );
  }
  // Sub-area name for a coordinate (same centres as the explore filter), else the nearest place's region.
  function areaAt(pt) {
    const a = areas.map((x) => ({ x, d: window.Nearby.distance(pt, x) })).sort((p, q) => p.d - q.d)[0];
    if (a && a.d <= 6000) return a.x.name;
    const near = places
      .map((p) => ({
        p,
        d: Math.min(...(window.TRIP_GEO.places[p.id] || []).map((g) => window.Nearby.distance(pt, g)), Infinity),
      }))
      .sort((p, q) => p.d - q.d)[0];
    return near && near.d < 8000 ? near.p.v[0] : "";
  }
  async function lookupStopForm() {
    const f = $("#stopForm"),
      btn = $("#stopLookup"),
      info = $("#stopLookupInfo"),
      el = f.elements,
      url = el.mapsUrl.value.trim();
    if (!url) return toast("請先貼上 Google 地圖連結。");
    btn.disabled = true;
    info.textContent = "正在查詢 Google 地圖…";
    const done = Kit.busy(info, { seconds: 5 });
    try {
      const r = await window.Together.lookupPlace(url),
        put = (name, value) => {
          if (value && !el[name].value.trim()) el[name].value = value;
        };
      put("title", r.name);
      put("target", [r.name, r.address].filter(Boolean).join(" "));
      put("detail", [r.type, r.price && "價格：" + r.price, r.hours && "營業時間：\n" + r.hours].filter(Boolean).join("\n"));
      if (Number.isFinite(r.lat) && Number.isFinite(r.lng)) put("area", areaAt({ lat: r.lat, lng: r.lng }));
      f.dataset.ref = r.website || r.mapsUrl || "";
      info.textContent = "已填入，請檢查後按儲存。";
    } catch (e) {
      info.textContent =
        fnError(e, "未能自動填寫，請手動輸入。");
      console.error(e);
    } finally {
      done();
      btn.disabled = false;
    }
  }
  function saveStopForm(f) {
    const day = Number(f.dataset.day),
      index = Number(f.dataset.index),
      v = new FormData(f),
      get = (k) => String(v.get(k) || "").trim(),
      list = [...stopsFor(day)],
      old = list[index];
    if (!old) return;
    // a time typed here is the traveller's own: 推算時間 keeps its length
    const stop = { ...old, time: get("time"), transport: get("transport"), note: get("note"), manual: get("time") !== (old.time || "") ? !!get("time") : !!old.manual };
    if (!old.linked) {
      if (!get("title")) return;
      Object.assign(stop, { area: get("area"), title: get("title"), detail: get("detail"), target: get("target") });
      if (f.dataset.ref && !stop.ref) stop.ref = f.dataset.ref;
    }
    list[index] = stop;
    savePlan(day, list);
    $("#detail").close();
    toast("已儲存");
  }
  function addPlaceToPlan(p) {
    const today = days.find((d) => d.iso === new Date().toLocaleDateString("en-CA").replaceAll("-", "/"))?.n,
      sel = current === "plan" ? selectedDay : today || selectedDay;
    openDialog(
      `${Kit.sheetHead(`把「${esc(p.v[1])}」加入行程`)}<form class="tg-form" id="placeToPlan" data-place="${esc(p.id)}"><label>日子<select name="day">${days.map((d) => `<option value="${d.n}"${d.n === sel ? " selected" : ""}>D${d.n} ${esc(d.date)} ${esc(d.region)}</option>`).join("")}</select></label><label>時間（可留空，留空會放在最後）<input name="time" maxlength="30" placeholder="例如：12:00–13:00"></label>${Kit.btn("加入行程", { type: "submit", variant: "primary", cls: "btn-block" })}</form>`,
    );
  }
  // In-page picker: search explore places and add them to the selected day without leaving the plan.
  let ppCat = "全部";
  // A hotel entered on 住宿 as a plan stop (navigation by its name and address).
  const hotelStop = (h, time) => ({
    time,
    area: "住宿",
    title: h.name,
    detail: h.address || "",
    transport: "",
    ref: "",
    target: `${h.name} ${h.address || ""}`.trim(),
    hotelId: h.id,
    ...(Number.isFinite(h.lat) ? { lat: h.lat, lng: h.lng } : {}),
  });
  const placeStop = (p, time) => ({
    time,
    area: areaOf(p) || p.v[0],
    title: p.v[1],
    detail: p.v[4],
    transport: "",
    ref: urlList(p.v[10])[0] || "",
    target: `${p.v[1]} ${p.v[3]}`.trim(),
    placeId: p.id,
  });
  // at: insert before this stop index (the ＋ between two stops); later picks follow the previous one.
  function pickPlaceForPlan(day, slot = null, at = null) {
    ppCat = "全部";
    ppAi = null;
    const s = slot != null ? stopsFor(day)[slot] : null,
      before = at != null ? stopsFor(day)[at] : null;
    openDialog(
      `${Kit.sheetHead(s ? "加入同一時間的選擇" : "加入地點", `D${day}`)}<p class="note">${s ? `與「${esc(s.title)}」同在 ${esc(s.time || "這個時段")}` : before ? `加在「${esc(before.title)}」之前` : `${esc(days[day - 1].date)} · ${esc(days[day - 1].region)}`}</p><div class="links">${s ? Kit.btn("自己輸入", { icon: "edit", attrs: { "data-stop-own": slot } }) : Kit.btn("新增地點", { icon: "plus", attrs: { "data-stop-new": true } })}${Kit.btn("發掘新地點", { variant: "secondary", icon: "sparkles", attrs: { "data-discover": day } })}</div><div class="tg-form plan-pick"><input id="ppSearch" class="search" type="search" placeholder="搜尋地點、區域、特色…" aria-label="搜尋地點">${Kit.chips(
        ["全部", ...(saved.size ? ["★ 收藏"] : []), "✨ AI 推薦", ...(lists().hotels.length ? ["住宿"] : []), ...(window.Together?.shoppingPlaces?.().length ? ["購物清單"] : []), ...exploreCats].map((c) => ({ label: c, active: c === ppCat, attrs: { "data-pp-cat": c } })),
        { label: "分類" },
      )}${s || before ? "" : '<label>時間（可留空，留空會放在最後）<input id="ppTime" maxlength="30" placeholder="例如：12:00–13:00"></label>'}</div><p class="note pp-sort">收藏的地點排先，其餘按與這天站點的距離排列。</p><div id="ppList" class="pp-list" data-day="${day}" data-slot="${slot ?? ""}" data-at="${at ?? ""}"></div>`,
    );
    ppResults();
  }
  const addBtn = (attrs) => Kit.btn("加入", { variant: "secondary", size: "sm", icon: "plus", attrs });
  // Distance from a place to the day: the nearest stop already planned, else the day's area or hotel.
  function dayDistance(day) {
    const pts = stopsFor(day)
      .map((s) => stopPoint(s))
      .filter((p) => p && Number.isFinite(p.lat));
    if (!pts.length) pts.push(dayPoint(day));
    return (p) => {
      const g = window.TRIP_GEO.places[p.id] || [];
      const d = Math.min(...g.flatMap((x) => pts.filter(Boolean).map((q) => window.Nearby.distance(x, q))), Infinity);
      return d;
    };
  }
  const kmText = (d) => (Number.isFinite(d) ? (d < 1000 ? ` · ${Math.round(d / 10) * 10} 米` : ` · ${(d / 1000).toFixed(1)} 公里`) : "");
  // ✨ AI 推薦: up to 6 explore places that fit the day (planDay suggest), with the reason.
  let ppAi = null;
  async function ppSuggest(box, day) {
    const dist = dayDistance(day),
      inPlan = new Set(stopsFor(day).map((s) => s.placeId)),
      d = days[day - 1];
    const cands = places
      .filter((p) => !inPlan.has(p.id) && !p.v[9]?.includes("已閉店"))
      .map((p) => ({ p, d: dist(p) - (saved.has(p.id) ? 3000 : 0) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 40);
    if (!cands.length) return (box.innerHTML = '<p class="note">探索沒有可以推薦的地點。</p>');
    box.innerHTML = Kit.progress({ text: "AI 正在按這天的行程、距離及營業時間挑選…", seconds: 15 });
    try {
      const r = await window.Together.planDay({
        mode: "suggest",
        date: isoDash(d),
        weekday: d.weekday,
        region: d.region,
        currency: meta.currency || "JPY",
        stops: stopsFor(day).map((s, i) => ({ k: String(i), name: s.title, time: s.time, type: placeOf(s)?.v[2] || "" })),
        candidates: cands.map(({ p }) => ({ k: p.id, name: p.v[1], area: areaOf(p) || p.v[0], type: p.v[2], note: String(p.v[4] || "").slice(0, 120), hours: String(p.v[5] || "").slice(0, 200), saved: saved.has(p.id), km: Number.isFinite(dist(p)) ? dist(p) / 1000 : null })),
      });
      ppAi = { day, picks: r.picks.filter((x) => places.some((p) => p.id === x.k)), advice: r.advice };
    } catch (e) {
      console.error(e);
      ppAi = { day, picks: [], error: fnError(e, "AI 未能推薦，請稍後再試。") };
    }
    if (ppCat === "✨ AI 推薦") ppResults();
  }
  function ppResults() {
    const box = $("#ppList");
    if (!box) return;
    if (ppCat === "✨ AI 推薦") {
      const day = Number(box.dataset.day);
      if (!ppAi || ppAi.day !== day) return ppSuggest(box, day);
      const inPlan = new Set(stopsFor(day).map((s) => s.placeId)),
        dist = dayDistance(day);
      box.innerHTML = ppAi.error
        ? `<p class="note">${esc(ppAi.error)}</p>`
        : `${ppAi.advice ? `<p class="note">${icon("sparkles")} ${esc(ppAi.advice)}</p>` : ""}${ppAi.picks
            .map(({ k, reason }) => {
              const p = places.find((x) => x.id === k);
              return `<div class="pp-row"><div><b>${saved.has(p.id) ? "★ " : ""}${esc(p.v[1])}</b><small>${esc(areaOf(p) || p.v[0])}${kmText(dist(p))}</small>${reason ? `<small class="pp-reason">${esc(reason)}</small>` : ""}</div>${inPlan.has(p.id) ? Kit.badge("✓ 已加入") : addBtn({ "data-pp-add": p.id })}</div>`;
            })
            .join("") || '<p class="note">AI 沒有合適的推薦。</p>'}`;
      box.insertAdjacentHTML("beforeend", Kit.btn("再推薦一次", { size: "sm", icon: "redo", attrs: { "data-pp-ai-again": true } }));
      return;
    }
    const day = Number(box.dataset.day),
      q = ($("#ppSearch")?.value || "").trim().toLocaleLowerCase(),
      inPlan = new Set(
        stopsFor(day)
          .map((s) => s.placeId)
          .filter(Boolean),
      );
    const hs =
        (ppCat === "全部" && !q ? false : ["全部", "住宿"].includes(ppCat))
          ? [...lists().hotels]
              .filter((h) => !q || `${h.name} ${h.address}`.toLocaleLowerCase().includes(q))
              .sort((a, b) => String(a.checkIn).localeCompare(String(b.checkIn)))
          : [],
      hotelIn = stopsFor(day).reduce((m, s) => (s.hotelId ? m.set(s.hotelId, (m.get(s.hotelId) || 0) + 1) : m), new Map());
    const dist = dayDistance(day),
      far = new Map(places.map((p) => [p.id, dist(p)]));
    const ps = ["住宿", "購物清單"].includes(ppCat)
      ? []
      : places
          .filter(
            (p) =>
              (ppCat === "全部" || (ppCat === "★ 收藏" && saved.has(p.id)) || p.cats.includes(ppCat) || (ppCat === "商店" && giftShop(p))) &&
              (!q || [p.v[1], p.v[0], areaOf(p), p.v[4], p.v[2], p.zh].join(" ").toLocaleLowerCase().includes(q)),
          )
          .sort((a, b) => saved.has(b.id) - saved.has(a.id) || far.get(a.id) - far.get(b.id));
    const hotelRows = hs
      .map(
        (h) =>
          `<div class="pp-row"><div><b>${icon("bed")} ${esc(h.name)}</b><small>${h.checkIn ? `${esc(h.checkIn.slice(5))} → ${esc((h.checkOut || "").slice(5))}` : "住宿"}${h.address ? ` · ${esc(h.address.slice(0, 40))}` : ""}</small></div>${hotelIn.get(h.id) ? Kit.badge(`✓ ${hotelIn.get(h.id)} 次`) : ""}${addBtn({ "data-pp-hotel": h.id })}</div>`,
      )
      .join("");
    // 購物清單: where unbought list items are bought (explore places, or the item's own geocoded 購買地點).
    ppSpots =
      ppCat === "購物清單"
        ? (window.Together?.shoppingPlaces?.() || []).filter(
            (s) => !q || `${s.name} ${s.address} ${s.items.join(" ")}`.toLocaleLowerCase().includes(q),
          )
        : [];
    const spotRows = ppSpots
      .map(
        (s, k) =>
          `<div class="pp-row"><div><b>${icon("bag")} ${esc(s.name)}</b><small>要買：${s.items.map(esc).join("、")}</small></div>${s.placeId && inPlan.has(s.placeId) ? Kit.badge("✓ 已加入") : addBtn({ "data-pp-spot": k })}</div>`,
      )
      .join("");
    box.innerHTML = hotelRows + spotRows + (ps.length || hotelRows || spotRows ? "" : '<p class="note">找不到符合的地點。</p>');
    if (!ps.length) return;
    box.insertAdjacentHTML(
      "beforeend",
      `${ps
        .slice(0, 40)
        .map(
          (p) =>
            `<div class="pp-row"><div><b>${saved.has(p.id) ? "★ " : ""}${esc(p.v[1])}</b><small>${esc(areaOf(p) || p.v[0])}${kmText(far.get(p.id))}${p.v[2] ? ` · ${esc(p.v[2])}` : ""}</small></div>${inPlan.has(p.id) ? Kit.badge("✓ 已加入") : addBtn({ "data-pp-add": p.id })}</div>`,
        )
        .join("")}${ps.length > 40 ? `<p class="note">還有 ${ps.length - 40} 個，請輸入更多字縮窄搜尋。</p>` : ""}`,
    );
  }
  let ppSpots = [];
  // A shopping spot without an explore place becomes its own stop at the item's 購買地點.
  const spotStop = (s, time) => ({
    time,
    area: (Number.isFinite(s.lat) && areaAt(s)) || "購物",
    title: s.name,
    detail: "",
    transport: "",
    ref: "",
    target: s.address || s.name,
    ...(Number.isFinite(s.lat) ? { lat: s.lat, lng: s.lng } : {}),
  });
  function addPickedPlace(id, hotel = false, spot = null) {
    const box = $("#ppList"),
      p = spot || (hotel ? lists().hotels.find((x) => x.id === id) : places.find((x) => x.id === id));
    if (!box || !p) return;
    const day = Number(box.dataset.day),
      list = stopsFor(day),
      make = (t) => (spot ? spotStop(p, t) : hotel ? hotelStop(p, t) : placeStop(p, t));
    if (box.dataset.slot !== "") {
      const at = slotEnd(list, Number(box.dataset.slot));
      savePlan(day, [...list.slice(0, at + 1), make(list[at].time), ...list.slice(at + 1)]);
    } else if (box.dataset.at !== "") {
      // Between two stops: the stop after it now comes from somewhere else, so its transport is cleared.
      const at = Number(box.dataset.at);
      savePlan(day, legsChanged(list, [...list.slice(0, at), make(""), ...list.slice(at)]));
      box.dataset.at = at + 1;
    } else savePlan(day, insertByTime(list, make(($("#ppTime")?.value || "").trim())));
    toast(`已加入 D${day}：${spot || hotel ? p.name : p.v[1]}`);
    ppResults();
  }
  // Last index of the slot (same-time run) containing stop i, so new alternatives go to the end of that slot.
  const slotEnd = (list, i) => {
    let j = i;
    while (list[j + 1] && list[i].time && list[j + 1].time === list[i].time) j++;
    return j;
  };
  document.addEventListener("input", (e) => {
    if (e.target.id === "ppSearch") ppResults();
  });
  function savePlaceToPlan(f) {
    const p = places.find((x) => x.id === f.dataset.place);
    if (!p) return;
    const v = new FormData(f),
      day = Number(v.get("day")),
      stop = placeStop(p, String(v.get("time") || "").trim());
    savePlan(day, insertByTime(stopsFor(day), stop));
    $("#detail").close();
    toast(`已加入 D${day} 行程`);
  }
  document.addEventListener("submit", (e) => {
    if (e.target.id === "stopForm") {
      e.preventDefault();
      saveStopForm(e.target);
    }
    if (e.target.id === "placeToPlan") {
      e.preventDefault();
      savePlaceToPlan(e.target);
    }
  });
  // Consecutive stops with the same (non-empty) time are alternatives for one slot, shown side by side.
  const stopGroups = (stops) =>
    stops.reduce((gs, s, i) => {
      const g = gs[gs.length - 1];
      if (g && s.time && g[0].s.time === s.time) g.push({ s, i });
      else gs.push([{ s, i }]);
      return gs;
    }, []);
  function stopCard(s, i, label, last) {
    const placeOk = s.placeId && places.some((p) => p.id === s.placeId);
    return `<div class="stopcontent"><div class="stop-top"><span class="eyebrow">${label} / ${esc(s.area)}</span>${Kit.menu(
      [
        { label: "修改", icon: "edit", attrs: { "data-stop-edit": i } },
        { label: "加入同一時間的選擇", icon: "plus", attrs: { "data-stop-alt": i } },
        { label: "上移", icon: "up", disabled: !i, attrs: { "data-stop-move": `${i}:-1` } },
        { label: "下移", icon: "down", disabled: i >= last, attrs: { "data-stop-move": `${i}:1` } },
        { label: "刪除", icon: "trash", danger: true, attrs: { "data-stop-delete": i } },
      ],
      { label: `編輯「${s.title}」`, attrs: { "data-stop-more": i } },
    )}</div><h3>${esc(s.title)}${zhLine(placeOk ? places.find((p) => p.id === s.placeId).zh : "")}</h3>${s.warn ? `<p class="stop-warn">${icon("clock")}<span>${esc(s.warn)}</span></p>` : ""}${s.note ? `<p class="stop-note">${icon("note")}<span>${esc(s.note)}</span></p>` : ""}${s.detail ? `<p>${esc(s.detail)}</p>` : ""}${buyLine(buysAt({ placeId: s.placeId, title: s.hotelId ? "" : s.title }))}<div class="links">${placeOk ? Kit.btn("地點資料", { size: "sm", attrs: { "data-place": s.placeId } }) : ""}${s.hotelId ? Kit.btn("住宿資料", { size: "sm", href: "#hotels" }) : ""}${s.target ? link(route(s.target), "導航") : ""}${urlList(s.ref)
      .map((u) => link(u, "參考網站"))
      .join("")}</div></div>`;
  }
  function renderPlanDay(day) {
    const d = days[day - 1],
      edit = planEdits[day],
      stops = stopsFor(day),
      last = stops.length - 1,
      first = stops[0];
    return `<div class="dayintro"><div><div class="eyebrow">${esc(d.date)} · ${esc(d.weekday)}</div><h2>${esc(d.region)}</h2><p class="weather" data-weather="${day}" hidden></p><p class="day-hotel">${icon("bed")}<span>住宿：${d.hotel ? `<a href="#hotels">${esc(d.hotel)}</a>` : "未設定"}</span></p></div>${Kit.menu(
      [
        { label: "修改這天標題", icon: "edit", attrs: { "data-day-label": true } },
        routeStops(day).length && { label: "當天路線地圖", icon: "map", attrs: { "data-day-map": true } },
        { label: "列印／另存 PDF", icon: "printer", attrs: { "data-plan-print": true } },
        edit?.stops?.length && { label: "清空這天", icon: "trash", danger: true, attrs: { "data-plan-reset": true } },
      ],
      { label: "這天的更多操作", cls: "day-more" },
    )}</div>${stops.length ? planTools(stops) : ""}${first && !hotelLink() && first.transport ? `<p class="transport">${icon("train")}<span>${esc(first.transport)}</span></p>` : ""}<div class="timeline">${
      stopGroups(stops)
        .map(
          (g, n, all) =>
            `${n || hotelLink() ? stopLink(all, n) : ""}<article class="stop${g.length > 1 ? " stop-group" : ""}" data-group="${n}"><div class="time">${esc(g[0].s.time)}${g.length > 1 ? `<small class="alt-count">${g.length} 個選擇</small>` : ""}${all.length > 1 ? `<button type="button" class="stop-grip" aria-label="拖動調整「${esc(g[0].s.title)}」的次序">${icon("grip")}</button>` : ""}</div><div class="stop-alts">${g
              .map(({ s, i }, k) => stopCard(s, i, `${String(n + 1).padStart(2, "0")}${g.length > 1 ? String.fromCharCode(97 + k) : ""}`, last))
              .join("")}</div></article>`,
        )
        .join("") || Kit.empty("這天還沒有行程", "按右下角「加入地點」，從探索、住宿或購物清單選擇，或新增地點。")
    }</div><section class="tg-slot" data-tg-day="${day}"></section>${Kit.fab("加入地點", { "data-plan-pick": true })}`;
  }
  function renderPlan() {
    const tab = (d) => {
      const [dd, mm] = d.date.split("/");
      return `<button class="daytab ${d.n === selectedDay ? "active" : ""}" data-day="${d.n}" aria-pressed="${d.n === selectedDay}" aria-label="第 ${d.n} 天 ${esc(d.date)} ${esc(d.region)}"><b>D${d.n}</b><span>${dd}/${mm} ${d.weekday.slice(-1)}</span><small class="weather-tab" data-weather-tab="${d.n}"></small></button>`;
    };
    return `<h1 class="sr-only">每日行程</h1><div class="daytabs" aria-label="選擇行程日期">${days.map(tab).join("")}</div><article class="journey-day" aria-label="第${selectedDay}天行程">${renderPlanDay(selectedDay)}</article>`;
  }
  // ---- 行程 extras: weather, day route map and the printed itinerary ----
  // Weather for each day where the day happens: the middle stop with coordinates (travel days start elsewhere),
  // else that night's hotel, else the trip centre.
  function dayPoint(day) {
    const geo = window.TRIP_GEO?.places || {},
      d = days[day - 1];
    const area = (name) =>
      name && areas.find((a) => Number.isFinite(a.lat) && (a.name === name || String(name).includes(a.name)));
    const pts = stopsFor(day)
      .map(
        (s) =>
          (s.placeId && geo[s.placeId]?.[0]) ||
          (Number.isFinite(s.lat) && Number.isFinite(s.lng) ? { lat: s.lat, lng: s.lng } : area(s.area)),
      )
      .filter(Boolean);
    if (pts.length) return pts[Math.floor(pts.length / 2)];
    const h = lists().hotels.find((h) => h.name === d?.hotel && Number.isFinite(h.lat));
    if (h) return { lat: h.lat, lng: h.lng };
    if (meta.center && Number.isFinite(meta.center.lat)) return meta.center;
    const a = areas[0];
    return a && Number.isFinite(a.lat) ? { lat: a.lat, lng: a.lng } : null;
  }
  // Stops with coordinates for the route map: the first choice of each time slot, numbered like the plan.
  function routeStops(day) {
    const geo = window.TRIP_GEO?.places || {};
    return stopGroups(stopsFor(day))
      .map(([{ s }], n) => {
        const g = (s.placeId && geo[s.placeId]?.[0]) || (Number.isFinite(s.lat) && Number.isFinite(s.lng) ? s : null);
        return g ? { n: n + 1, time: s.time || "", title: s.title || "", lat: g.lat, lng: g.lng } : null;
      })
      .filter(Boolean);
  }
  // Whole itinerary on paper (or "Save as PDF"): flights, hotels and every day's stops, printed from a temporary #printArea.
  function printPlan() {
    const L = lists(),
      fl = [...L.flights].sort((a, b) => String(a.depart).localeCompare(String(b.depart))),
      hs = [...L.hotels].sort((a, b) => String(a.checkIn).localeCompare(String(b.checkIn)));
    const title = meta.name || "旅程",
      range = days.length ? `${days[0].iso} – ${days.at(-1).iso}` : "";
    const html = `<h1>${esc(title)}</h1><p class="print-sub">${esc([meta.destination, range, `${days.length} 天`].filter(Boolean).join(" · "))}</p>
 ${fl.length ? `<h2>航班</h2><table><tbody>${fl.map((f) => `<tr><td>${esc(fmtTime(f.depart))}</td><td><b>${esc(f.flightNo)}</b> ${esc(f.airline)}</td><td>${esc(f.from)} → ${esc(f.to)}</td><td>到達 ${esc(fmtTime(f.arrive))}</td></tr>`).join("")}</tbody></table>` : ""}
 ${hs.length ? `<h2>住宿</h2><table><tbody>${hs.map((h) => `<tr><td>${h.checkIn ? `${esc(h.checkIn)} → ${esc(h.checkOut)}` : "日期未定"}</td><td><b>${esc(h.name)}</b></td><td>${esc(h.address)}</td></tr>`).join("")}</tbody></table>` : ""}
 ${days
   .map((d) => {
     const stops = stopsFor(d.n);
     return `<section class="print-day"><h2>DAY ${d.n} · ${esc(d.date)} ${esc(d.weekday)} · ${esc(d.region)}</h2>${d.hotel ? `<p class="print-sub">住宿：${esc(d.hotel)}</p>` : ""}${stops.length ? `<table><tbody>${stops.map((s) => `<tr><td class="print-time">${esc(s.time)}</td><td><b>${esc(s.title)}</b>${s.note ? `<div>📝 ${esc(s.note)}</div>` : ""}${s.detail ? `<div>${esc(s.detail)}</div>` : ""}${s.transport ? `<div class="print-sub">↳ ${esc(s.transport)}</div>` : ""}</td></tr>`).join("")}</tbody></table>` : '<p class="print-sub">未安排</p>'}</section>`;
   })
   .join("")}
 <p class="print-sub">列印自口袋旅伴 · ${new Date().toLocaleDateString("zh-HK")}</p>`;
    let area = $("#printArea");
    if (!area) {
      area = document.createElement("div");
      area.id = "printArea";
      document.body.append(area);
    }
    area.innerHTML = html;
    document.body.classList.add("printing");
    addEventListener(
      "afterprint",
      () => {
        document.body.classList.remove("printing");
        area.innerHTML = "";
      },
      { once: true },
    );
    window.print();
  }
  function paintWeather() {
    if (!window.Weather) return;
    for (const el of document.querySelectorAll("[data-weather],[data-weather-tab]")) {
      const n = Number(el.dataset.weather || el.dataset.weatherTab),
        d = days[n - 1],
        pt = d && dayPoint(n);
      if (!pt) continue;
      window.Weather.forecast(pt.lat, pt.lng).then((all) => {
        const w = all?.[isoDash(d)];
        if (!w || w.max == null) return;
        const { icon, text } = window.Weather.describe(w.code);
        if (el.dataset.weatherTab) el.textContent = `${icon} ${Math.round(w.max)}°`;
        else {
          el.textContent = `${icon} ${text} · ${Math.round(w.min)}–${Math.round(w.max)}°C${w.rain != null ? ` · 降雨機會 ${w.rain}%` : ""}`;
          el.hidden = false;
        }
      });
    }
  }
  // ---- 行程 links: getting from one stop to the next (Google routes and AI advice) ----
  // ---- Getting there: route suggestions from the previous stop (Google Routes API via the suggestRoutes function) ----
  const ROUTE_MODES = { TRANSIT: ["公共交通", "transit"], WALK: ["步行", "walking"], DRIVE: ["駕車", "driving"] };
  const VEHICLE_ICON = {
    SUBWAY: "🚇",
    METRO_RAIL: "🚇",
    HIGH_SPEED_TRAIN: "🚄",
    HEAVY_RAIL: "🚆",
    RAIL: "🚆",
    COMMUTER_TRAIN: "🚆",
    LONG_DISTANCE_TRAIN: "🚆",
    BUS: "🚌",
    INTERCITY_BUS: "🚌",
    TROLLEYBUS: "🚌",
    SHARE_TAXI: "🚐",
    TRAM: "🚊",
    LIGHT_RAIL: "🚊",
    MONORAIL: "🚝",
    FERRY: "⛴",
    CABLE_CAR: "🚡",
    GONDOLA_LIFT: "🚡",
    FUNICULAR: "🚞",
  };
  let routeCtx = null;
  // Where a stop is: its explore place's pin, its own coordinates, else its address text.
  function stopPoint(s) {
    const g = s.placeId && window.TRIP_GEO?.places?.[s.placeId]?.[0];
    if (g) return { lat: g.lat, lng: g.lng };
    if (Number.isFinite(s.lat) && Number.isFinite(s.lng)) return { lat: s.lat, lng: s.lng };
    const a = (s.target || `${s.title || ""} ${s.area || ""}`).trim();
    return a ? { address: a } : null;
  }
  const hotelPoint = (h) =>
    Number.isFinite(h.lat) && Number.isFinite(h.lng)
      ? { lat: h.lat, lng: h.lng }
      : { address: `${h.name} ${h.address || ""}`.trim() };
  const endClock = (t) => {
    const m =
      String(t || "").match(/(\d{1,2}):(\d{2})\s*[–~\-－至到]+\s*(\d{1,2}):(\d{2})/) ||
      String(t || "").match(/(\d{1,2}):(\d{2})/);
    return m ? (m[3] ? `${m[3].padStart(2, "0")}:${m[4]}` : `${m[1].padStart(2, "0")}:${m[2]}`) : "";
  };
  const fareText = (o) =>
    o.fare
      ? window.Split.currencies[o.fare.currency]
        ? window.Split.format(window.Split.toMinor(o.fare.amount, o.fare.currency), o.fare.currency)
        : `${o.fare.currency} ${o.fare.amount}`
      : "";
  function routeText(o, mode) {
    const km = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} 公里` : `${m} 米`);
    if (mode !== "TRANSIT") return `${mode === "WALK" ? "🚶 步行" : "🚗 駕車"}約 ${o.minutes} 分（${km(o.meters)}）`;
    const fare = fareText(o);
    return `${o.steps.map((s) => (s.mode === "TRANSIT" ? `${VEHICLE_ICON[s.vehicle] || "🚉"} ${s.line} ${s.from} → ${s.to}（${s.stops ? `${s.stops} 站，` : ""}${s.depart}${s.arrive ? `–${s.arrive}` : ""}）` : `🚶 ${s.minutes} 分`)).join(" → ")}｜約 ${o.minutes} 分${fare ? ` · ${fare}` : ""}`;
  }
  // The link between two time slots on the plan: a dot on the timeline with the chosen way to get to the next slot.
  // Trips with hotels also get a link before the first slot, from the hotel.
  const hotelLink = () => lists().hotels.length > 0;
  function stopLink(all, n) {
    const prev = all[n - 1],
      next = all[n],
      multi = next.length > 1;
    // The whole way, shown in full: the total time and fare first, then one line per step ("🚄 ひかり 博多 → 小倉（08:15–08:33）").
    const legHtml = (t) => {
      const [steps, total] = String(t).split("｜");
      const parts = total ? steps.split(/ → (?=\p{Extended_Pictographic})/u) : [String(t)];
      return `${total ? `<b class="route-total">${esc(total.trim())}</b>` : ""}${parts.map((p) => `<span class="route-step">${esc(p.trim())}</span>`).join("")}`;
    };
    const lines = next.filter(({ s }) => s.transport).map(({ s }) => `<span class="route-line">${multi ? `<b class="route-for">${esc(s.title)}</b>` : ""}${legHtml(s.transport)}</span>`);
    return `<div class="stop-link"><div></div><button type="button" class="route-dot${lines.length ? " has-route" : ""}" data-route-link="${n}" aria-label="${prev ? esc(prev[0].s.title) : "酒店"} 至 ${esc(next[0].s.title)} 的交通"><i aria-hidden="true"></i><span>${lines.length ? lines.join("") : `${icon(prev ? "train" : "bed")}${prev ? "查交通" : "由酒店出發 · 查交通"}`}</span></button>${Kit.btn("在這裡加入地點", { size: "sm", variant: "ghost", icon: "plus", iconOnly: true, cls: "link-add", attrs: { "data-plan-insert": n } })}</div>`;
  }
  function routeDialog(day, i, fromGroup = null, toGroup = null) {
    const list = stopsFor(day),
      to = list[i];
    if (!to) return;
    const groups = stopGroups(list),
      gi = groups.findIndex((g) => g.some((x) => x.i === i)),
      earlier = groups.slice(0, gi).flat().reverse();
    // Leave from the slot just above first (all its choices), then anything earlier, then the hotels.
    const first = fromGroup || (gi > 0 ? groups[gi - 1] : []),
      rest = earlier.filter((x) => !first.includes(x));
    const hs = lists().hotels,
      nightBefore = days[day - 2]?.hotel || days[day - 1]?.hotel;
    const origins = [...first, ...rest]
      .map(({ s, i: k }) => ({
        key: "s" + k,
        label: `${s.time ? s.time + " " : ""}${s.title}`,
        name: s.title,
        address: s.target || "",
        point: stopPoint(s),
        time: endClock(s.time),
      }))
      .concat(
        hs.map((h) => ({
          key: "h" + h.id,
          label: `🏨 ${h.name}`,
          name: h.name,
          address: h.address || "",
          point: hotelPoint(h),
          time: "",
        })),
      )
      .filter((o) => o.point);
    const night = hs.find((h) => h.name === nightBefore),
      def = first.length ? "s" + first[0].i : night ? "h" + night.id : origins[0]?.key;
    const dests = (toGroup || groups[gi] || []).map((x) => x.i);
    routeCtx = { day, i, origins, mode: "TRANSIT" };
    const start = origins.find((o) => o.key === def)?.time || "";
    openDialog(
      `<div class="eyebrow">交通 · D${day}</div><h2 class="detailtitle" id="routeTitle">前往 ${esc(to.title)}</h2>${dests.length > 1 ? `<div class="tg-form route-form"><label>目的地（同一時間有 ${dests.length} 個選擇）<select id="routeTo">${dests.map((k) => `<option value="${k}"${k === i ? " selected" : ""}>${esc(list[k].title)}</option>`).join("")}</select></label></div>` : ""}${
        origins.length
          ? `<div class="tg-form route-form"><label>出發地<select id="routeFrom">${origins.map((o) => `<option value="${esc(o.key)}"${o.key === def ? " selected" : ""}>${esc(o.label)}</option>`).join("")}</select></label><div class="tg-row"><label>出發時間<input id="routeTime" type="time" value="${esc(start || "09:00")}"></label><label>方式<select id="routeMode">${Object.entries(
              ROUTE_MODES,
            )
              .map(([k, [v]]) => `<option value="${k}">${v}</option>`)
              .join(
                "",
              )}</select></label></div>${Kit.btn("查詢路線建議", { variant: "primary", cls: "btn-block", attrs: { id: "routeGo" } })}</div><div id="routeResults" class="route-results"></div><div id="routeAi" class="route-results"></div>`
          : '<p class="note">這天前面沒有站點，亦未有住宿資料，未能查詢路線；可以自行填寫。</p>'
      }<form class="tg-form" id="routeManual"><label>交通（可自行修改）<textarea name="transport" rows="3" maxlength="500" placeholder="例如：地下鐵空港線 博多 → 天神，約 5 分">${esc(to.transport || "")}</textarea></label>${Kit.btn("儲存交通", { type: "submit", variant: "secondary" })}</form>`,
    );
  }
  async function runRoutes() {
    const c = routeCtx,
      box = $("#routeResults");
    if (!c || !box) return;
    const from = c.origins.find((o) => o.key === $("#routeFrom").value),
      to = stopsFor(c.day)[c.i],
      dest = stopPoint(to),
      mode = $("#routeMode").value,
      time = $("#routeTime").value || "09:00";
    c.mode = mode;
    const gm = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(from.point.address || `${from.point.lat},${from.point.lng}`)}&destination=${encodeURIComponent(dest.address || `${dest.lat},${dest.lng}`)}&travelmode=${ROUTE_MODES[mode][1]}`;
    // Yahoo!乗換案内 with the names, date and time filled in: the timetable in the browser
    const [yy, mo, dd] = isoDash(days[c.day - 1]).split("-"),
      [hh, mi] = time.split(":"),
      yahoo = `https://transit.yahoo.co.jp/search/result?${new URLSearchParams({ from: from.name, to: to.title, y: yy, m: mo, d: dd, hh, m1: mi[0], m2: mi[1], type: "1" })}`;
    const gmLink = `${Kit.btn("在 Google 地圖查看", { href: gm, external: true, size: "sm", icon: "map" })}${meta.country === "JP" && mode === "TRANSIT" ? Kit.btn("Yahoo!乗換案内", { href: yahoo, external: true, size: "sm", icon: "train" }) : ""}${Kit.btn("AI 分析", { variant: "secondary", size: "sm", icon: "sparkles", attrs: { "data-route-ai": true } })}`;
    c.ai = { from, to, dest, time };
    box.innerHTML = Kit.progress({ text: "正在查詢 Google 地圖…", seconds: 6 });
    try {
      const r = await window.Together.suggestRoutes({
        origin: from.point,
        destination: dest,
        mode,
        country: meta.country || "",
        time: `${isoDash(days[c.day - 1])}T${time}`,
      });
      c.options = r.options;
      box.innerHTML = r.options.length
        ? `${r.source === "navitime" ? '<p class="note">火車班次及車費由 NAVITIME 提供（車費＝車票＋自由席特急料金）；不包括巴士，搭巴士較方便時請按「AI 分析」。</p>' : ""}${r.estimated ? '<p class="note">行程日期太遠或已過，班次按下一個相同星期的時間估算，出發前請再確認。</p>' : ""}${r.options.map((o, k) => `<div class="route-option"><div class="route-head"><b>約 ${o.minutes} 分</b>${o.fare ? `<span>${esc(fareText(o))}</span>` : ""}${mode === "TRANSIT" && o.steps.find((s) => s.mode === "TRANSIT") ? `<span>${esc(o.steps.find((s) => s.mode === "TRANSIT").depart)} 開出</span>` : ""}</div><ol class="route-steps">${mode === "TRANSIT" ? o.steps.map((s) => (s.mode === "TRANSIT" ? `<li><b>${VEHICLE_ICON[s.vehicle] || "🚉"} ${esc(s.line)}</b>${s.headsign ? ` <small>往 ${esc(s.headsign)}</small>` : ""}<div>${esc(s.from)} → ${esc(s.to)}${s.stops ? ` · ${s.stops} 站` : ""} · ${esc(s.depart)}–${esc(s.arrive)}</div></li>` : `<li>🚶 步行 ${s.minutes} 分</li>`)).join("") : `<li>${esc(routeText(o, mode))}</li>`}</ol>${Kit.btn("選用這個", { variant: "secondary", size: "sm", icon: "check", attrs: { "data-route-pick": k } })}</div>`).join("")}<div class="links">${gmLink}</div>`
        : `<p class="note">${mode === "TRANSIT" && meta.country === "JP" ? "找不到公共交通班次，可以按「Yahoo!乗換案内」或「AI 分析」。" : `Google 地圖找不到${ROUTE_MODES[mode][0]}路線。`}</p><div class="links">${gmLink}</div>`;
    } catch (e) {
      box.innerHTML = `<p class="note">${esc(fnError(e, "未能查詢路線，請檢查網絡後再試。"))}</p><div class="links">${gmLink}</div>`;
    }
  }
  // AI route advice (aiRoutes function): several ways with lines and stations, times and fares are estimates.
  const AI_MODE_ICON = { WALK: "🚶", TAXI: "🚕", DRIVE: "🚗" };
  const aiStep = (s) =>
    s.mode === "TRANSIT"
      ? `${VEHICLE_ICON[s.vehicle] || "🚉"} ${s.line}${s.from || s.to ? ` ${s.from} → ${s.to}` : ""}${s.minutes ? `（約 ${s.minutes} 分）` : ""}`
      : `${AI_MODE_ICON[s.mode] || "🚶"} ${s.mode === "WALK" ? "步行" : s.mode === "TAXI" ? "的士" : "駕車"} ${s.minutes} 分`;
  const aiRouteText = (o) =>
    `${o.title ? o.title + "：" : ""}${o.steps.map(aiStep).join(" → ")}｜約 ${o.minutes} 分${o.fare ? ` · ${fareText(o)}` : ""}（AI 估算）`;
  async function runAiRoutes() {
    const c = routeCtx,
      box = $("#routeAi");
    if (!c?.ai || !box) return;
    const { from, to, dest, time } = c.ai;
    box.innerHTML = `<div class="route-ai-wait"><b>${icon("sparkles")} AI 正在考慮路線…</b>${Kit.progress({ text: "大約需要 10–30 秒。", seconds: 25 })}</div>`;
    box.scrollIntoView({ block: "nearest", behavior: "smooth" });
    try {
      const r = await window.Together.aiRoutes({
        origin: {
          name: from.name,
          address: from.address || from.point.address || "",
          ...(from.point.lat != null ? { lat: from.point.lat, lng: from.point.lng } : {}),
        },
        destination: {
          name: to.title,
          address: to.target || "",
          region: meta.destination || days[c.day - 1].region || "",
          ...(dest.lat != null ? { lat: dest.lat, lng: dest.lng } : {}),
        },
        time: `${isoDash(days[c.day - 1])}T${time}`,
        currency: meta.currency || "JPY",
      });
      c.aiOptions = r.options;
      box.innerHTML = r.options.length
        ? `<div class="route-ai-head"><b>${icon("sparkles")} AI 建議</b>${r.advice ? `<p>${esc(r.advice)}</p>` : ""}<p class="note">由 AI 按一般情況估算，班次、時間及車費可能不準，出發前請用 Google 地圖或車站資料確認。</p></div>${r.options.map((o, k) => `<div class="route-option ai"><div class="route-head"><b>${esc(o.title || `方案 ${k + 1}`)}</b><span class="ai-sure ${esc(o.confidence || "low")}">${{ high: "把握：高", medium: "把握：中", low: "把握：低，請核對" }[o.confidence] || "把握：低，請核對"}</span><span>約 ${o.minutes} 分</span>${o.fare ? `<span>${esc(fareText(o))}</span>` : ""}</div><ol class="route-steps">${o.steps.map((s) => `<li>${esc(aiStep(s))}</li>`).join("")}</ol>${o.note ? `<p class="note">${esc(o.note)}</p>` : ""}${Kit.btn("選用這個", { variant: "secondary", size: "sm", icon: "check", attrs: { "data-route-ai-pick": k } })}</div>`).join("")}`
        : '<p class="note">AI 未能提供路線建議。</p>';
    } catch (e) {
      box.innerHTML = `<p class="note">${esc(fnError(e, "未能進行 AI 分析，請檢查網絡後再試。"))}</p>`;
    }
  }
  function saveTransport(text) {
    const c = routeCtx;
    if (!c) return;
    const list = [...stopsFor(c.day)];
    if (!list[c.i]) return;
    list[c.i] = { ...list[c.i], transport: String(text).trim().slice(0, 500) };
    savePlan(c.day, list);
    toast("已儲存交通");
  }
  document.addEventListener("change", (e) => {
    if (e.target.id !== "routeTo" || !routeCtx) return;
    const i = Number(e.target.value),
      s = stopsFor(routeCtx.day)[i];
    if (!s) return;
    routeCtx.i = i;
    routeCtx.options = null;
    $("#routeTitle").textContent = `前往 ${s.title}`;
    $("#routeManual textarea").value = s.transport || "";
    $("#routeResults").innerHTML = "";
    $("#routeAi").innerHTML = "";
    routeCtx.ai = null;
  });
  document.addEventListener("submit", (e) => {
    if (e.target.id !== "routeManual") return;
    e.preventDefault();
    saveTransport(e.target.elements.transport.value);
    $("#detail").close();
  });
  document.addEventListener("click", (e) => {
    if (e.target.closest("#routeGo")) runRoutes();
    if (e.target.closest("[data-route-ai]")) runAiRoutes();
    const aiPick = e.target.closest("[data-route-ai-pick]");
    if (aiPick && routeCtx?.aiOptions) {
      const k = Number(aiPick.dataset.routeAiPick),
        text = aiRouteText(routeCtx.aiOptions[k]),
        ta = $("#routeManual textarea");
      if (ta) ta.value = text;
      saveTransport(text);
      document
        .querySelectorAll(".route-option")
        .forEach((o) => o.classList.toggle("picked", o === aiPick.closest(".route-option")));
    }
    const pick = e.target.closest("[data-route-pick]");
    if (pick && routeCtx?.options) {
      const text = routeText(routeCtx.options[Number(pick.dataset.routePick)], routeCtx.mode),
        ta = $("#routeManual textarea");
      if (ta) ta.value = text;
      saveTransport(text);
      document
        .querySelectorAll(".route-option")
        .forEach((o, k) => o.classList.toggle("picked", k === Number(pick.dataset.routePick)));
    }
  });
  // ---- 行程 tools: order by distance, drag to reorder, every leg's transport at once, AI arrangement and times ----
  // Times and transport follow the order: a stop whose previous stop changed loses its transport (and AI warning),
  // and a reordered day that had times gets them worked out again. Each change can be undone from the snack bar.
  const placeOf = (s) => (s.placeId && places.find((p) => p.id === s.placeId)) || null;
  const pointOf = (s) => {
    const p = s && stopPoint(s);
    return p && Number.isFinite(p.lat) ? p : null;
  };
  const stopKey = (s) => s && (s.placeId || s.hotelId || s.title);
  // The hotel the day starts from (last night's) and the one it ends at.
  const hotelNamed = (name) => name && lists().hotels.find((h) => h.name === name);
  const dayStartHotel = (day) => hotelNamed(days[day - 2]?.hotel);
  const dayEndHotel = (day) => hotelNamed(days[day - 1]?.hotel);

  function legsChanged(before, after) {
    const prevOf = (list) => {
      const m = new Map();
      stopGroups(list).forEach((g, n, gs) => g.forEach(({ s }) => m.set(s, n ? stopKey(gs[n - 1][0].s) : null)));
      return m;
    };
    const was = new Map();
    stopGroups(before).forEach((g, n, gs) => g.forEach(({ s }) => was.set(stopKey(s), n ? stopKey(gs[n - 1][0].s) : null)));
    const now = prevOf(after);
    return after.map((s) => (was.has(stopKey(s)) && was.get(stopKey(s)) === now.get(s) ? s : { ...s, transport: "", warn: "" }));
  }

  // Minutes planned at a stop: a time range the traveller typed (修改), else a usual visit length for its kind of place.
  // Stations, bus stops, airports and piers are only where the travellers change (5 minutes, shown as the arrival time).
  // Ranges worked out here or by the AI are not kept, so a wrong guess is not repeated by the next 推算時間.
  const STATION = /(駅|站|車站|バス停|バスターミナル|空港|機場|港|ターミナル|station|terminal)$/i;
  const isStation = (s) => {
    const p = placeOf(s);
    return p?.cats.includes("交通") || STATION.test(String(s.title).trim()) || /駅|車站|バス停|空港|機場|フェリー乗り場|train station|bus station|airport/i.test(p?.v[2] || "");
  };
  // A hotel that starts or ends the day is only a time; in the middle of the day it is a check-in or luggage stop.
  function stayOf(s, role = "") {
    if (isStation(s)) return 5;
    const m = s.manual && String(s.time || "").match(/(\d{1,2}):(\d{2})\s*[–~\-－至到]+\s*(\d{1,2}):(\d{2})/);
    if (m) {
      const d = Number(m[3]) * 60 + Number(m[4]) - (Number(m[1]) * 60 + Number(m[2]));
      if (d > 0) return d;
    }
    if (s.hotelId) return role === "mid" ? 15 : 0;
    const p = placeOf(s),
      t = `${s.title} ${p?.v[2] || ""} ${p?.cats.join(" ") || ""}`;
    if (/展望|足湯|鳥居|タワー|塔$|塔 /.test(t)) return 30;
    if (/博物館|美術館|水族館|纜車|ロープウェイ|地獄|動物園|樂園|テーマパーク/.test(t)) return 75;
    if (/溫泉|温泉|湯$|浴場/.test(t)) return 60;
    if (/咖啡|甜品|cafe|カフェ|喫茶|茶屋|雪糕|布甸|ジェラート/i.test(t)) return 40;
    if (/公園|神社|寺|稻荷|稲荷|庭園|老街|商店街|街道|通り/.test(t)) return 45;
    if (/餐廳|拉麵|ラーメン|食堂|居酒屋|燒肉|焼肉|壽司|寿司|鍋|麵|うどん|そば|料理/.test(t)) return 60;
    if (/商店|購物|百貨|藥妝|手信|ショップ|モール/.test(t)) return 45;
    return 60;
  }
  // Minutes to get to a stop: its saved transport ("約 14 分"), else a guess from the distance.
  function legMinutes(prev, s) {
    const m = String(s.transport || "").match(/｜約\s*(\d+)\s*分/) || String(s.transport || "").match(/約\s*(\d+)\s*分/);
    if (m) return Number(m[1]);
    const a = pointOf(prev),
      b = pointOf(s);
    if (!a || !b) return 20;
    const d = window.Nearby.distance(a, b);
    return d < 1000 ? Math.max(3, Math.ceil((d * 1.3) / 75)) : Math.round(15 + (d / 1000) * 2.5);
  }
  const hm = (t) => `${String(Math.floor(t / 60) % 24).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
  function retimed(list) {
    const out = [...list];
    let t = startMinute(list[0]?.time) ?? 9 * 60;
    stopGroups(list).forEach((g, n, gs) => {
      if (n) t = Math.ceil((t + legMinutes(gs[n - 1][0].s, g[0].s)) / 5) * 5;
      const role = n === 0 || n === gs.length - 1 ? "edge" : "mid",
        stay = Math.max(...g.map(({ s }) => stayOf(s, role)));
      for (const { s, i } of g) out[i] = { ...s, time: stay > 5 ? `${hm(t)}–${hm(t + stay)}` : hm(t), manual: false };
      t += stay;
    });
    return out;
  }
  const hasTimes = (list) => list.some((s) => startMinute(s.time) != null);
  function changeDay(day, after, text) {
    const before = stopsFor(day);
    savePlan(day, after);
    Kit.snack(text, { action: "復原" }).then((undo) => undo && savePlan(day, before));
  }

  // 排順路: nearest stop next, then 2-opt, from the hotel the day starts at (or the first stop) to tonight's hotel.
  // Time slots with several choices move together; stops without a position stay at the end.
  function orderByDistance(day) {
    const before = stopsFor(day),
      gs = stopGroups(before);
    const head = gs[0]?.[0].s.hotelId || !dayStartHotel(day) ? [gs.shift()] : [];
    const tail = gs.length && gs.at(-1)[0].s.hotelId ? [gs.pop()] : [];
    const free = gs.filter((g) => pointOf(g[0].s)),
      lost = gs.filter((g) => !pointOf(g[0].s));
    if (free.length < 2) return toast("站點太少或未有位置，未能排順路。");
    const startH = dayStartHotel(day),
      endH = tail.length ? null : dayEndHotel(day);
    const S = head.length ? pointOf(head[0][0].s) : startH && Number.isFinite(startH.lat) ? startH : null,
      E = tail.length ? pointOf(tail[0][0].s) : endH && Number.isFinite(endH.lat) ? endH : null;
    const P = free.map((g) => pointOf(g[0].s)),
      dist = (a, b) => (a && b ? window.Nearby.distance(a, b) : 0);
    const cost = (o) => dist(S, P[o[0]]) + o.slice(1).reduce((t, k, j) => t + dist(P[o[j]], P[k]), 0) + dist(P[o.at(-1)], E);
    // Nearest neighbour from the start
    const left = new Set(P.keys()),
      order = [];
    let at = S || P[0];
    while (left.size) {
      const k = [...left].sort((a, b) => dist(at, P[a]) - dist(at, P[b]))[0];
      order.push(k);
      left.delete(k);
      at = P[k];
    }
    // 2-opt: reverse stretches while it shortens the day
    for (let better = true, rounds = 0; better && rounds < 50; rounds++) {
      better = false;
      for (let i = 0; i < order.length - 1; i++)
        for (let j = i + 1; j < order.length; j++) {
          const o = [...order.slice(0, i), ...order.slice(i, j + 1).reverse(), ...order.slice(j + 1)];
          if (cost(o) + 1 < cost(order)) {
            order.splice(0, order.length, ...o);
            better = true;
          }
        }
    }
    const after = [...head, ...order.map((k) => free[k]), ...lost, ...tail].flat().map((x) => x.s);
    if (after.every((s, i) => s === before[i])) return toast("現在的次序已經最順路。");
    const fixed = legsChanged(before, after);
    changeDay(day, hasTimes(before) ? retimed(fixed) : fixed, hasTimes(before) ? "已按距離排順路，並重新推算時間" : "已按距離排順路");
  }

  // Drag a time slot by its handle to a new place in the day.
  function moveGroup(day, from, to) {
    const before = stopsFor(day),
      gs = stopGroups(before),
      [g] = gs.splice(from, 1);
    gs.splice(to, 0, g);
    const after = legsChanged(before, gs.flat().map((x) => x.s));
    changeDay(day, hasTimes(before) ? retimed(after) : after, hasTimes(before) ? "已調整次序，並重新推算時間" : "已調整次序");
  }
  document.addEventListener("pointerdown", (e) => {
    const grip = e.target.closest(".stop-grip");
    if (!grip || e.button > 0) return;
    e.preventDefault();
    const card = grip.closest("article.stop"),
      items = [...card.parentElement.querySelectorAll(":scope > article.stop")],
      from = items.indexOf(card),
      y0 = e.clientY,
      s0 = scrollY;
    let to = from,
      lastY = y0,
      timer = 0;
    card.classList.add("dragging");
    grip.setPointerCapture(e.pointerId);
    const place = () => {
      card.style.transform = `translateY(${lastY - y0 + scrollY - s0}px)`;
      const r = card.getBoundingClientRect(),
        mid = (r.top + r.bottom) / 2;
      to = items.filter((x) => x !== card).filter((x) => {
        const q = x.getBoundingClientRect();
        return mid > (q.top + q.bottom) / 2;
      }).length;
      items.forEach((x) => x.classList.remove("drop-before", "drop-after"));
      const rest = items.filter((x) => x !== card);
      if (to !== from) to < rest.length ? rest[to].classList.add("drop-before") : rest.at(-1).classList.add("drop-after");
    };
    // Scroll while the finger is near the top or the bottom bar
    const edge = () => {
      const dy = lastY < 90 ? -14 : lastY > innerHeight - 130 ? 14 : 0;
      if (dy) {
        scrollBy(0, dy);
        place();
      }
      timer = requestAnimationFrame(edge);
    };
    timer = requestAnimationFrame(edge);
    const move = (ev) => {
      lastY = ev.clientY;
      place();
    };
    const up = () => {
      cancelAnimationFrame(timer);
      grip.removeEventListener("pointermove", move);
      items.forEach((x) => x.classList.remove("drop-before", "drop-after"));
      card.classList.remove("dragging");
      card.style.transform = "";
      if (to !== from) moveGroup(selectedDay, from, to);
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up, { once: true });
    grip.addEventListener("pointercancel", up, { once: true });
  });

  // 查全日交通: every leg without transport (or all of them, when asked) in one request: walks under 1.5 km by Google
  // Maps, trains and buses in Japan by NAVITIME timetables, the rest by the AI.
  const placeForAi = (s) => {
    const p = pointOf(s);
    return { name: s.title || s.name, address: s.target || s.address || "", ...(p ? { lat: p.lat, lng: p.lng } : {}) };
  };
  const legText = (l) =>
    l.source === "navitime"
      ? `${routeText(l, "TRANSIT")}（NAVITIME 班次）`
      : l.source === "google"
      ? `🚶 步行 ${l.minutes} 分（${l.meters >= 1000 ? `${(l.meters / 1000).toFixed(1)} 公里` : `${l.meters} 米`}）｜約 ${l.minutes} 分（Google 地圖）`
      : `${l.steps.map(aiStep).join(" → ")}｜約 ${l.minutes} 分${l.fare ? ` · ${fareText(l)}` : ""}（AI 估算）`;
  function dayLegs(day, all) {
    const list = stopsFor(day),
      gs = stopGroups(list),
      start = !gs[0]?.[0].s.hotelId && dayStartHotel(day);
    const legs = [];
    gs.forEach((g, n) => {
      const from = n ? gs[n - 1][0].s : start ? { title: start.name, target: `${start.name} ${start.address || ""}`.trim(), ...(Number.isFinite(start.lat) ? { lat: start.lat, lng: start.lng } : {}) } : null;
      if (from) for (const { s, i } of g) if (all || !s.transport) legs.push({ i, from, to: s, time: endClock(from.time) });
    });
    return legs;
  }
  async function fillRoutes(day, all = false) {
    const legs = dayLegs(day, all);
    if (!legs.length) {
      if (!dayLegs(day, true).length) return toast("最少要有兩個站點（或住宿）才可以查交通。");
      if (!(await UI.confirm("全部交通已經填好", { text: "要重新查詢全日的交通嗎？", ok: "重新查詢" }))) return;
      return fillRoutes(day, true);
    }
    const found = {},
      done = Kit.busy($("#planToolsInfo"), { text: `正在查詢 ${legs.length} 段交通（步行用 Google 地圖，火車巴士用 NAVITIME 班次）…`, seconds: 10 + legs.length * 4 });
    let ai = false;
    try {
      const d = days[day - 1],
        r = await window.Together.planDay({
          mode: "routes",
          date: isoDash(d),
          weekday: d.weekday,
          region: meta.destination || d.region,
          currency: meta.currency || "JPY",
          legs: legs.map((l) => ({ k: String(l.i), from: placeForAi(l.from), to: placeForAi(l.to), time: l.time })),
        });
      for (const l of r.legs) {
        found[l.k] = legText(l);
        ai ||= !["google", "navitime"].includes(l.source);
      }
    } catch (e) {
      toast(fnError(e, "未能查詢交通，請稍後再試。"));
    } finally {
      done();
    }
    const list = stopsFor(day),
      n = Object.keys(found).length;
    if (!n) return;
    changeDay(day, list.map((s, i) => (found[i] ? { ...s, transport: found[i].slice(0, 500) } : s)), `已填入 ${n} 段交通${ai ? "（AI 估算的部分出發前請再確認）" : ""}`);
  }

  // ✨ AI 安排: order, times and transport for the whole day in one go, shown first and applied only when accepted.
  let aiPlan = null;
  function aiArrangeForm(day) {
    const timed = stopsFor(day).filter((s) => startMinute(s.time) != null).length;
    openDialog(
      `${Kit.sheetHead("AI 安排這天", `D${day}`)}<p class="note">AI 會按距離、營業時間、星期幾及用餐時間，排好次序、時間及每段交通，並提示休息日或趕不及的地方。看過結果才決定是否套用。</p><form class="tg-form" id="aiPlanForm" data-day="${day}">${timed ? `<label class="tg-check"><input type="checkbox" name="keep"> 保留我已填的時間（例如已預約的餐廳）</label>` : ""}${Kit.btn("開始安排", { type: "submit", variant: "primary", icon: "sparkles", cls: "btn-block" })}</form><div id="aiPlanOut"></div>`,
    );
  }
  async function aiArrange(day, keep) {
    const out = $("#aiPlanOut"),
      list = stopsFor(day),
      gs = stopGroups(list),
      d = days[day - 1];
    if (gs.length < 2) return (out.innerHTML = '<p class="note">最少要有兩個站點。</p>');
    const start = !gs[0][0].s.hotelId && dayStartHotel(day),
      end = dayEndHotel(day);
    out.innerHTML = Kit.progress({ text: "AI 正在安排，大約需要 20–60 秒…", seconds: 45 });
    $("#aiPlanForm").hidden = true;
    try {
      const r = await window.Together.planDay({
        mode: "arrange",
        date: isoDash(d),
        weekday: d.weekday,
        region: meta.destination || d.region,
        currency: meta.currency || "JPY",
        start: start ? { k: "start", ...placeForAi({ title: start.name, address: start.address, lat: start.lat, lng: start.lng }) } : null,
        end: end ? { k: "end", ...placeForAi({ title: end.name, address: end.address, lat: end.lat, lng: end.lng }) } : null,
        stops: gs.map((g, n) => {
          const s = g[0].s,
            p = placeOf(s);
          return {
            k: String(n),
            ...placeForAi(s),
            name: g.map((x) => x.s.title).join(" / "),
            type: isStation(s) ? "transport stop (station, bus stop, airport): only where they change trains or buses" : s.hotelId ? (n === 0 ? "hotel: where the day starts" : n === gs.length - 1 ? "hotel: where the day ends" : "hotel: check-in or leaving luggage on the way") : p?.v[2] || p?.cats.join("、") || "",
            hours: String(p?.v[5] || "").slice(0, 300),
            time: s.time || "",
            fixed: (keep && startMinute(s.time) != null) || (n === 0 && !!s.hotelId),
            stay: s.manual || isStation(s) ? stayOf(s, n === 0 || n === gs.length - 1 ? "edge" : "mid") : 0,
          };
        }),
      });
      aiPlan = { day, gs, r, before: list };
      const legOf = (k) => r.legs.find((l) => l.k === k);
      out.innerHTML = `${r.advice ? `<div class="route-ai-head"><b>${icon("sparkles")} AI 建議</b><p>${esc(r.advice)}</p></div>` : ""}<ol class="ai-plan">${r.order
        .map((k, j) => {
          const g = gs[Number(k)],
            leg = j ? legOf(k) : null;
          return `${leg ? `<li class="ai-plan-leg">${esc(legText(leg))}</li>` : ""}<li class="ai-plan-stop"><b>${esc(r.times[k] || "")}</b><span>${g.map((x) => esc(x.s.title)).join(" / ")}</span>${r.warnings[k] ? `<small class="stop-warn">${icon("clock")}<span>${esc(r.warnings[k])}</span></small>` : ""}</li>`;
        })
        .join("")}</ol><p class="note">時間、交通及車費由 AI 估算，出發前請再確認。</p><div class="detail-actions">${Kit.btn("套用", { variant: "primary", icon: "check", attrs: { "data-ai-plan-apply": true } })}${Kit.btn("重新安排", { icon: "redo", attrs: { "data-ai-plan-again": true } })}</div>`;
    } catch (e) {
      console.error(e);
      out.innerHTML = `<p class="note">${esc(fnError(e, "AI 未能安排，請稍後再試。"))}</p>`;
      $("#aiPlanForm").hidden = false;
    }
  }
  function applyAiPlan() {
    const a = aiPlan;
    if (!a) return;
    const { r, gs } = a;
    const after = r.order.flatMap((k, j) => {
      const leg = j ? r.legs.find((l) => l.k === k) : null;
      return gs[Number(k)].map(({ s }) => ({ ...s, manual: false, time: r.times[k] || s.time, transport: leg ? legText(leg).slice(0, 500) : j ? "" : s.transport, warn: r.warnings[k] || "" }));
    });
    $("#detail").close();
    aiPlan = null;
    changeDay(a.day, after, "已套用 AI 安排");
  }

  function planTools(stops) {
    return `<div class="plan-tools" role="toolbar" aria-label="安排這天">${[
      ["排順路", "route", "data-plan-order"],
      ["查全日交通", "train", "data-plan-routes"],
      ["AI 安排", "sparkles", "data-plan-ai"],
      ["推算時間", "clock", "data-plan-times"],
    ]
      .map(([label, ic, attr]) => Kit.btn(label, { size: "sm", variant: attr === "data-plan-ai" ? "secondary" : "outline", icon: ic, attrs: { [attr]: true, ...(stops.length < 2 && attr !== "data-plan-routes" ? { disabled: true } : {}) } }))
      .join("")}</div><p class="note" id="planToolsInfo" hidden></p>`;
  }
  document.addEventListener("click", (e) => {
    const el = e.target.closest("button");
    if (!el) return;
    const day = selectedDay;
    if (el.dataset.planInsert !== undefined) {
      const g = stopGroups(stopsFor(day))[Number(el.dataset.planInsert)];
      if (g) pickPlaceForPlan(day, null, g[0].i);
    }
    if (el.dataset.planOrder !== undefined) orderByDistance(day);
    if (el.dataset.planRoutes !== undefined) fillRoutes(day);
    if (el.dataset.planAi !== undefined) aiArrangeForm(day);
    if (el.dataset.planTimes !== undefined) {
      const after = retimed(stopsFor(day)),
        end = after.at(-1)?.time.match(/(\d{1,2}):(\d{2})\s*$/),
        late = end && (Number(end[1]) >= 22 || Number(end[1]) < 5);
      changeDay(day, after, late ? `已推算；最後一站 ${end[0]}，太夜了，可以考慮刪減` : "已按交通及停留時間推算（車站只計 5 分鐘）");
    }
    if (el.dataset.aiPlanApply !== undefined) applyAiPlan();
    if (el.dataset.aiPlanAgain !== undefined && aiPlan) aiArrange(aiPlan.day, $("#aiPlanForm")?.elements.keep?.checked);
    if (el.dataset.ppAiAgain !== undefined) {
      ppAi = null;
      ppResults();
    }
  });
  document.addEventListener("submit", (e) => {
    if (e.target.id !== "aiPlanForm") return;
    e.preventDefault();
    aiArrange(Number(e.target.dataset.day), e.target.elements.keep?.checked);
  });
  // ---- 資料簿 (notebook): everything in the trip, searchable ----
  let notebookSearch = "",
    notebookType = "全部",
    notebookRegion = "全部區域";
  function notebookRecords() {
    const out = places.map((p) => ({
      id: p.id,
      type: p.cats[0] || p.v[6],
      types: p.cats,
      title: p.v[1],
      region: p.v[0],
      summary: p.v[4],
      sub: p.v[5],
      place: p,
      source: "地點資料",
    }));
    return [...out, ...tripRecords()];
  }
  // Besides places, the notebook gathers what companions entered: plan stops, hotels, flights, shopping and notes.
  function tripRecords() {
    const L = lists(),
      out = [],
      S = window.Split;
    days.forEach((d) =>
      stopsFor(d.n).forEach((s, k) =>
        out.push({
          id: `st${d.n}-${k}`,
          type: "行程",
          types: ["行程"],
          title: s.title,
          region: s.area || d.region,
          summary: s.detail || "",
          sub: `D${d.n} ${d.date}${s.time ? ` · ${s.time}` : ""}`,
          source: `第 ${d.n} 天行程`,
          fields: [
            ["日期", `D${d.n} ${d.date} ${d.weekday}`],
            ["時間", s.time],
            ["區域", s.area],
            ["內容", s.detail],
            ["交通", s.transport],
          ],
          urls: urlList(s.ref),
          target: s.target,
          day: d.n,
          placeId: s.placeId,
        }),
      ),
    );
    L.hotels.forEach((h) =>
      out.push({
        id: "ho" + h.id,
        type: "酒店",
        types: ["酒店"],
        title: h.name,
        region: "住宿",
        summary: h.address || "",
        sub: h.checkIn ? `${h.checkIn} → ${h.checkOut || "?"}` : "日期未定",
        source: "住宿",
        fields: [
          ["入住", h.checkIn],
          ["退房", h.checkOut],
          ["地址", h.address],
          ["備註", h.note],
        ],
        urls: h.mapsUrl ? [h.mapsUrl] : [],
        target: `${h.name} ${h.address || ""}`.trim(),
      }),
    );
    L.flights.forEach((f) =>
      out.push({
        id: "fl" + f.id,
        type: "機票",
        types: ["機票"],
        title: `${f.flightNo} ${f.airline || ""}`.trim(),
        region: "航班",
        summary: `${f.from || ""} → ${f.to || ""}`,
        sub: `${fmtTime(f.depart)} → ${fmtTime(f.arrive)}`,
        source: "航班",
        fields: [
          ["航班", f.flightNo],
          ["航空公司", f.airline],
          ["出發", [f.from, fmtTime(f.depart)].filter(Boolean).join(" · ")],
          ["到達", [f.to, fmtTime(f.arrive)].filter(Boolean).join(" · ")],
          ["備註", f.note],
        ],
      }),
    );
    (L.shopping || []).forEach((x) =>
      out.push({
        id: "sh" + x.id,
        type: "購物",
        types: ["購物"],
        title: x.name,
        region: window.Together?.shopCats?.[x.cat] || "購物清單",
        summary: [x.qty, x.detail, x.place].filter(Boolean).join(" · "),
        sub: x.bought
          ? `✓ 已買${x.boughtBy ? `（${x.boughtBy}）` : ""}`
          : x.price != null && S.currencies[x.currency]
            ? `未買 · ${S.format(S.toMinor(x.price, x.currency), x.currency)}`
            : "未買",
        source: "購物清單",
        shopId: x.id,
      }),
    );
    (L.notes || []).forEach((n) =>
      out.push({
        id: "no" + n.id,
        type: n.kind === "coupon" ? "優惠券" : "筆記",
        types: n.kind === "coupon" ? ["筆記", "優惠券"] : ["筆記"],
        title:
          n.kind === "coupon"
            ? `🎟 ${n.title}`
            : String(n.text || "")
                .split("\n")[0]
                .slice(0, 60),
        region: "旅伴筆記",
        summary: n.text || "",
        sub: [n.placeName, n.day ? `D${n.day} ${days[n.day - 1]?.date || ""}` : "整個旅程", n.byName].filter(Boolean).join(" · "),
        source: "旅伴筆記",
        fields: [
          ["筆記", n.text],
          ["關於", n.placeName || (n.day ? `D${n.day} ${days[n.day - 1]?.date || ""}` : "整個旅程")],
          ["記錄者", n.byName],
        ],
      }),
    );
    return out;
  }
  const notebookArea = (r) => r.region || "其他";
  function renderNotebook() {
    return `${header("資料簿", "搜尋全部旅程資料，或按分類及區域篩選")}<div class="controls notebook-controls"><div class="searchrow"><input id="notebookSearch" class="search" type="search" aria-label="搜尋完整資料簿" placeholder="輸入店名、菜式、酒店、航班或日期…" value="${esc(notebookSearch)}"><select id="notebookRegion" aria-label="資料簿區域"><option>全部區域</option>${[...new Set(notebookRecords().map(notebookArea))].map((r) => `<option${r === notebookRegion ? " selected" : ""}>${esc(r)}</option>`).join("")}</select></div>${Kit.chips(
      ["全部", "餐廳", "景點", "商店", "行程", "酒店", "機票", "購物", "筆記"].map((t) => ({ label: t, active: t === notebookType, attrs: { "data-notebook-type": t } })),
      { label: "類別" },
    )}</div><div id="notebookResults"></div><p class="note">資料由旅伴在網站內輸入，所有旅伴即時同步。</p>`;
  }
  function notebookResults() {
    const all = notebookRecords(),
      q = notebookSearch.trim().toLocaleLowerCase(),
      rs = all.filter(
        (r) =>
          (notebookType === "全部" || r.types.includes(notebookType)) &&
          (notebookRegion === "全部區域" || notebookArea(r) === notebookRegion) &&
          (!q ||
            [r.title, r.region, r.summary, r.sub, r.source, ...(r.fields || []).flat(), ...(r.place ? r.place.v : [])]
              .join(" ")
              .toLocaleLowerCase()
              .includes(q)),
      );
    $("#notebookResults").innerHTML =
      `<div class="resultsbar"><span>找到 ${rs.length} 項${notebookSearch ? " ·「" + esc(notebookSearch) + "」" : ""}</span>${Kit.btn("清除篩選", { variant: "ghost", size: "sm", attrs: { id: "notebookReset" } })}</div><div class="notebook-list">${rs.map((r) => `<article class="notebook-card"><div class="notebook-meta">${Kit.badge(esc(r.type))}<span>${esc(r.region)}</span></div><h2>${esc(r.title)}</h2><p class="notebook-summary">${esc(r.summary)}</p>${r.sub ? `<p class="notebook-sub">${esc(r.sub)}</p>` : ""}<div class="notebook-bottom"><small>${esc(r.source)}</small>${Kit.btn("查看詳情", { variant: "secondary", size: "sm", attrs: { "data-notebook-record": r.id } })}</div></article>`).join("")}</div>${rs.length ? "" : Kit.empty("找不到符合的資料", "試用較短的店名、菜式或日期，或按「清除篩選」。")}`;
  }
  function bindNotebook() {
    notebookResults();
    $("#notebookSearch").addEventListener("input", (e) => {
      notebookSearch = e.target.value;
      notebookResults();
    });
    $("#notebookRegion").addEventListener("change", (e) => {
      notebookRegion = e.target.value;
      notebookResults();
    });
  }
  function notebookDetail(id) {
    const r = notebookRecords().find((x) => x.id === id);
    if (!r) return;
    if (r.place) {
      placeDetail(r.id);
      return;
    }
    if (r.shopId) {
      window.Together?.openShopItem(r.shopId);
      return;
    }
    openDialog(
      `${Kit.sheetHead(esc(r.title), `${esc(r.type)} · ${esc(r.source)}`)}${(r.fields || [])
        .filter((f) => f[1])
        .map((f) => `<section class="detail-section"><h3>${esc(f[0])}</h3><p>${esc(f[1])}</p></section>`)
        .join(
          "",
        )}<div class="links">${r.day ? Kit.btn("在行程查看", { href: `#plan?day=${r.day}`, variant: "secondary", size: "sm", icon: "calendar" }) : ""}${r.placeId && places.some((p) => p.id === r.placeId) ? Kit.btn("地點資料", { size: "sm", attrs: { "data-place": r.placeId } }) : ""}${r.target ? link(route(r.target), "導航") : ""}${(r.urls || []).map((u, i) => link(u, "參考網站 " + (i + 1))).join("")}</div>`,
    );
  }
  // ---- 住宿 and 機票 (hotels and flights) ----
  const docsBtn = (k, x) => Kit.btn(`文件${x.docs?.length ? `（${x.docs.length}）` : ""}`, { size: "sm", icon: "clip", attrs: { "data-docs": `${k}:${x.id}` } }),
    itemMenu = (k, id) =>
      Kit.menu([
        { label: "編輯", icon: "edit", attrs: { [`data-${k}-edit`]: id } },
        { label: "刪除", icon: "trash", danger: true, attrs: { [`data-${k}-del`]: id } },
      ]);
  function renderHotels() {
    const hs = [...lists().hotels].sort((a, b) => String(a.checkIn).localeCompare(String(b.checkIn)));
    return `${header("住宿")}${hs.length ? `<div class="twocol">${hs.map((h) => `<article class="card hotel"><div class="card-top"><span class="hotelnum">${esc(h.checkIn || "?")} → ${esc(h.checkOut || "?")}${nights(h) > 0 ? ` · ${nights(h)} 晚` : ""}</span>${itemMenu("hotel", h.id)}</div><h2>${esc(h.name)}</h2><dl class="kv">${h.address ? `<dt>地址</dt><dd>${esc(h.address)}</dd>` : ""}${h.note ? `<dt>備註</dt><dd>${esc(h.note)}</dd>` : ""}</dl><div class="links">${link(route(`${h.name} ${h.address}`.trim()), "導航")}${h.mapsUrl ? link(h.mapsUrl, "Google 地圖") : ""}${docsBtn("hotels", h)}</div></article>`).join("")}</div>` : Kit.empty("還沒有住宿", "按右下角「新增住宿」，貼上酒店的 Google 地圖連結即可自動填寫。")}${Kit.sectionHead("每晚住宿")}<div class="panel">${days.map((d) => `<a class="dayrow" href="#plan?day=${d.n}"><span class="daynum">D${d.n}</span><div><strong>${esc(d.date)} · ${esc(d.region)}</strong><small>${esc(d.hotel || "未設定")}</small></div>${icon("chevron")}</a>`).join("")}</div>${Kit.fab("新增住宿", { "data-hotel-new": true })}`;
  }
  function hotelForm(h) {
    const v = (k) => esc(h?.[k] ?? ""),
      first = days[0] ? isoDash(days[0]) : "",
      last = days.at(-1) ? isoDash(days.at(-1)) : "";
    openDialog(
      `${Kit.sheetHead(h ? "修改住宿" : "新增住宿")}<form class="tg-form" id="hotelForm" data-id="${h ? esc(h.id) : ""}"><label>Google 地圖連結<span class="searchrow"><input name="mapsUrl" class="search" inputmode="url" autocomplete="off" placeholder="貼上酒店的 Google 地圖分享連結" value="${v("mapsUrl")}">${Kit.btn("自動填寫", { variant: "secondary", icon: "sparkles", attrs: { id: "hotelLookup" } })}</span></label><p class="note" id="hotelLookupInfo"></p><label>酒店名稱<input name="name" required maxlength="100" value="${v("name")}"></label><label>地址<input name="address" maxlength="200" value="${v("address")}"></label><div class="tg-row"><label>入住<input name="checkIn" type="date" value="${h ? v("checkIn") : first}"></label><label>退房<input name="checkOut" type="date" value="${h ? v("checkOut") : last}"></label></div><label>備註（訂單、早餐、寄存行李…）<textarea name="note" rows="2" maxlength="500">${v("note")}</textarea></label><input type="hidden" name="lat" value="${h?.lat ?? ""}"><input type="hidden" name="lng" value="${h?.lng ?? ""}">${Kit.btn(h ? "儲存修改" : "加入住宿", { type: "submit", variant: "primary", cls: "btn-block" })}</form>`,
    );
  }
  async function lookupHotel() {
    const f = $("#hotelForm"),
      el = f.elements,
      info = $("#hotelLookupInfo"),
      url = el.mapsUrl.value.trim();
    if (!url) return toast("請先貼上 Google 地圖連結。");
    info.textContent = "正在查詢 Google 地圖…";
    const done = Kit.busy(info, { seconds: 5 });
    try {
      const r = await window.Together.lookupPlace(url);
      if (r.name) el.name.value = r.name;
      if (r.address) el.address.value = r.address;
      if (Number.isFinite(r.lat)) {
        el.lat.value = r.lat;
        el.lng.value = r.lng;
      }
      if (r.mapsUrl) el.mapsUrl.value = r.mapsUrl;
      info.textContent = "已填入，請檢查入住及退房日期。";
    } catch (e) {
      info.textContent =
        fnError(e, "未能自動填寫，請手動輸入。");
    } finally {
      done();
    }
  }
  function saveHotel(f) {
    const v = new FormData(f),
      g = (k) => String(v.get(k) || "").trim(),
      lat = parseFloat(v.get("lat")),
      lng = parseFloat(v.get("lng"));
    if (!g("name")) return;
    if (g("checkIn") && g("checkOut") && g("checkOut") < g("checkIn")) return toast("退房日期要在入住之後。");
    window.Together.saveItem("hotels", f.dataset.id || null, {
      name: g("name").slice(0, 100),
      address: g("address").slice(0, 200),
      checkIn: g("checkIn"),
      checkOut: g("checkOut"),
      mapsUrl: g("mapsUrl").slice(0, 500),
      note: g("note").slice(0, 500),
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
    });
    $("#detail").close();
  }
  function renderFlights() {
    const fs = [...lists().flights].sort((a, b) => String(a.depart).localeCompare(String(b.depart)));
    return `${header("機票", "航班時間為各地當地時間")}${fs.length ? `<div class="twocol">${fs.map((f) => `<article class="ticket"><div class="ticket-top"><b>${esc(f.depart ? f.depart.slice(0, 10) : "")}</b><span>${esc(f.airline)} · ${esc(f.flightNo)}</span></div><div class="flightpath"><div><strong>${esc(f.from)}</strong><b>${esc(f.depart ? f.depart.slice(11, 16) : "")}</b></div><div class="plane">✈</div><div><strong>${esc(f.to)}</strong><b>${esc(f.arrive ? f.arrive.slice(11, 16) : "")}</b><small>${f.arrive && f.depart && f.arrive.slice(0, 10) !== f.depart.slice(0, 10) ? esc(f.arrive.slice(0, 10)) : ""}</small></div></div><div class="ticket-bottom"><span>${esc(f.note)}</span><span>${docsBtn("flights", f)}${itemMenu("flight", f.id)}</span></div></article>`).join("")}</div>` : Kit.empty("還沒有航班", "按右下角「新增航班」，輸入航班號、出發及到達時間。")}<p class="note">電子機票等文件可按「文件」上載，只限旅伴登入查看。</p>${Kit.fab("新增航班", { "data-flight-new": true })}`;
  }
  function flightForm(f) {
    const v = (k) => esc(f?.[k] ?? "");
    openDialog(
      `${Kit.sheetHead(f ? "修改航班" : "新增航班")}<form class="tg-form" id="flightForm" data-id="${f ? esc(f.id) : ""}"><div class="tg-row"><label>航班號<input name="flightNo" required maxlength="20" placeholder="例如：CX 410" value="${v("flightNo")}"></label><label>航空公司<input name="airline" maxlength="60" value="${v("airline")}"></label></div><div class="tg-row"><label>出發地<input name="from" maxlength="80" placeholder="例如：HKG T1" value="${v("from")}"></label><label>目的地<input name="to" maxlength="80" placeholder="例如：ICN T1" value="${v("to")}"></label></div><div class="tg-row"><label>出發（當地時間）<input name="depart" type="datetime-local" value="${v("depart")}"></label><label>到達（當地時間）<input name="arrive" type="datetime-local" value="${v("arrive")}"></label></div><label>備註（行李限額等，不要輸入訂單資料）<input name="note" maxlength="500" value="${v("note")}"></label>${Kit.btn(f ? "儲存修改" : "加入航班", { type: "submit", variant: "primary", cls: "btn-block" })}</form>`,
    );
  }
  function saveFlight(f) {
    const v = new FormData(f),
      g = (k) => String(v.get(k) || "").trim();
    if (!g("flightNo")) return;
    window.Together.saveItem("flights", f.dataset.id || null, {
      flightNo: g("flightNo").slice(0, 20),
      airline: g("airline").slice(0, 60),
      from: g("from").slice(0, 80),
      to: g("to").slice(0, 80),
      depart: g("depart").slice(0, 20),
      arrive: g("arrive").slice(0, 20),
      note: g("note").slice(0, 500),
    });
    $("#detail").close();
  }
  document.addEventListener("submit", (e) => {
    if (e.target.id === "hotelForm") {
      e.preventDefault();
      saveHotel(e.target);
    }
    if (e.target.id === "flightForm") {
      e.preventDefault();
      saveFlight(e.target);
    }
  });
  // ---- Pages, navigation and the shared click handler; renders the first page ----
  const sectionViews = {
    home: renderHome,
    plan: renderPlan,
    hotels: renderHotels,
    explore: renderExplore,
    nearby: renderNearby,
    flights: renderFlights,
    notebook: renderNotebook,
    shopping: () => window.Together.renderShopping(),
    trips: () => window.Together.renderTrips(),
    together: () =>
      window.Together
        ? window.Together.render()
        : header("共用") + Kit.empty("未能載入共用功能", "請重新整理網頁。"),
  };
  window.TripApp = Object.freeze({
    days,
    places,
    refreshLists,
    shoppingChanged,
    applyPlaceEdits,
    applyPlanEdits,
    setSaved,
    savedIds: () => [...saved],
  });
  // Pages without a tab of their own light up the tab they are reached from.
  const navOf = { nearby: "explore", hotels: "home", flights: "home" };
  function setActive(view) {
    current = view;
    document.querySelectorAll(".bottomnav a").forEach((a) => {
      const active = a.dataset.view === (navOf[view] || view);
      a.classList.toggle("active", active);
      if (active) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    $("#sourceBtn").classList.toggle("active", view === "notebook");
  }
  function refreshExplore() {
    $("#app").innerHTML = renderExplore();
    bindExplore();
  }
  function refreshNotebook() {
    $("#app").innerHTML = renderNotebook();
    bindNotebook();
  }
  function navigate() {
    render();
  }
  function render() {
    const [v, qs] = (location.hash.slice(1) || "home").split("?"),
      params = new URLSearchParams(qs),
      view = Object.hasOwn(sectionViews, v) ? v : "home";
    if (params.has("category")) category = exploreCats.includes(params.get("category")) ? params.get("category") : "全部";
    if (params.has("day")) selectedDay = Math.min(days.length, Math.max(1, Number(params.get("day")) || 1));
    setActive(view);
    Kit.close();
    $("#app").innerHTML = sectionViews[view]() + (view === "home" ? footer() : "");
    if (view === "explore") bindExplore();
    if (view === "notebook") bindNotebook();
    if (view === "nearby") nearbyResults();
    if (view === "plan") paintWeather();
    window.Together?.refresh();
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  $("#detail .dialog-close").onclick = () => $("#detail").close();
  // ☰ menu: the pages without a tab, sharing, and the signed-in account.
  function openMenu() {
    const row = (href, ic, title, sub) =>
      `<a class="menu-row" href="${href}">${icon(ic)}<span><b>${title}</b><small>${sub}</small></span>${icon("chevron")}</a>`;
    Kit.open(
      `${Kit.sheetHead(esc(meta.name || "口袋旅伴"), "選單")}<nav class="menu-list" aria-label="更多頁面">${row("#trips", "suitcase", "我的旅程", "切換、建立或複製旅程，邀請旅伴")}${row("#hotels", "bed", "住宿", `${lists().hotels.length} 間住宿`)}${row("#flights", "plane", "機票", `${lists().flights.length} 個航班`)}${row("#nearby", "locate", "附近", "100／200／500 米內的地點")}${row("#notebook", "book", "資料簿", "搜尋所有旅程資料")}<button type="button" class="menu-row" id="shareBtn">${icon("share")}<span><b>分享連結</b><small>給已加入旅程的旅伴</small></span></button></nav>${window.Together?.account?.() || ""}`,
    );
  }
  $("#menuBtn").onclick = openMenu;
  document.addEventListener("click", async (e) => {
    if (!e.target.closest("#shareBtn")) return;
    const url = location.origin + location.pathname + location.hash;
    try {
      if (navigator.share) await navigator.share({ title: document.title, url });
      else {
        await navigator.clipboard.writeText(url);
        toast("已複製連結，可以分享給旅伴。");
      }
    } catch (e) {
      if (e.name !== "AbortError") toast("請複製瀏覽器網址分享。");
    }
  });
  document.addEventListener("click", async (e) => {
    const el = e.target.closest("button");
    if (!el) return;
    if (el.id === "locateNow" || el.dataset.locate !== undefined) locateNearby();
    if (el.dataset.radius) {
      nearbyState.radius = Number(el.dataset.radius);
      refreshNearby();
    }
    if (el.dataset.nearCategory) {
      nearbyState.category = el.dataset.nearCategory;
      refreshNearby();
    }
    if (el.id === "pickOnMap") openMapPicker();
    if (el.id === "nearbyCoverage") nearbyCoverage();
    if (el.dataset.place) placeDetail(el.dataset.place);
    if (el.dataset.placeNew !== undefined) placeForm(null);
    if (el.dataset.hotelNew !== undefined) hotelForm(null);
    if (el.dataset.hotelEdit) hotelForm(lists().hotels.find((h) => h.id === el.dataset.hotelEdit));
    if (el.id === "hotelLookup") lookupHotel();
    if (el.dataset.hotelDel) {
      const id = el.dataset.hotelDel;
      UI.confirm("刪除這個住宿？", { danger: true, ok: "刪除" }).then((ok) => ok && window.Together.removeItem("hotels", id));
    }
    if (el.dataset.flightNew !== undefined) flightForm(null);
    if (el.dataset.flightEdit) flightForm(lists().flights.find((f) => f.id === el.dataset.flightEdit));
    if (el.dataset.flightDel) {
      const id = el.dataset.flightDel;
      UI.confirm("刪除這個航班？", { danger: true, ok: "刪除" }).then((ok) => ok && window.Together.removeItem("flights", id));
    }
    if (el.dataset.planPrint !== undefined) printPlan();
    if (el.dataset.dayMap !== undefined) {
      const d = days[selectedDay - 1];
      window.MapPicker.route({ title: `DAY ${d.n} · ${d.region}`, stops: routeStops(selectedDay), openDialog, esc });
    }
    if (el.dataset.dayLabel !== undefined) {
      const day = selectedDay;
      UI.prompt("這天的標題", days[day - 1].region, "例如：首爾市區、濟州").then((label) => {
        if (label != null && label.trim()) window.Together.setDayLabel(day, label.trim().slice(0, 40), stopsFor(day));
      });
    }
    if (el.dataset.placePlan) {
      const p = places.find((x) => x.id === el.dataset.placePlan);
      if (p) addPlaceToPlan(p);
    }
    if (el.dataset.stopNew !== undefined) placeForm(null, { day: selectedDay, slot: null });
    if (el.dataset.planPick !== undefined) pickPlaceForPlan(selectedDay);
    if (el.dataset.ppCat) {
      ppCat = el.dataset.ppCat;
      document.querySelectorAll("[data-pp-cat]").forEach((b) => {
        b.classList.toggle("active", b.dataset.ppCat === ppCat);
        b.setAttribute("aria-pressed", b.dataset.ppCat === ppCat);
      });
      ppResults();
    }
    if (el.dataset.ppAdd) addPickedPlace(el.dataset.ppAdd);
    if (el.dataset.spotExplore) {
      const sp = buySpots[Number(el.dataset.spotExplore)];
      if (sp) {
        placeForm(null);
        $("#placeForm").dataset.linkShop = sp.ids.join(",");
        const f = $("#placeForm").elements;
        f.f1.value = sp.name;
        if (sp.address && sp.address !== sp.name) f.f3.value = sp.address;
        if (Number.isFinite(sp.lat)) {
          f.lat.value = sp.lat;
          f.lng.value = sp.lng;
        }
        const c = [...f.cats].find((x) => x.value === "商店");
        if (c) c.checked = true;
        const a = Number.isFinite(sp.lat) && areaAt(sp);
        if (a) f.f0.value = a;
      }
    }
    if (el.dataset.ppHotel) addPickedPlace(el.dataset.ppHotel, true);
    if (el.dataset.ppSpot) {
      const sp = ppSpots[Number(el.dataset.ppSpot)];
      if (sp) sp.placeId ? addPickedPlace(sp.placeId) : addPickedPlace(null, false, sp);
    }
    if (el.dataset.stopAlt) pickPlaceForPlan(selectedDay, Number(el.dataset.stopAlt));
    if (el.dataset.routeLink) {
      const gs = stopGroups(stopsFor(selectedDay)),
        n = Number(el.dataset.routeLink);
      if (gs[n]) routeDialog(selectedDay, gs[n][0].i, gs[n - 1] || [], gs[n]);
    }
    if (el.dataset.stopOwn) placeForm(null, { day: selectedDay, slot: Number(el.dataset.stopOwn) });
    if (el.dataset.stopEdit) stopForm(selectedDay, Number(el.dataset.stopEdit));
    // Deleting a stop takes effect at once; the undo bar puts the day back as it was.
    if (el.dataset.stopDelete) {
      const i = Number(el.dataset.stopDelete),
        day = selectedDay,
        before = stopsFor(day);
      if (before[i]) {
        savePlan(
          day,
          before.filter((_, j) => j !== i),
        );
        Kit.snack(`已刪除「${before[i].title}」`, { action: "復原" }).then((undo) => undo && savePlan(day, before));
      }
    }
    if (el.dataset.stopMove) {
      const [i, dir] = el.dataset.stopMove.split(":").map(Number),
        list = [...stopsFor(selectedDay)],
        j = i + dir;
      if (list[j]) {
        [list[i], list[j]] = [list[j], list[i]];
        savePlan(selectedDay, list);
      }
    }
    if (el.dataset.planReset !== undefined) {
      const day = selectedDay;
      UI.confirm("清空這天？", { text: "這天的站點及標題會刪除。", danger: true, ok: "清空" }).then(
        (ok) => ok && window.Together.resetPlanDay(day),
      );
    }
    if (el.dataset.placeEdit) placeForm(places.find((p) => p.id === el.dataset.placeEdit));
    if (el.id === "placeLookup") lookupPlaceForm();
    if (el.dataset.placePhotoDel !== undefined) setPlacePhoto(null);
    if (el.dataset.branchAdd !== undefined) {
      $("#branchRows").insertAdjacentHTML("beforeend", branchRow());
      $("#branchRows").lastElementChild.querySelector("input").focus();
    }
    if (el.dataset.branchFind !== undefined) findBranch(el.closest(".branch-row"));
    if (el.dataset.branchDel !== undefined) el.closest(".branch-row").remove();
    if (el.id === "stopLookup") lookupStopForm();
    if (el.dataset.placeDelete) {
      const p = places.find((x) => x.id === el.dataset.placeDelete);
      if (p)
        UI.confirm(`刪除「${p.v[1]}」？`, { text: "所有旅伴都會看不到這個地點。", danger: true, ok: "刪除" }).then((ok) => {
          if (ok) {
            window.Together.deletePlace(p);
            $("#detail").close();
          }
        });
    }
    if (el.dataset.save) {
      const id = el.dataset.save;
      saved.has(id) ? saved.delete(id) : saved.add(id);
      const ok = storage.set("kyushu-saved-v1", [...saved]);
      window.Together?.saveFavorites([...saved]);
      if ($("#results")) renderResults();
      if ($("#notebookResults")) notebookResults();
      if (current === "nearby") nearbyResults();
      // the star in an open place sheet follows too
      $("#detailBody")
        .querySelectorAll(`[data-save="${id}"]`)
        .forEach((b) => {
          b.classList.toggle("saved", saved.has(id));
          b.setAttribute("aria-pressed", saved.has(id));
        });
      if (!ok) toast("瀏覽器未允許儲存；收藏只保留至本次離開。");
    }
    if (el.dataset.cat) {
      category = el.dataset.cat;
      refreshExplore();
    }
    if (el.id === "savedToggle") {
      onlySaved = !onlySaved;
      refreshExplore();
    }
    if (el.id === "resetFilters") {
      category = "全部";
      region = "全部區域";
      search = "";
      onlySaved = false;
      refreshExplore();
    }
    if (el.dataset.day) {
      const n = Number(el.dataset.day);
      if (location.hash === "#plan?day=" + n) render();
      else location.hash = "plan?day=" + n;
    }
    if (el.dataset.notebookType) {
      notebookType = el.dataset.notebookType;
      refreshNotebook();
    }
    if (el.id === "notebookReset") {
      notebookSearch = "";
      notebookType = "全部";
      notebookRegion = "全部區域";
      refreshNotebook();
    }
    if (el.dataset.notebookRecord) notebookDetail(el.dataset.notebookRecord);
    if (el.dataset.copy) {
      try {
        await navigator.clipboard.writeText(el.dataset.copy);
        toast("已複製地址");
      } catch {
        toast("請在地址上長按複製");
      }
    }
  });
  // A tap anywhere on an explore card opens the place (its own buttons and links keep their job).
  document.addEventListener("click", (e) => {
    const card = e.target.closest("[data-card-place]");
    if (card && !e.target.closest("a,button,summary,details")) placeDetail(card.dataset.cardPlace);
  });
  document.addEventListener("click", (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (a && a.getAttribute("href") === location.hash) {
      e.preventDefault();
      navigate();
    }
  });
  window.addEventListener("hashchange", () => navigate());
  render();
};

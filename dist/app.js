"use strict";
// One trip (trips/{id} in Firestore): days come from its dates; places, plan, hotels and flights come from Together.
// Generated from src/app/*.js by scripts/build.mjs — edit those files, not this one.
window.startTrip = (meta = {}) => {
  // ---- Shared helpers, trip days, favourites and page state ----
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
    link = (u, label, cls = "action") =>
      `<a class="${cls}" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>`,
    maps = (s) => "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(s),
    route = (s) => "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(s);
  const categories = ["餐廳", "景點", "商店", "手信"];
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
  function toast(s) {
    window.UI.toast(s);
  }
  function openDialog(html) {
    $("#detailBody").innerHTML = html;
    $("#detail").showModal();
  }
  function header(k, t, p = "") {
    return `<div class="pagehead"><div class="eyebrow">${k}</div><h1>${t}</h1>${p ? `<p>${p}</p>` : ""}</div>`;
  }
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
  // ---- 總覽 (home) ----
  const art = `<svg class="hero-art" viewBox="0 0 380 300" aria-hidden="true"><circle cx="267" cy="73" r="44" fill="#d98456"/><path d="M5 224L100 105L177 192L235 111L376 227Z" fill="#6f8977"/><path d="M11 245L113 156L190 234L276 164L385 249Z" fill="#a2b297"/><path d="M0 265Q80 230 153 267T380 255V300H0Z" fill="#cbd1b2"/><path d="M0 280Q88 252 177 282T380 273" fill="none" stroke="#f1e7c9" stroke-width="3"/><path d="M195 150V257M210 150V257M185 160H221M181 146H226" stroke="#bf6749" stroke-width="8"/><rect x="48" y="242" width="94" height="32" rx="8" fill="#e6dfc5"/><rect x="57" y="249" width="18" height="12" rx="3" fill="#486953"/><rect x="82" y="249" width="18" height="12" rx="3" fill="#486953"/><rect x="107" y="249" width="22" height="12" rx="3" fill="#486953"/><circle cx="65" cy="275" r="6" fill="#183e39"/><circle cx="123" cy="275" r="6" fill="#183e39"/><path d="M293 203q-10-13 0-25t0-24M310 211q-10-13 0-25t0-24M327 203q-10-13 0-25t0-24" fill="none" stroke="#ece6ce" stroke-width="3" stroke-linecap="round"/><text x="52" y="228" fill="#e6dfc5" font-size="10" letter-spacing="3">TAKE IT SLOW</text></svg>`;
  function renderHome() {
    const hs = lists().hotels,
      first = days[0],
      last = days.at(-1);
    return `<section class="hero"><div><div class="eyebrow">${esc(meta.destination || "OUR JOURNEY")}</div><h1>${esc(meta.name || "我們的旅程")}</h1><p>${days.length} 天的旅程。<br>把想去的地方，都放進口袋裡。</p><a href="#plan" class="herobtn">打開我們的行程 →</a>${first ? `<div class="stamp" style="margin-bottom:25px">${esc(first.iso.replaceAll("/", "."))} — ${esc(last.iso.slice(5).replace("/", "."))}</div>` : ""}</div>${art}</section><div class="stats"><div class="stat"><b>${days.length}</b><small>天的旅程</small></div><div class="stat"><b>${hs.length}</b><small>間住宿</small></div><div class="stat"><b>${places.length}</b><small>個口袋地點</small></div><div class="stat"><b>${places.filter((p) => saved.has(p.id)).length}</b><small>個我的收藏</small></div></div><section class="nearby-entry"><div><b>附近有甚麼？</b><small>100米・200米・500米，找到清單中的地點</small></div><button class="locate-button" data-locate>◎ 定位</button></section><div class="homegrid"><section><div class="sectionhead"><h2>旅程一覽</h2></div><div class="panel">${days.map((d) => `<a class="dayrow" href="#plan?day=${d.n}"><span class="daynum">D${d.n}</span><div><strong>${esc(d.region)}</strong><small>${esc(d.date)} · ${esc(d.weekday)}${d.hotel ? ` · ${esc(d.hotel)}` : ""}</small></div><span class="arrow">↗</span></a>`).join("")}</div></section><section><div class="sectionhead"><h2>隨手查一查</h2></div><div class="quicklinks"><a class="quick" href="#explore"><span class="ico">⌕</span><b>口袋地點</b><small>${places.length} 個地點</small></a><a class="quick" href="#shopping"><span class="ico">☑</span><b>購物清單</b><small>要買的東西</small></a><a class="quick" href="#flights"><span class="ico">✈</span><b>機票</b><small>${lists().flights.length} 個航班</small></a><a class="quick" href="#hotels"><span class="ico">▥</span><b>住宿</b><small>${hs.length} 間住宿</small></a></div></section></div>`;
  }
  // ---- 附近 (nearby places and shops within 100/200/500 m) ----
  let nearbyRequest = 0;
  const nearbyState = { position: null, accuracy: null, loading: false, error: "", radius: 200, category: "全部", mode: "gps" };
  function renderNearby() {
    const coordinates = window.TRIP_GEO?.places || {},
      coverage = places.filter((p) => (coordinates[p.id] || []).length).length;
    return `${header("NEAR ME", "看看附近，有甚麼？", "只找你已加入清單的地點 · 按直線距離由近至遠排序")}<section class="nearby-panel"><button class="locate-button" id="locateNow"${nearbyState.loading ? ' disabled aria-busy="true"' : ""}>${nearbyState.loading ? "正在取得位置…" : nearbyState.position ? "◎ 重新定位" : "◎ 定位看附近"}</button><button class="action map-pick-button" id="pickOnMap">📍 在地圖選位置</button><p class="nearby-help">手機定位：按下後請允許瀏覽器使用位置。你的位置只在這次網頁內計算，不會儲存或傳送到網站伺服器。</p><div class="chips" role="group" aria-label="附近距離範圍">${[100, 200, 500].map((r) => `<button class="chip ${nearbyState.radius === r ? "active" : ""}" data-radius="${r}" aria-pressed="${nearbyState.radius === r}">${r}米</button>`).join("")}</div><div class="chips" role="group" aria-label="附近地點分類">${["全部", ...exploreCats, "購物"].map((c) => `<button class="chip ${nearbyState.category === c ? "active" : ""}" data-near-category="${c}" aria-pressed="${nearbyState.category === c}">${c === "購物" ? "🛍 購物" : c}</button>`).join("")}</div>${nearbyState.category === "購物" ? '<p class="note">按購物清單中未買物品的「購買地點」定位。</p>' : ""}<div id="nearbyStatus" role="status" aria-live="polite">${nearbyState.error ? `<div class="notice nearby-error">${esc(nearbyState.error)}</div>` : nearbyState.loading ? "<p>定位中，請稍候…</p>" : nearbyState.position && nearbyState.mode === "manual" ? '<p class="note">📍 以地圖選取的位置為中心 · 距離並非從手機目前位置計算</p>' : nearbyState.position ? `<p class="note">已取得位置 · 定位精度約 ±${Math.ceil(nearbyState.accuracy)}米${nearbyState.accuracy > nearbyState.radius ? "；誤差大於所選範圍，建議到室外重新定位或選較大範圍。" : ""}</p>` : '<p class="note">尚未選取位置。選擇範圍後，可用手機定位或在地圖選位置。</p>'}</div></section><div id="nearbyResults"></div><p class="note">距離為直線估算，並非步行路程；樓層、入口及河道可能影響實際路程。已建立座標 ${coverage}/${places.length} 個地點；未有可靠座標的項目暫不納入附近結果。</p><p class="note">座標來源：店方／場地地圖及公開地點資料。<button class="action" id="nearbyCoverage">查看座標覆蓋情況</button></p>`;
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
    target.innerHTML = `<div class="resultsbar"><span>${nearbyState.radius}米內 · ${rs.length} 個已加入地點</span></div>${rs.length ? `<div class="cardgrid">${rs.map((r) => placeCard(r.place, r)).join("")}</div>` : `<div class="empty"><h2>這個範圍內暫時沒有符合的地點</h2><p>可試試較大範圍、其他分類，或重新定位。</p><a class="action" href="#explore">查看全部地點 →</a></div>`}`;
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
              return `<article class="card place"><div class="place-top"><span class="badge shop">購物</span></div><h3>${esc(s.name)}</h3><div class="distance-badge">距離約 ${Math.round(s.distance)} 米</div><p class="buy-here">🛍 可買：${s.items.map(esc).join("、")}</p>${s.address ? `<p class="note">${esc(s.address)}</p>` : ""}<div class="actions">${p ? `<button class="action primary" data-place="${esc(p.id)}">店舖資料</button>` : ""}${link(route(p ? `${p.v[1]} ${p.v[3]}` : s.address), "導航")}</div></article>`;
            })
            .join("")}</div>`
        : '<div class="empty"><h2>這個範圍內暫時沒有可買清單物品的地方</h2><p>購物清單中未買、而且有「購買地點」的物品才會顯示。可試試較大範圍。</p><a class="action" href="#shopping">查看購物清單 →</a></div>'
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
      `<div class="eyebrow">LOCATION COVERAGE</div><h2 class="detailtitle">座標覆蓋情況</h2><p>已建立 ${places.length - missing.length}/${places.length} 個地點座標。範圍較大的景點以標示位置計算；沒有可靠位置的項目不以區域中心代替。</p>${missing.length ? `<h3>尚未納入附近結果</h3><ul>${missing.map((p) => `<li>${esc(p.v[1])}</li>`).join("")}</ul>` : "<p>所有清單地點均已建立座標。</p>"}`,
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
    return `${header("POCKET PLACES", "把喜歡的地方，收好。", "旅伴加入的地點 · 按「＋ 新增地點」貼上 Google 地圖連結")}<div class="nearby-inline"><a class="action primary" href="#nearby">◎ 查看附近地點（100／200／500米）</a><button class="action" data-place-new>＋ 新增地點</button></div><div class="controls"><div class="searchrow"><input id="search" class="search" type="search" placeholder="搜尋店名、美食、地址…" aria-label="搜尋地點" value="${esc(search)}"><select id="region" aria-label="選擇區域或小區">${regionOptions()}</select></div><div class="chips">${["全部", ...exploreCats].map((c) => `<button class="chip ${category === c ? "active" : ""}" data-cat="${c}">${c}</button>`).join("")}<button class="chip ${category === "購物清單" ? "active" : ""}" data-cat="購物清單">🛍 購物清單</button><button class="chip ${onlySaved ? "active" : ""}" id="savedToggle">☆ 我的收藏</button></div></div><div id="results"></div>`;
  }
  // 🛍 購物清單 also lists 購買地點 that are not explore places yet, with 加入探索 to make them one.
  let buySpots = [];
  const spotCard = (s, k) =>
    `<article class="card place shop-spot"><div class="place-top"><span class="badge shop">購物清單</span></div><h3>${esc(s.name)}</h3>${s.address && s.address !== s.name ? `<div class="region">${esc(s.address)}</div>` : ""}<p class="buy-here">🛍 要買：${s.items.map((n, i) => `<button type="button" class="buy-item" data-shop-open="${esc(s.ids[i])}">${esc(n)}</button>`).join("、")}</p><div class="actions"><button class="action primary" data-spot-explore="${k}">＋ 加入探索</button>${link(Number.isFinite(s.lat) ? `https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lng}` : maps(s.address || s.name), "地圖")}</div></article>`;
  function renderResults() {
    let q = search.toLocaleLowerCase();
    const ps = places.filter(
      (p) =>
        inCategory(p) && inRegion(p) && (!onlySaved || saved.has(p.id)) && (!q || p.v.join(" ").toLocaleLowerCase().includes(q)),
    );
    buySpots =
      category === "購物清單" && region === "全部區域" && !onlySaved
        ? (window.Together?.shoppingPlaces?.() || []).filter(
            (s) => !s.placeId && (!q || `${s.name} ${s.address} ${s.items.join(" ")}`.toLocaleLowerCase().includes(q)),
          )
        : [];
    const extra = buySpots.length
      ? `<div class="sectionhead"><h2>未在探索清單的購買地點（${buySpots.length}）</h2></div><div class="cardgrid">${buySpots.map(spotCard).join("")}</div>`
      : "";
    $("#results").innerHTML =
      `<div class="resultsbar"><span>${ps.length} 個地點${onlySaved ? " · 我的收藏" : ""}${buySpots.length ? ` · 另有 ${buySpots.length} 個購買地點` : ""}</span><button class="smallbtn" id="resetFilters">重設篩選</button></div><div class="cardgrid">${ps.map((p) => placeCard(p)).join("")}</div>${extra}${ps.length || buySpots.length ? "" : `<div class="empty"><h2>暫時沒有符合的地點</h2><p>${onlySaved ? "按地點卡上的 ☆，建立這部手機的收藏。" : "試試其他關鍵字，或清除篩選。"}</p></div>`}`;
  }
  // Shopping list items bought at a place (unbought first), shown on explore cards, place details and plan stops.
  const buysAt = (q) => [...(window.Together?.shoppingAt?.(q) || [])].sort((a, b) => a.bought - b.bought);
  const buyLine = (items) => {
    const todo = items.filter((x) => !x.bought);
    return todo.length
      ? `<p class="buy-here">🛍 要買：${todo.map((x) => `<button type="button" class="buy-item" data-shop-open="${esc(x.id)}">${esc(x.name)}</button>`).join("、")}</p>`
      : "";
  };
  function shoppingChanged() {
    if (current === "plan") refreshPlan();
    else if (current === "explore" && $("#results")) renderResults();
    else if (current === "notebook" && $("#notebookResults")) notebookResults();
  }
  function placeCard(p, near) {
    const c0 = p.cats.find((x) => x !== "手信") || p.cats[0] || p.v[6],
      c = c0 === "手信" ? "手信店" : c0;
    return `<article class="card place"><div class="place-top"><span class="badge ${{ 餐廳: "food", 景點: "sights", 商店: "shop", 手信店: "gift" }[c] || ""}">${esc(c)}</span><button class="save ${saved.has(p.id) ? "saved" : ""}" data-save="${p.id}" aria-label="${saved.has(p.id) ? "取消收藏" : "收藏"} ${esc(p.v[1])}" aria-pressed="${saved.has(p.id)}">${saved.has(p.id) ? "★" : "☆"}</button></div><h3>${esc(p.v[1])}</h3>${near && typeof near === "object" ? `<div class="distance-badge">距離約 ${Math.round(near.distance)} 米${near.point.label ? " · " + esc(near.point.label) : ""}</div>` : ""}<div class="region" title="${esc(p.v[0])}">${esc(areaOf(p) || p.v[0])}</div>${p.v[9]?.includes("已閉店") ? '<div class="closed">已結業 · 保留原有記錄</div>' : ""}<p class="feature">${esc(p.v[4])}</p>${p.v[5] ? `<p class="hours">${esc(p.v[5])}</p>` : ""}${buyLine(buysAt({ placeId: p.id }))}<div class="actions"><button class="action primary" data-place="${p.id}">詳細資料</button>${link(maps(p.v[1] + " " + p.v[3]), "地圖")}</div></article>`;
  }
  function placeDetail(id) {
    const p = places.find((p) => p.id === id);
    if (!p) return;
    const fields = [
      [3, "地址／位置"],
      [4, "必吃・必買・特色"],
      [5, "參考價格與營業時間"],
      [11, "備註與預約"],
      [9, "核對狀態"],
    ];
    openDialog(
      `<div class="eyebrow">${esc(p.v[0])}</div><h2 class="detailtitle">${esc(p.v[1])}</h2><div class="links place-admin"><button class="action primary" data-place-plan="${esc(p.id)}">＋ 加入行程</button><button class="action" data-place-edit="${esc(p.id)}">✎ 編輯</button><button class="action" data-place-delete="${esc(p.id)}">刪除</button></div><div class="links">${link(maps(p.v[1] + " " + p.v[3]), "Google 地圖")}${link(route(p.v[1] + " " + p.v[3]), "從目前位置前往")}<button class="action" data-copy="${esc(p.v[3] || p.v[1])}">複製地址</button></div>${fields
        .filter(([i]) => p.v[i])
        .map(([i, label]) => `<section class="detail-section"><h3>${label}</h3><p>${esc(p.v[i])}</p></section>`)
        .join("")}<section class="detail-section"><h3>影片與參考來源</h3><div class="links">${urlList(p.v[8])
        .map((u, i) => link(u, "影片 " + (i + 1)))
        .join("")}${urlList(p.v[10])
        .map((u, i) => link(u, "參考網站 " + (i + 1)))
        .join(
          "",
        )}</div><p class="note">${esc(p.v[7])}</p></section>${(window.TRIP_GEO.places[p.id] || []).length > 1 ? `<section class="detail-section"><h3>分店／地址（${window.TRIP_GEO.places[p.id].length}）</h3><div class="links">${window.TRIP_GEO.places[p.id].map((g, k) => link(`https://www.google.com/maps/search/?api=1&query=${g.lat},${g.lng}`, g.label || (k ? `分店 ${k + 1}` : p.v[1]))).join("")}</div></section>` : ""}${((b) => (b.length ? `<section class="detail-section"><h3>🛍 購物清單（${b.length}）</h3><div class="links">${b.map((x) => `<button class="action${x.bought ? " bought" : ""}" data-shop-open="${esc(x.id)}">${x.bought ? "✓ " : ""}${esc(x.name)}</button>`).join("")}</div></section>` : ""))(buysAt({ placeId: p.id }))}<section class="tg-slot" data-tg-place="${esc(p.id)}"></section>`,
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
        return { id: "u_" + o.id, overlayId: o.id, custom: true, v: c.fields, cats: c.cats };
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
    `<div class="branch-row"><input name="bLabel" maxlength="60" placeholder="分店名稱" aria-label="分店名稱" value="${esc(b.label || "")}"><span class="searchrow"><input name="bUrl" class="search" inputmode="url" autocomplete="off" placeholder="Google 地圖連結" aria-label="分店 Google 地圖連結"><button type="button" class="smallbtn" data-branch-find>定位</button></span><small class="branch-at">${Number.isFinite(b.lat) ? "📍 已定位" : "未定位"}</small><input type="hidden" name="bLat" value="${b.lat ?? ""}"><input type="hidden" name="bLng" value="${b.lng ?? ""}"><button type="button" class="smallbtn" data-branch-del aria-label="移除分店">×</button></div>`;
  // plan={day,slot}: 行程「＋ 新增站點」 uses the same form, adds a time, and also saves the place to 探索.
  function placeForm(p, plan = null) {
    const v = (i) => esc(p?.v[i] || ""),
      pins = p ? window.TRIP_GEO.places[p.id] || [] : [],
      pin = pins[0],
      alt = plan && plan.slot != null ? stopsFor(plan.day)[plan.slot] : null;
    openDialog(
      `<div class="eyebrow">${plan ? `ADD TO DAY ${plan.day}` : p ? "EDIT PLACE" : "NEW PLACE"}</div><h2 class="detailtitle">${plan ? (alt ? "加入同一時間的選擇" : "新增站點") : p ? "修改地點" : "新增地點"}</h2>${plan ? `<p class="note">${alt ? `與「${esc(alt.title)}」同在 ${esc(alt.time || "這個時段")}。` : `${esc(days[plan.day - 1].date)} · ${esc(days[plan.day - 1].region)}。`}地點會同時加入「探索」。</p>` : ""}<form class="tg-form" id="placeForm" data-id="${p ? esc(p.id) : ""}"${plan ? ` data-day="${plan.day}" data-slot="${plan.slot ?? ""}"` : ""}>${plan && !alt ? '<label>時間（可留空，留空會放在最後）<input name="time" maxlength="30" placeholder="例如：12:00–13:00"></label>' : ""}<label>Google 地圖連結<span class="searchrow"><input name="mapsUrl" class="search" inputmode="url" autocomplete="off" placeholder="貼上 Google 地圖分享連結"><button type="button" class="action primary" id="placeLookup">自動填寫</button></span></label><p class="note" id="placeLookupInfo">在 Google 地圖按「分享」→ 複製連結，貼上後按「自動填寫」。只會填入空白欄位。</p><label>名稱<input name="f1" required maxlength="80" value="${v(1)}"></label><fieldset><legend>分類</legend>${categories.map((c) => `<label class="tg-check"><input type="checkbox" name="cats" value="${c}"${p?.cats.includes(c) ? " checked" : ""}> ${c}</label>`).join("")}</fieldset><label>區域<input name="f0" list="placeRegions" maxlength="60" required value="${v(0)}"><datalist id="placeRegions">${[...new Set(places.map((x) => x.v[0]).filter(Boolean))].map((r) => `<option value="${esc(r)}">`).join("")}</datalist></label>${placeFields.map(([i, label, max]) => `<label>${label}${max > 200 ? `<textarea name="f${i}" rows="3" maxlength="${max}">${v(i)}</textarea>` : `<input name="f${i}" maxlength="${max}" value="${v(i)}">`}</label>`).join("")}<input type="hidden" name="lat" value="${pin ? pin.lat : ""}"><input type="hidden" name="lng" value="${pin ? pin.lng : ""}"><input type="hidden" name="mainLabel" value="${esc(pin?.label || "")}"><fieldset class="branches"><legend>其他分店／地址</legend><div id="branchRows">${pins.slice(1).map(branchRow).join("")}</div><button type="button" class="smallbtn" data-branch-add>＋ 加入分店／地址</button><p class="note">每個分店貼上 Google 地圖連結後按「定位」。附近頁會用最近的分店計算距離。</p></fieldset><button type="submit" class="locate-button">${plan ? "加入行程及探索" : p ? "儲存修改" : "加入地點"}</button></form>`,
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
      at.textContent = "📍 " + (r.address || "已定位");
    } catch (e) {
      at.textContent =
        String(e?.code || "").startsWith("functions/") && e.message ? e.message.replace(/\s*\[\d+\]$/, "") : "未能定位";
    }
  }
  async function lookupPlaceForm() {
    const f = $("#placeForm"),
      btn = $("#placeLookup"),
      info = $("#placeLookupInfo"),
      el = f.elements,
      url = el.mapsUrl.value.trim();
    if (!url) return toast("請先貼上 Google 地圖連結。");
    btn.disabled = true;
    info.textContent = "正在查詢 Google 地圖…";
    try {
      const r = await window.Together.lookupPlace(url),
        put = (name, value) => {
          if (value && !el[name].value.trim()) el[name].value = value;
        };
      put("f1", r.name);
      put("f2", r.type);
      put("f3", r.address);
      put("f5", [r.price && "價格：" + r.price, r.hours && "時間：\n" + r.hours].filter(Boolean).join("\n"));
      put("f10", [r.website, r.mapsUrl].filter(Boolean).join("\n"));
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
      info.textContent = "已填入，請檢查後按儲存。";
    } catch (e) {
      info.textContent =
        String(e?.code || "").startsWith("functions/") && e.message
          ? e.message.replace(/\s*\[\d+\]$/, "")
          : "未能自動填寫，請手動輸入。";
      console.error(e);
    } finally {
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
    });
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
  // ---- 行程 (plan): day stops, the stop form and the in-page place picker ----
  // Each day's plan lives in Firestore planDays/{day}: the stop list and the day's title.
  let planEdits = {},
    openStop = null;
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
      `<div class="eyebrow">${esc(days[day - 1].date)} · DAY ${day}</div><h2 class="detailtitle">修改站點</h2><form class="tg-form" id="stopForm" data-day="${day}" data-index="${index}">${own ? `<label>Google 地圖連結<span class="searchrow"><input name="mapsUrl" class="search" inputmode="url" autocomplete="off" placeholder="貼上 Google 地圖分享連結"><button type="button" class="action primary" id="stopLookup">自動填寫</button></span></label><p class="note" id="stopLookupInfo">在 Google 地圖按「分享」→ 複製連結，貼上後按「自動填寫」。只會填入空白欄位。</p>` : `<div class="notice">「${esc(s.title)}」的名稱、地址及介紹跟隨${s.linked === "place" ? "探索地點" : "住宿資料"}，修改後所有行程會一併更新。<div class="links">${s.linked === "place" ? `<button type="button" class="action" data-place-edit="${esc(s.placeId)}">✎ 修改地點資料</button>` : `<button type="button" class="action" data-hotel-edit="${esc(s.hotelId)}">✎ 修改住宿資料</button>`}</div></div>`}<div class="tg-row"><label>時間<input name="time" maxlength="30" placeholder="例如：14:00–15:30" value="${v("time")}"></label>${own ? `<label>區域<input name="area" maxlength="60" value="${v("area")}"></label>` : ""}</div>${own ? `<label>地點／活動<input name="title" required maxlength="80" value="${v("title")}"></label><label>內容<textarea name="detail" rows="3" maxlength="1000">${v("detail")}</textarea></label>` : ""}<label>交通<textarea name="transport" rows="2" maxlength="500">${v("transport")}</textarea></label>${own ? `<label>導航目的地（可留空）<input name="target" maxlength="200" value="${v("target")}"></label>` : ""}<button type="submit" class="locate-button">儲存修改</button></form>`,
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
        String(e?.code || "").startsWith("functions/") && e.message
          ? e.message.replace(/\s*\[\d+\]$/, "")
          : "未能自動填寫，請手動輸入。";
      console.error(e);
    } finally {
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
    const stop = { ...old, time: get("time"), transport: get("transport") };
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
      `<div class="eyebrow">ADD TO PLAN</div><h2 class="detailtitle">把「${esc(p.v[1])}」加入行程</h2><form class="tg-form" id="placeToPlan" data-place="${esc(p.id)}"><label>日子<select name="day">${days.map((d) => `<option value="${d.n}"${d.n === sel ? " selected" : ""}>D${d.n} ${esc(d.date)} ${esc(d.region)}</option>`).join("")}</select></label><label>時間（可留空，留空會放在最後）<input name="time" maxlength="30" placeholder="例如：12:00–13:00"></label><button type="submit" class="locate-button">加入行程</button></form>`,
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
  function pickPlaceForPlan(day, slot = null) {
    ppCat = "全部";
    const s = slot != null ? stopsFor(day)[slot] : null;
    openDialog(
      `<div class="eyebrow">ADD TO DAY ${day}</div><h2 class="detailtitle">${s ? "加入同一時間的選擇" : "從探索加入地點"}</h2><p class="note">${s ? `與「${esc(s.title)}」同在 ${esc(s.time || "這個時段")}` : `${esc(days[day - 1].date)} · ${esc(days[day - 1].region)}`}</p>${s ? `<button class="action" data-stop-own="${slot}">✎ 自己輸入</button>` : ""}<div class="tg-form plan-pick"><input id="ppSearch" class="search" type="search" placeholder="搜尋地點、區域、特色…" aria-label="搜尋地點"><div class="chips" role="group" aria-label="分類">${["全部", ...(lists().hotels.length ? ["住宿"] : []), ...(window.Together?.shoppingPlaces?.().length ? ["購物清單"] : []), ...exploreCats].map((c) => `<button class="chip ${c === ppCat ? "active" : ""}" data-pp-cat="${c}">${c}</button>`).join("")}</div>${s ? "" : '<label>時間（可留空，留空會放在最後）<input id="ppTime" maxlength="30" placeholder="例如：12:00–13:00"></label>'}</div><div id="ppList" class="pp-list" data-day="${day}" data-slot="${slot ?? ""}"></div>`,
    );
    ppResults();
  }
  function ppResults() {
    const box = $("#ppList");
    if (!box) return;
    const day = Number(box.dataset.day),
      q = ($("#ppSearch")?.value || "").trim().toLocaleLowerCase(),
      inPlan = new Set(
        stopsFor(day)
          .map((s) => s.placeId)
          .filter(Boolean),
      );
    const hs =
        ["全部", "住宿"].includes(ppCat)
          ? [...lists().hotels]
              .filter((h) => !q || `${h.name} ${h.address}`.toLocaleLowerCase().includes(q))
              .sort((a, b) => String(a.checkIn).localeCompare(String(b.checkIn)))
          : [],
      hotelIn = stopsFor(day).reduce((m, s) => (s.hotelId ? m.set(s.hotelId, (m.get(s.hotelId) || 0) + 1) : m), new Map());
    const ps = ["住宿", "購物清單"].includes(ppCat)
      ? []
      : places
          .filter(
            (p) =>
              (ppCat === "全部" || p.cats.includes(ppCat) || (ppCat === "商店" && giftShop(p))) &&
              (!q || [p.v[1], p.v[0], areaOf(p), p.v[4], p.v[2]].join(" ").toLocaleLowerCase().includes(q)),
          )
          .sort((a, b) => saved.has(b.id) - saved.has(a.id));
    const hotelRows = hs
      .map(
        (h) =>
          `<div class="pp-row"><div><b>🏨 ${esc(h.name)}</b><small>${h.checkIn ? `${esc(h.checkIn.slice(5))} → ${esc((h.checkOut || "").slice(5))}` : "住宿"}${h.address ? ` · ${esc(h.address.slice(0, 40))}` : ""}</small></div>${hotelIn.get(h.id) ? `<span class="badge">✓ ${hotelIn.get(h.id)} 次</span>` : ""}<button class="action primary" data-pp-hotel="${esc(h.id)}">＋ 加入</button></div>`,
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
          `<div class="pp-row"><div><b>🛍 ${esc(s.name)}</b><small>要買：${s.items.map(esc).join("、")}</small></div>${s.placeId && inPlan.has(s.placeId) ? '<span class="badge">✓ 已加入</span>' : `<button class="action primary" data-pp-spot="${k}">＋ 加入</button>`}</div>`,
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
            `<div class="pp-row"><div><b>${saved.has(p.id) ? "★ " : ""}${esc(p.v[1])}</b><small>${esc(areaOf(p) || p.v[0])}${p.v[4] ? ` · ${esc(p.v[4].slice(0, 40))}` : ""}</small></div>${inPlan.has(p.id) ? '<span class="badge">✓ 已加入</span>' : `<button class="action primary" data-pp-add="${esc(p.id)}">＋ 加入</button>`}</div>`,
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
  function renderPlanDay(day) {
    const d = days[day - 1],
      edit = planEdits[day],
      stops = stopsFor(day),
      last = stops.length - 1;
    return `<div class="dayintro"><div><div class="eyebrow">${esc(d.date)} · ${esc(d.weekday)}</div><h2>${esc(d.region)}</h2><p class="weather" data-weather="${day}" hidden></p></div><div class="links"><button class="action" data-day-label>✎ 這天標題</button><a href="#hotels" class="action">查看酒店 ↗</a></div></div><div class="notice">${edit?.stops?.length ? "旅伴安排的行程，修改即時同步。" : "這天還未安排，按「＋ 新增站點」或「⌕ 從探索加入地點」。"}<br>住宿：${esc(d.hotel || "未設定")}</div><div class="plan-tools"><button class="action primary" data-stop-new>＋ 新增站點</button><button class="action" data-plan-pick>⌕ 從探索加入地點</button>${routeStops(day).length ? '<button class="action" data-day-map>🗺 當天路線</button>' : ""}<button class="action" data-plan-print>🖨 列印／PDF</button>${edit?.stops?.length ? '<button class="action" data-plan-reset>清空這天</button>' : ""}</div><div class="timeline">${
      stopGroups(stops)
        .map(
          (g, n, all) =>
            `${n || hotelLink() ? stopLink(all, n) : ""}<article class="stop${g.length > 1 ? " stop-group" : ""}"><div class="time">${esc(g[0].s.time)}${g.length > 1 ? `<small class="alt-count">${g.length} 個選擇</small>` : ""}</div><div class="stop-alts">${g
              .map(
                ({ s, i }, k) =>
                  `<div class="stopcontent"><button class="stop-more${openStop === i ? " active" : ""}" data-stop-more="${i}" aria-label="編輯這個站點" aria-expanded="${openStop === i}">⋯</button><span class="eyebrow">${String(n + 1).padStart(2, "0")}${g.length > 1 ? String.fromCharCode(97 + k) : ""} / ${esc(s.area)}</span><h3>${esc(s.title)}</h3><p>${esc(s.detail)}</p>${buyLine(buysAt({ placeId: s.placeId, title: s.hotelId ? "" : s.title }))}${n === 0 && !hotelLink() && s.transport ? `<p class="transport">↳ ${esc(s.transport)}</p>` : ""}<div class="links">${s.placeId && places.some((p) => p.id === s.placeId) ? `<button class="action" data-place="${esc(s.placeId)}">地點資料</button>` : ""}${s.hotelId ? '<a class="action" href="#hotels">住宿資料</a>' : ""}${s.target ? link(route(s.target), "導航") : ""}${urlList(
                    s.ref,
                  )
                    .map((u) => link(u, "參考網站"))
                    .join(
                      "",
                    )}</div>${openStop === i ? `<div class="stop-edit"><button class="smallbtn" data-stop-move="${i}:-1"${i ? "" : " disabled"} aria-label="上移">↑</button><button class="smallbtn" data-stop-move="${i}:1"${i < last ? "" : " disabled"} aria-label="下移">↓</button><button class="smallbtn" data-stop-edit="${i}">✎ 修改</button><button class="smallbtn" data-stop-delete="${i}">刪除</button><button class="smallbtn" data-stop-alt="${i}">＋ 加入</button></div>` : ""}</div>`,
              )
              .join("")}</div></article>`,
        )
        .join("") || '<div class="empty"><h2>這天還沒有行程</h2><p>按「＋ 新增站點」或「⌕ 從探索加入地點」。</p></div>'
    }</div><section class="tg-slot" data-tg-day="${day}"></section>`;
  }
  function renderPlan() {
    return `${header("DAY BY DAY", "跟著酒店，順路出發。", "選擇日期查看當天行程")}<div class="daytabs" aria-label="選擇行程日期">${days.map((d) => `<button class="daytab ${d.n === selectedDay ? "active" : ""}" data-day="${d.n}" aria-pressed="${d.n === selectedDay}"><b>DAY ${d.n}</b><span>${esc(d.date)} · ${esc(d.weekday)}</span><em class="day-region" title="${esc(d.region)}">${esc(d.region)}</em><small class="weather-tab" data-weather-tab="${d.n}"></small></button>`).join("")}</div><article class="journey-day" aria-label="第${selectedDay}天行程">${renderPlanDay(selectedDay)}</article>`;
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
     return `<section class="print-day"><h2>DAY ${d.n} · ${esc(d.date)} ${esc(d.weekday)} · ${esc(d.region)}</h2>${d.hotel ? `<p class="print-sub">住宿：${esc(d.hotel)}</p>` : ""}${stops.length ? `<table><tbody>${stops.map((s) => `<tr><td class="print-time">${esc(s.time)}</td><td><b>${esc(s.title)}</b>${s.detail ? `<div>${esc(s.detail)}</div>` : ""}${s.transport ? `<div class="print-sub">↳ ${esc(s.transport)}</div>` : ""}</td></tr>`).join("")}</tbody></table>` : '<p class="print-sub">未安排</p>'}</section>`;
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
    const lines = next.filter(({ s }) => s.transport).map(({ s }, k) => `${multi ? `${esc(s.title)}：` : ""}${esc(s.transport)}`);
    return `<div class="stop-link"><div></div><button type="button" class="route-dot${lines.length ? " has-route" : ""}" data-route-link="${n}" aria-label="${prev ? esc(prev[0].s.title) : "酒店"} 至 ${esc(next[0].s.title)} 的交通"><i aria-hidden="true"></i><span>${lines.length ? lines.join("<br>") : prev ? "🚃 查交通" : "🏨 由酒店出發 · 查交通"}</span></button></div>`;
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
      `<div class="eyebrow">GETTING THERE · DAY ${day}</div><h2 class="detailtitle" id="routeTitle">前往 ${esc(to.title)}</h2>${dests.length > 1 ? `<div class="tg-form route-form"><label>目的地（同一時間有 ${dests.length} 個選擇）<select id="routeTo">${dests.map((k) => `<option value="${k}"${k === i ? " selected" : ""}>${esc(list[k].title)}</option>`).join("")}</select></label></div>` : ""}${
        origins.length
          ? `<div class="tg-form route-form"><label>出發地<select id="routeFrom">${origins.map((o) => `<option value="${esc(o.key)}"${o.key === def ? " selected" : ""}>${esc(o.label)}</option>`).join("")}</select></label><div class="tg-row"><label>出發時間<input id="routeTime" type="time" value="${esc(start || "09:00")}"></label><label>方式<select id="routeMode">${Object.entries(
              ROUTE_MODES,
            )
              .map(([k, [v]]) => `<option value="${k}">${v}</option>`)
              .join(
                "",
              )}</select></label></div><button type="button" class="locate-button" id="routeGo">查詢路線建議</button></div><div id="routeResults" class="route-results"></div><div id="routeAi" class="route-results"></div>`
          : '<p class="note">這天前面沒有站點，亦未有住宿資料，未能查詢路線；可以自行填寫。</p>'
      }<form class="tg-form" id="routeManual"><label>交通（可自行修改）<textarea name="transport" rows="3" maxlength="500" placeholder="例如：地下鐵空港線 博多 → 天神，約 5 分">${esc(to.transport || "")}</textarea></label><button type="submit" class="action primary">儲存交通</button></form>`,
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
    const gmLink = `<a class="action" href="${gm}" target="_blank" rel="noopener">在 Google 地圖查看 ↗</a><button type="button" class="action primary" data-route-ai>✨ AI 分析</button>`;
    c.ai = { from, to, dest, time };
    if (mode === "TRANSIT" && meta.country === "JP") {
      box.innerHTML = `<div class="notice">Google 不向其他網站提供日本的公共交通路線，只可以在 Google 地圖 App 內查看。請按下面按鈕查看，揀好路線後在下面「交通」填寫；步行和駕車可以直接在這裡查詢。</div><div class="links">${gmLink}</div>`;
      return;
    }
    box.innerHTML = '<p class="note">正在查詢 Google 地圖…</p>';
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
        ? `${r.estimated ? '<p class="note">行程日期太遠或已過，班次按下一個相同星期的時間估算，出發前請再確認。</p>' : ""}${r.options.map((o, k) => `<div class="route-option"><div class="route-head"><b>約 ${o.minutes} 分</b>${o.fare ? `<span>${esc(fareText(o))}</span>` : ""}${mode === "TRANSIT" && o.steps.find((s) => s.mode === "TRANSIT") ? `<span>${esc(o.steps.find((s) => s.mode === "TRANSIT").depart)} 開出</span>` : ""}</div><ol class="route-steps">${mode === "TRANSIT" ? o.steps.map((s) => (s.mode === "TRANSIT" ? `<li><b>${VEHICLE_ICON[s.vehicle] || "🚉"} ${esc(s.line)}</b>${s.headsign ? ` <small>往 ${esc(s.headsign)}</small>` : ""}<div>${esc(s.from)} → ${esc(s.to)}${s.stops ? ` · ${s.stops} 站` : ""} · ${esc(s.depart)}–${esc(s.arrive)}</div></li>` : `<li>🚶 步行 ${s.minutes} 分</li>`)).join("") : `<li>${esc(routeText(o, mode))}</li>`}</ol><button type="button" class="action primary" data-route-pick="${k}">選用這個</button></div>`).join("")}<div class="links">${gmLink}</div>`
        : `<p class="note">Google 地圖找不到${ROUTE_MODES[mode][0]}路線。</p><div class="links">${gmLink}</div>`;
    } catch (e) {
      box.innerHTML = `<p class="note">${esc(String(e?.code || "").startsWith("functions/") && e.message ? e.message.replace(/\s*\[\d+\]$/, "") : "未能查詢路線，請檢查網絡後再試。")}</p><div class="links">${gmLink}</div>`;
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
    box.innerHTML = '<div class="route-ai-wait"><b>✨ AI 正在考慮路線…</b><p class="note">大約需要 10–30 秒。</p></div>';
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
        ? `<div class="route-ai-head"><b>✨ AI 建議</b>${r.advice ? `<p>${esc(r.advice)}</p>` : ""}<p class="note">由 AI 按一般情況估算，班次、時間及車費可能不準，出發前請用 Google 地圖或車站資料確認。</p></div>${r.options.map((o, k) => `<div class="route-option ai"><div class="route-head"><b>${esc(o.title || `方案 ${k + 1}`)}</b><span>約 ${o.minutes} 分</span>${o.fare ? `<span>${esc(fareText(o))}</span>` : ""}</div><ol class="route-steps">${o.steps.map((s) => `<li>${esc(aiStep(s))}</li>`).join("")}</ol>${o.note ? `<p class="note">${esc(o.note)}</p>` : ""}<button type="button" class="action primary" data-route-ai-pick="${k}">選用這個</button></div>`).join("")}`
        : '<p class="note">AI 未能提供路線建議。</p>';
    } catch (e) {
      box.innerHTML = `<p class="note">${esc(String(e?.code || "").startsWith("functions/") && e.message ? e.message.replace(/\s*\[\d+\]$/, "") : "未能進行 AI 分析，請檢查網絡後再試。")}</p>`;
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
        region: "購物清單",
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
        type: "筆記",
        types: ["筆記"],
        title: String(n.text || "")
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
    return `${header("TRAVEL NOTEBOOK", "完整資料簿", "搜尋全部旅遊資料，或按分類及區域快速找。")}<div class="notebook-shortcuts"><a href="#plan">☷ 每日行程</a><a href="#flights">✈ 航班與行李</a><a href="#hotels">▥ 酒店住宿</a><a href="#shopping">☑ 購物清單</a><a href="#together">✎ 筆記</a></div><div class="controls notebook-controls"><div class="searchrow"><input id="notebookSearch" class="search" type="search" aria-label="搜尋完整資料簿" placeholder="輸入店名、菜式、酒店、航班或日期…" value="${esc(notebookSearch)}"><select id="notebookRegion" aria-label="資料簿區域"><option>全部區域</option>${[...new Set(notebookRecords().map(notebookArea))].map((r) => `<option${r === notebookRegion ? " selected" : ""}>${esc(r)}</option>`).join("")}</select></div><div class="chips">${["全部", "餐廳", "景點", "商店", "行程", "酒店", "機票", "購物", "筆記"].map((t) => `<button class="chip ${t === notebookType ? "active" : ""}" data-notebook-type="${t}" aria-pressed="${t === notebookType}">${t}</button>`).join("")}</div></div><div id="notebookResults"></div><div class="sourcefooter">資料由旅伴在網站內輸入，所有旅伴即時同步。</div>`;
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
      `<div class="resultsbar"><span>找到 ${rs.length} 項${notebookSearch ? " ·「" + esc(notebookSearch) + "」" : ""}</span><button id="notebookReset" class="smallbtn">清除篩選</button></div><div class="notebook-list">${rs.map((r) => `<article class="notebook-card"><div class="notebook-meta"><span class="badge">${esc(r.type)}</span><span>${esc(r.region)}</span></div><h2>${esc(r.title)}</h2><p class="notebook-summary">${esc(r.summary)}</p>${r.sub ? `<p class="notebook-sub">${esc(r.sub)}</p>` : ""}<div class="notebook-bottom"><small>${esc(r.source)}</small><button class="action primary" data-notebook-record="${r.id}">查看詳情 →</button></div></article>`).join("")}</div>${rs.length ? "" : '<div class="empty"><h2>找不到符合的資料</h2><p>試用較短的店名、菜式或日期，或按「清除篩選」。</p></div>'}`;
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
      `<div class="eyebrow">${esc(r.type)} · ${esc(r.source)}</div><h2 class="detailtitle">${esc(r.title)}</h2>${(r.fields || [])
        .filter((f) => f[1])
        .map((f) => `<section class="detail-section"><h3>${esc(f[0])}</h3><p>${esc(f[1])}</p></section>`)
        .join(
          "",
        )}<div class="links">${r.day ? `<a class="action primary" href="#plan?day=${r.day}">在行程查看</a>` : ""}${r.placeId && places.some((p) => p.id === r.placeId) ? `<button class="action" data-place="${esc(r.placeId)}">地點資料</button>` : ""}${r.target ? link(route(r.target), "導航") : ""}${(r.urls || []).map((u, i) => link(u, "參考網站 " + (i + 1))).join("")}</div>`,
    );
  }
  // ---- 住宿 and 機票 (hotels and flights) ----
  function renderHotels() {
    const hs = [...lists().hotels].sort((a, b) => String(a.checkIn).localeCompare(String(b.checkIn)));
    return `${header("STAY & REST", "每一天，都有回去的地方。", "貼上 Google 地圖連結即可自動填寫酒店資料")}<div class="links"><button class="action primary" data-hotel-new>＋ 新增住宿</button></div>${hs.length ? `<div class="twocol">${hs.map((h) => `<article class="card hotel"><span class="hotelnum">${esc(h.checkIn || "?")} → ${esc(h.checkOut || "?")}</span><h2>${esc(h.name)}</h2>${nights(h) > 0 ? `<div class="badge">${nights(h)} 晚</div>` : ""}<dl class="kv">${h.address ? `<dt>地址</dt><dd>${esc(h.address)}</dd>` : ""}${h.note ? `<dt>備註</dt><dd>${esc(h.note)}</dd>` : ""}</dl><div class="links">${link(route(`${h.name} ${h.address}`.trim()), "導航")}${h.mapsUrl ? link(h.mapsUrl, "Google 地圖") : ""}<button class="smallbtn" data-docs="hotels:${esc(h.id)}">📎 文件${h.docs?.length ? `（${h.docs.length}）` : ""}</button><button class="smallbtn" data-hotel-edit="${esc(h.id)}">編輯</button><button class="smallbtn" data-hotel-del="${esc(h.id)}">刪除</button></div></article>`).join("")}</div>` : '<div class="empty"><h2>還沒有住宿</h2><p>按「＋ 新增住宿」，貼上酒店的 Google 地圖連結。</p></div>'}<div class="sectionhead"><h2>每晚住宿</h2></div><div class="panel">${days.map((d) => `<a class="dayrow" href="#plan?day=${d.n}"><span class="daynum">D${d.n}</span><div><strong>${esc(d.date)} · ${esc(d.region)}</strong><small>${esc(d.hotel || "未設定")}</small></div><span class="arrow">↗</span></a>`).join("")}</div>`;
  }
  function hotelForm(h) {
    const v = (k) => esc(h?.[k] ?? ""),
      first = days[0] ? isoDash(days[0]) : "",
      last = days.at(-1) ? isoDash(days.at(-1)) : "";
    openDialog(
      `<div class="eyebrow">STAY</div><h2 class="detailtitle">${h ? "修改住宿" : "新增住宿"}</h2><form class="tg-form" id="hotelForm" data-id="${h ? esc(h.id) : ""}"><label>Google 地圖連結<span class="searchrow"><input name="mapsUrl" class="search" inputmode="url" autocomplete="off" placeholder="貼上酒店的 Google 地圖分享連結" value="${v("mapsUrl")}"><button type="button" class="action primary" id="hotelLookup">自動填寫</button></span></label><p class="note" id="hotelLookupInfo"></p><label>酒店名稱<input name="name" required maxlength="100" value="${v("name")}"></label><label>地址<input name="address" maxlength="200" value="${v("address")}"></label><div class="tg-row"><label>入住<input name="checkIn" type="date" value="${h ? v("checkIn") : first}"></label><label>退房<input name="checkOut" type="date" value="${h ? v("checkOut") : last}"></label></div><label>備註（訂單、早餐、寄存行李…）<textarea name="note" rows="2" maxlength="500">${v("note")}</textarea></label><input type="hidden" name="lat" value="${h?.lat ?? ""}"><input type="hidden" name="lng" value="${h?.lng ?? ""}"><button type="submit" class="locate-button">${h ? "儲存修改" : "加入住宿"}</button></form>`,
    );
  }
  async function lookupHotel() {
    const f = $("#hotelForm"),
      el = f.elements,
      info = $("#hotelLookupInfo"),
      url = el.mapsUrl.value.trim();
    if (!url) return toast("請先貼上 Google 地圖連結。");
    info.textContent = "正在查詢 Google 地圖…";
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
        String(e?.code || "").startsWith("functions/") && e.message
          ? e.message.replace(/\s*\[\d+\]$/, "")
          : "未能自動填寫，請手動輸入。";
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
    return `${header("FLIGHTS", "出發與回家，都準備好。", "航班時間為各地當地時間")}<div class="links"><button class="action primary" data-flight-new>＋ 新增航班</button></div>${fs.length ? `<div class="twocol">${fs.map((f) => `<article class="ticket"><div class="ticket-top"><b>${esc(f.depart ? f.depart.slice(0, 10) : "")}</b><span>${esc(f.airline)} · ${esc(f.flightNo)}</span></div><div class="flightpath"><div><strong>${esc(f.from)}</strong><b>${esc(f.depart ? f.depart.slice(11, 16) : "")}</b></div><div class="plane">✈</div><div><strong>${esc(f.to)}</strong><b>${esc(f.arrive ? f.arrive.slice(11, 16) : "")}</b><small>${f.arrive && f.depart && f.arrive.slice(0, 10) !== f.depart.slice(0, 10) ? esc(f.arrive.slice(0, 10)) : ""}</small></div></div><div class="ticket-bottom"><span>${esc(f.note)}</span><span><button class="smallbtn" data-docs="flights:${esc(f.id)}">📎 文件${f.docs?.length ? `（${f.docs.length}）` : ""}</button> <button class="smallbtn" data-flight-edit="${esc(f.id)}">編輯</button> <button class="smallbtn" data-flight-del="${esc(f.id)}">刪除</button></span></div></article>`).join("")}</div>` : '<div class="empty"><h2>還沒有航班</h2><p>按「＋ 新增航班」輸入航班號、出發及到達時間。</p></div>'}<p class="note">電子機票等文件可按「📎 文件」上載，只限旅伴登入查看。</p>`;
  }
  function flightForm(f) {
    const v = (k) => esc(f?.[k] ?? "");
    openDialog(
      `<div class="eyebrow">FLIGHT</div><h2 class="detailtitle">${f ? "修改航班" : "新增航班"}</h2><form class="tg-form" id="flightForm" data-id="${f ? esc(f.id) : ""}"><div class="tg-row"><label>航班號<input name="flightNo" required maxlength="20" placeholder="例如：CX 410" value="${v("flightNo")}"></label><label>航空公司<input name="airline" maxlength="60" value="${v("airline")}"></label></div><div class="tg-row"><label>出發地<input name="from" maxlength="80" placeholder="例如：HKG T1" value="${v("from")}"></label><label>目的地<input name="to" maxlength="80" placeholder="例如：ICN T1" value="${v("to")}"></label></div><div class="tg-row"><label>出發（當地時間）<input name="depart" type="datetime-local" value="${v("depart")}"></label><label>到達（當地時間）<input name="arrive" type="datetime-local" value="${v("arrive")}"></label></div><label>備註（行李限額等，不要輸入訂單資料）<input name="note" maxlength="500" value="${v("note")}"></label><button type="submit" class="locate-button">${f ? "儲存修改" : "加入航班"}</button></form>`,
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
        : header("TOGETHER", "一起記，一起走。") + '<div class="empty"><h2>未能載入共用功能</h2><p>請重新整理網頁。</p></div>',
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
  function setActive(view) {
    current = view;
    document.querySelectorAll(".bottomnav a").forEach((a) => {
      const active = a.dataset.view === view;
      a.classList.toggle("active", active);
      if (active) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    $("#sourceBtn").classList.toggle("active", view === "notebook");
  }
  function sourceList() {
    if ($("#detail").open) $("#detail").close();
    if (location.hash === "#notebook") navigate();
    else location.hash = "notebook";
  }
  function refreshExplore() {
    $("#app").innerHTML = renderExplore() + footer();
    bindExplore();
  }
  function refreshNotebook() {
    $("#app").innerHTML = renderNotebook() + footer();
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
    openStop = null; // a page opened afresh shows no stop's edit buttons
    $("#app").innerHTML = sectionViews[view]() + footer();
    if (view === "explore") bindExplore();
    if (view === "notebook") bindNotebook();
    if (view === "nearby") nearbyResults();
    if (view === "plan") paintWeather();
    window.Together?.refresh();
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  $("#sourceBtn").onclick = sourceList;
  $("#detail .dialog-close").onclick = () => $("#detail").close();
  $("#detail").addEventListener("click", (e) => {
    if (e.target === $("#detail")) $("#detail").close();
  });
  $("#shareBtn").onclick = async () => {
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
  };
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
    if (el.dataset.stopMore) {
      const i = Number(el.dataset.stopMore);
      openStop = openStop === i ? null : i;
      refreshPlan();
    }
    if (el.dataset.stopNew !== undefined) placeForm(null, { day: selectedDay, slot: null });
    if (el.dataset.planPick !== undefined) pickPlaceForPlan(selectedDay);
    if (el.dataset.ppCat) {
      ppCat = el.dataset.ppCat;
      document.querySelectorAll("[data-pp-cat]").forEach((b) => b.classList.toggle("active", b.dataset.ppCat === ppCat));
      ppResults();
    }
    if (el.dataset.ppAdd) addPickedPlace(el.dataset.ppAdd);
    if (el.dataset.spotExplore) {
      const sp = buySpots[Number(el.dataset.spotExplore)];
      if (sp) {
        placeForm(null);
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
    if (el.dataset.stopDelete) {
      const i = Number(el.dataset.stopDelete),
        list = stopsFor(selectedDay);
      {
        const day = selectedDay;
        UI.confirm(`刪除「${list[i]?.title}」？`, { danger: true, ok: "刪除" }).then((ok) => {
          if (ok) {
            openStop = null;
            savePlan(
              day,
              stopsFor(day).filter((_, j) => j !== i),
            );
          }
        });
      }
    }
    if (el.dataset.stopMove) {
      const [i, dir] = el.dataset.stopMove.split(":").map(Number),
        list = [...stopsFor(selectedDay)],
        j = i + dir;
      if (list[j]) {
        [list[i], list[j]] = [list[j], list[i]];
        openStop = j;
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
      openStop = null;
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

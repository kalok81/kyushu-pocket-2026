  // ---- 附近 (nearby places and shops within 100 m to 2 km of the phone or a pin on the map) ----
  let nearbyRequest = 0;
  const NEAR_RADII = [100, 200, 500, 1000, 2000];
  const nearbyState = { position: null, accuracy: null, loading: false, error: "", radius: 200, category: "全部", mode: "gps" };
  function renderNearby() {
    const coordinates = window.TRIP_GEO?.places || {},
      coverage = places.filter((p) => (coordinates[p.id] || []).length).length;
    return `${header("附近", "只找已加入的地點，按直線距離由近至遠排序")}<section class="nearby-panel"><div class="links">${Kit.btn(nearbyState.loading ? "正在取得位置…" : nearbyState.position ? "重新定位" : "定位看附近", { variant: "primary", icon: "locate", attrs: { id: "locateNow", disabled: nearbyState.loading, "aria-busy": nearbyState.loading ? "true" : null } })}${Kit.btn("在地圖選位置", { icon: "pin", attrs: { id: "pickOnMap" } })}</div><p class="nearby-help">手機定位：按下後請允許瀏覽器使用位置。你的位置只在這次網頁內計算，不會儲存或傳送到網站伺服器。</p>${Kit.chips(
      NEAR_RADII.map((r) => ({ label: r >= 1000 ? `${r / 1000}公里` : `${r}米`, active: nearbyState.radius === r, attrs: { "data-radius": r } })),
      { label: "附近距離範圍" },
    )}${Kit.chips(
      ["全部", ...exploreCats, "購物"].map((c) => ({ label: c, icon: c === "購物" ? "bag" : "", active: nearbyState.category === c, attrs: { "data-near-category": c } })),
      { label: "附近地點分類" },
    )}${nearbyState.category === "購物" ? '<p class="note">按購物中未買物品的「購買地點」定位。</p>' : ""}<div id="nearbyStatus" role="status" aria-live="polite">${nearbyState.error ? `<div class="notice nearby-error">${esc(nearbyState.error)}</div>` : nearbyState.loading ? "<p>定位中，請稍候…</p>" : nearbyState.position && nearbyState.mode === "manual" ? '<p class="note">以地圖選取的位置為中心 · 距離並非從手機目前位置計算</p>' : nearbyState.position ? `<p class="note">已取得位置 · 定位精度約 ±${Math.ceil(nearbyState.accuracy)}米${nearbyState.accuracy > nearbyState.radius ? "；誤差大於所選範圍，建議到室外重新定位或選較大範圍。" : ""}</p>` : '<p class="note">尚未選取位置。選擇範圍後，可用手機定位或在地圖選位置。</p>'}</div></section><div id="nearbyResults"></div><p class="note">距離為直線估算，並非步行路程；樓層、入口及河道可能影響實際路程。已建立座標 ${coverage}/${places.length} 個地點；未有可靠座標的項目暫不納入附近結果。</p><p class="note">座標來源：店方／場地地圖及公開地點資料。</p>${Kit.btn("查看座標覆蓋情況", { size: "sm", variant: "ghost", attrs: { id: "nearbyCoverage" } })}`;
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
              return `<article class="card place"><div class="card-top place-top">${Kit.badge("購物", "shop")}</div><h3>${esc(s.name)}</h3><div class="distance-badge">距離約 ${Math.round(s.distance)} 米</div><p class="buy-here">${icon("bag")} 可買：${s.items.map(esc).join("、")}</p>${s.address ? `<p class="note">${esc(s.address)}</p>` : ""}<div class="actions">${p ? Kit.btn("店舖資料", { size: "sm", attrs: { "data-place": p.id } }) : ""}${link(route(p ? `${p.v[1]} ${p.v[3]}` : s.address), "導航")}</div></article>`;
            })
            .join("")}</div>`
        : Kit.empty("這個範圍內暫時沒有可買清單物品的地方", "購物中未買、而且有「購買地點」的物品才會顯示。可試試較大範圍。", Kit.btn("查看購物", { href: "#shopping", size: "sm" }))
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
  // 區域 in the pin page: each explore region at the middle of its places, the most places first
  function nearbyAreas() {
    const geo = window.TRIP_GEO?.places || {},
      by = new Map();
    for (const p of places) {
      const c = (geo[p.id] || [])[0],
        r = String(p.v[0] || "").trim();
      if (!c || !r) continue;
      const a = by.get(r) || { n: 0, lat: 0, lng: 0 };
      by.set(r, { n: a.n + 1, lat: a.lat + c.lat, lng: a.lng + c.lng });
    }
    return [...by].sort((a, b) => b[1].n - a[1].n).map(([r, a]) => [r, a.lat / a.n, a.lng / a.n]);
  }
  function openMapPicker() {
    const areas = nearbyAreas();
    window.MapPicker.open({
      areas: areas.length ? areas : meta.center ? [[meta.destination, meta.center.lat, meta.center.lng]] : [],
      radii: NEAR_RADII,
      places,
      coordinates: window.TRIP_GEO?.places || {},
      radius: nearbyState.radius,
      category: nearbyState.category,
      initial: nearbyState.mode === "manual" ? nearbyState.position : null,
      onConfirm: ({ radius, ...position }) => {
        nearbyRequest++;
        if (NEAR_RADII.includes(radius)) nearbyState.radius = radius;
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

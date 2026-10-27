  // ---- 探索 › 地圖: the listed places as dots; a tap on the map lists the Google places there to add one ----
  let mapAsk = 0,
    endMap = () => {};
  async function openExploreMap() {
    const shown = shownPlaces(),
      coordinates = window.TRIP_GEO?.places || {},
      pinned = shown.filter((p) => (coordinates[p.id] || []).length),
      dialog = $("#detail");
    openDialog(
      `${Kit.sheetHead("探索地圖", `${pinned.length} 個地點`)}<p class="nearby-help">點地圖上的圓點看地點；點地圖其他位置，會列出那裏的 Google 地點，可以直接加入探索。</p><div id="mapLoad">${Kit.dots("正在載入地圖…")}</div><div id="exploreMap" class="pin-map explore-map" role="region" aria-label="探索地點地圖"></div><div id="exploreMapInfo" class="explore-map-info" aria-live="polite"><p class="note">${shown.length > pinned.length ? `另有 ${shown.length - pinned.length} 個地點未有座標，不會顯示。` : "地圖跟隨探索頁的分類、區域及搜尋。"}</p></div><p class="note">地圖及附近地點由 Google 地圖提供（未能載入時改用 OpenStreetMap）。</p>`,
    );
    dialog.classList.add("map-picker-dialog");
    let map;
    // Ends with the dialog, or when it turns into another sheet (詳情, 加入)
    endMap = () => {
      map?.remove();
      map = null;
      dialog.classList.remove("map-picker-dialog");
      dialog.removeEventListener("close", endMap);
    };
    dialog.addEventListener("close", endMap);
    try {
      await window.MapPicker.load();
      const el = $("#exploreMap");
      if (!dialog.open || !el) return;
      $("#mapLoad").remove();
      const L = window.L,
        css = getComputedStyle(document.documentElement),
        color = (p) => css.getPropertyValue(`--cat-${placeCat(p)[1] || "shop"}`).trim() || "#173f3a";
      map = L.map(el, { scrollWheelZoom: false });
      window.MapPicker.base(map);
      const pts = [];
      for (const p of pinned)
        for (const c of coordinates[p.id]) {
          pts.push([c.lat, c.lng]);
          L.circleMarker([c.lat, c.lng], { radius: 7, color: "#fff", weight: 2, fillColor: color(p), fillOpacity: 0.95, bubblingMouseEvents: false })
            .addTo(map)
            .bindTooltip(esc(p.v[1] + (c.label ? " · " + c.label : "")))
            .on("click", () => showMapPlace(p));
        }
      if (pts.length > 1) map.fitBounds(pts, { padding: [24, 24], maxZoom: 16 });
      else if (pts.length) map.setView(pts[0], 16);
      else map.setView(meta.center ? [meta.center.lat, meta.center.lng] : [35.681, 139.767], 14);
      const spot = L.marker([0, 0], { icon: L.divIcon({ className: "map-pin", html: "<span></span>", iconSize: [32, 42], iconAnchor: [16, 34] }), alt: "選取位置", interactive: false }),
        found = L.layerGroup().addTo(map);
      map.on("click", (e) => {
        spot.setLatLng(e.latlng).addTo(map);
        googlePlacesAt(e.latlng, found);
      });
      // 我的位置: centre on where the phone is (shown as a blue dot; nothing is saved)
      const me = L.control({ position: "topright" });
      me.onAdd = () => {
        const b = L.DomUtil.create("button", "btn btn-outline btn-icon map-locate");
        b.type = "button";
        b.setAttribute("aria-label", "我的位置");
        b.innerHTML = icon("locate");
        L.DomEvent.disableClickPropagation(b);
        b.onclick = () =>
          navigator.geolocation?.getCurrentPosition(
            (pos) => {
              const ll = [pos.coords.latitude, pos.coords.longitude];
              L.circleMarker(ll, { radius: 8, color: "#fff", weight: 3, fillColor: "#2f6fdf", fillOpacity: 1, interactive: false }).addTo(map);
              map.setView(ll, 17);
            },
            () => toast("未能取得位置，請允許瀏覽器使用位置。"),
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
          );
        return b;
      };
      me.addTo(map);
      map.invalidateSize();
    } catch {
      const status = $("#mapLoad");
      if (status) status.textContent = "地圖未能載入，請檢查網絡後再試。";
    }
  }
  function showMapPlace(p) {
    const box = $("#exploreMapInfo"),
      [cat, catCls] = placeCat(p);
    if (box)
      box.innerHTML = `<div class="list-row explore-map-row"><div>${Kit.badge(cat, catCls)}<p><b>${esc(p.v[1])}</b>${p.zh ? ` <small>${esc(p.zh)}</small>` : ""}</p><small>${esc([p.v[0], p.v[2]].filter(Boolean).join(" · "))}</small></div>${Kit.btn("詳情", { size: "sm", attrs: { "data-place": p.id } })}</div>`;
  }
  // The Google places around a tapped spot (lookupPlace near), nearest first, each with 加入 or the explore place it already is.
  async function googlePlacesAt(at, layer) {
    const box = $("#exploreMapInfo"),
      ask = ++mapAsk;
    if (!box) return;
    layer.clearLayers();
    box.innerHTML = Kit.dots("正在查詢這個位置附近的 Google 地點…");
    let list;
    try {
      list = await window.Together.placesNear(at.lat, at.lng);
    } catch (e) {
      if (ask === mapAsk && $("#exploreMapInfo")) box.innerHTML = `<p class="note">${esc(e.message === "offline" ? "離線中，有網絡時再試。" : Kit.fnError(e, "暫時未能查詢附近地點，請稍後再試。"))}</p>`;
      return;
    }
    if (ask !== mapAsk || !$("#exploreMapInfo")) return;
    const own = Kit.btn("在這裏自己輸入地點", { size: "sm", variant: "ghost", icon: "plus", attrs: { "data-map-own": `${at.lat},${at.lng}` } });
    if (!list.length) return (box.innerHTML = `<p class="note">80 米內找不到 Google 地點。可以放大地圖，點準一點再試。</p>${own}`);
    list.forEach((g, i) =>
      window.L.marker([g.lat, g.lng], { icon: window.L.divIcon({ className: "route-pin", html: `<span>${i + 1}</span>`, iconSize: [28, 28], iconAnchor: [14, 14] }), alt: g.name })
        .addTo(layer)
        .bindTooltip(esc(`${i + 1}. ${g.name}`)),
    );
    box.innerHTML = `<p class="note">附近的 Google 地點（由近至遠）：</p><div class="list explore-map-list">${list
      .map((g, i) => {
        const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(g.name)}&query_place_id=${encodeURIComponent(g.id)}`,
          dup = placeDuplicate(g.name, url, g.lat, g.lng);
        return `<div class="list-row explore-map-row"><b class="explore-map-n">${i + 1}</b><div><p>${esc(g.name)}</p><small>${esc([g.type, `約 ${g.d} 米`].filter(Boolean).join(" · "))}</small></div>${
          dup ? Kit.btn("已在探索", { size: "sm", variant: "ghost", icon: "check", attrs: { "data-place": dup.id } }) : Kit.btn("加入", { size: "sm", variant: "secondary", icon: "plus", attrs: { "data-map-add": url } })
        }</div>`;
      })
      .join("")}</div>${own}`;
  }
  // 加入: the place form for that Google place, filled in by 自動填寫 as for a pasted link.
  function addFromMap(url) {
    placeForm(null);
    $("#placeForm").elements.mapsUrl.value = url;
    lookupPlaceForm();
  }
  // 自己輸入: an empty place form pinned at the tapped spot.
  function addAtSpot(latLng) {
    const [lat, lng] = latLng.split(",").map(Number);
    placeForm(null);
    const el = $("#placeForm").elements;
    el.lat.value = lat;
    el.lng.value = lng;
    const near = nearestPlace({ lat, lng }, places.filter((p) => p.v[0]));
    if (near && near.d < 8000) el.f0.value = near.p.v[0];
    $("#placeLookupInfo").textContent = "已記下地圖上的位置。輸入名稱等資料後按「加入地點」；有 Google 地圖連結的話亦可貼上再按「自動填寫」。";
  }
  document.addEventListener("click", (e) => {
    const el = e.target.closest("button");
    if (!el) return;
    if (el.closest("#exploreMapInfo")) endMap();
    if (el.dataset.exploreMap !== undefined) openExploreMap();
    if (el.dataset.mapAdd) addFromMap(el.dataset.mapAdd);
    if (el.dataset.mapOwn) addAtSpot(el.dataset.mapOwn);
  });

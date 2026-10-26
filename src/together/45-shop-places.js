  // ---- 購物: matching 購買地點 to explore places, shopping spots for 探索 / 附近 / 行程, geocoding ----
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
  // Each 購買地點 line of every unbought item: fn(item, line, its explore place or null, its own pin or null)
  const eachBuyPlace = (fn) =>
    state.shopping.filter((x) => !x.bought).forEach((x) => placesOf(x).forEach((line, i) => fn(x, line, linePlace(x, i), pinOf(x, i))));
  function shoppingPlaces() {
    const spots = {};
    eachBuyPlace((x, line, p, pin) => {
      const key = p ? "p:" + p.id : "t:" + norm(shopLabel(line));
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
    eachBuyPlace((x, line, p, own) => {
      const pin = p && geo[p.id]?.[0];
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
  async function placeFromMaps(input) {
    const url = input.value.trim().match(/https:\/\/\S+/)?.[0];
    if (!url || !Kit.isMapsLink(url) || input.dataset.looking) return;
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

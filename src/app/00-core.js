  // ---- Shared helpers, trip days, favourites and page state ----
  const Kit = window.Kit,
    { icon } = Kit,
    zhLine = (z) => (z ? `<span class="zh-name">${esc(z)}</span>` : "");
  const $ = (s) => document.querySelector(s),
    esc = Kit.esc;
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
  // Lists that show the ★
  function savedChanged() {
    if ($("#results")) renderResults();
    if ($("#notebookResults")) notebookResults();
    if (current === "nearby") nearbyResults();
  }
  // Favourites sync per companion through Firestore (members/{uid}.saved).
  function setSaved(ids) {
    saved = new Set(ids);
    storage.set("kyushu-saved-v1", [...saved]);
    savedChanged();
    if (current === "home") render();
  }
  // One star on or off: this device, the companion's synced list, and every list showing it
  function markSaved(id, on) {
    on ? saved.add(id) : saved.delete(id);
    const ok = storage.set("kyushu-saved-v1", [...saved]);
    window.Together?.saveFavorites([...saved]);
    savedChanged();
    if (!ok) toast("瀏覽器未允許儲存；收藏只保留至本次離開。");
  }
  let current = "home",
    selectedDay = 1,
    category = "全部",
    region = "全部區域",
    search = "",
    onlySaved = false;
  const fnError = Kit.fnError;
  // 自動填寫 from a Google Maps link (place, stop and hotel forms): the button is off and info shows progress while
  // waiting; fill(result, put, fields) fills the form (put only fills empty fields) and may return the message to show.
  async function mapsAutofill(form, { btn, info, opts, seconds = 5, wait = "正在查詢 Google 地圖…", fill }) {
    const el = form.elements,
      url = el.mapsUrl.value.trim();
    if (!url) return toast("請先貼上 Google 地圖連結。");
    if (btn) btn.disabled = true;
    info.textContent = wait;
    const done = Kit.busy(info, { seconds });
    try {
      const r = await window.Together.lookupPlace(url, opts),
        put = (name, value) => {
          if (value && !el[name].value.trim()) el[name].value = value;
        };
      info.textContent = fill(r, put, el) || "已填入，請檢查後按儲存。";
    } catch (e) {
      info.textContent = fnError(e, "未能自動填寫，請手動輸入。");
      console.error(e);
    } finally {
      done();
      if (btn) btn.disabled = false;
    }
  }
  // The explore place nearest to a point and how far it is (metres)
  const nearestPlace = (pt, list = places) =>
    list
      .map((p) => ({ p, d: Math.min(...(window.TRIP_GEO.places[p.id] || []).map((g) => window.Nearby.distance(pt, g)), Infinity) }))
      .sort((a, b) => a.d - b.d)[0];
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
        // date is the one format used on every page (Kit.date): 10/29（四）; md for the narrow day tabs
        date: `${mo}/${da}（${wk[d.getUTCDay()]}）`,
        md: `${mo}/${da}`,
        weekday: "星期" + wk[d.getUTCDay()],
        region: m.destination || "",
        hotel: "",
        transport: "",
        iso: `${y}/${String(mo).padStart(2, "0")}/${String(da).padStart(2, "0")}`,
      });
    }
    return out;
  }
  const lists = () => window.Together?.lists() || { hotels: [], flights: [], events: [] };
  const isoDash = (d) => d.iso.replaceAll("/", "-"),
    // first and last day as YYYY-MM-DD (date inputs' defaults)
    tripDates = () => [days[0] ? isoDash(days[0]) : "", days.at(-1) ? isoDash(days.at(-1)) : ""];
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
    if (["hotels", "flights", "events", "home"].includes(current) && !$("#detail").open) render();
    else if (current === "plan") refreshPlan();
  }
  const nights = (h) => (h.checkIn && h.checkOut ? Math.round((Date.parse(h.checkOut) - Date.parse(h.checkIn)) / 864e5) : 0);
  const fmtTime = (t) => (t ? `${Kit.date(t)} ${String(t).slice(11, 16)}`.trim() : "");

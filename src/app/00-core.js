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
  // One star on or off: this device, the companion's synced list, and every list showing it
  function markSaved(id, on) {
    on ? saved.add(id) : saved.delete(id);
    const ok = storage.set("kyushu-saved-v1", [...saved]);
    window.Together?.saveFavorites([...saved]);
    if ($("#results")) renderResults();
    if ($("#notebookResults")) notebookResults();
    if (current === "nearby") nearbyResults();
    if (!ok) toast("瀏覽器未允許儲存；收藏只保留至本次離開。");
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

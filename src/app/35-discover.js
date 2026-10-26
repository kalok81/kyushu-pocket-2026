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
      `${Kit.sheetHead("AI 推薦新地點", d ? `D${day} · ${esc(d.date)}` : "")}<p class="note">AI 上網搜尋${d ? "這天站點附近" : ""}你清單未有的好去處，每個都用 Google 地圖核實，附評分、營業時間及相片。</p><form class="tg-form" id="discoverForm"><label>區域${d ? "（預設這天的區域，可以改）" : ""}<input name="area" list="discoverAreas" maxlength="60" placeholder="例如：由布院、天神" value="${esc(discover.area)}"><datalist id="discoverAreas">${regions.map((r) => `<option value="${esc(r)}">`).join("")}</datalist></label><div><span class="field-label">類型</span>${Kit.chips(
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
        return `<article class="card discover-card">${p.photo ? `<img src="data:image/jpeg;base64,${p.photo}" alt="" loading="lazy">` : `<span class="discover-ph">${icon("pin")}</span>`}<div><h3>${esc(p.name)}</h3><p class="discover-meta">${[p.type, stars(p)].filter(Boolean).map(esc).join(" · ")}</p>${p.reason ? `<p class="discover-reason">${esc(p.reason)}</p>` : ""}${open ? `<p class="discover-meta">${icon("clock")} ${esc(d.weekday)}：${esc(open)}</p>` : ""}<p class="discover-meta">${esc(p.address.replace(/^〒\d{3}-\d{4}\s*/, "").replace(/^日本、?/, ""))}</p><div class="links">${have.has(p.name) ? Kit.badge("✓ 已加入探索") : Kit.btn(d ? `加入 D${discover.day}` : "加入探索", { size: "sm", variant: "secondary", icon: "plus", attrs: { "data-discover-add": k } })}${Kit.btn(`${esc(p.name)} 地圖`, { href: p.mapsUrl, external: true, size: "sm", icon: "map", iconOnly: true })}</div>${p.photo ? `<small class="discover-credit">相片：${esc(p.photoBy || "Google 地圖")}</small>` : ""}</div></article>`;
      })
      .join("")}</div>${r.dropped ? `<p class="note">另有 ${r.dropped} 個在 Google 地圖找不到或已在清單，已略去。</p>` : ""}${Kit.btn("再推薦更多", { variant: "secondary", icon: "sparkles", cls: "btn-block", attrs: { "data-discover-more": true } })}`;
  }
  // more: the same search again for places not shown yet, added below the ones already there
  async function runDiscover(f, more = false) {
    const out = $("#discoverOut"),
      d = discover.day && days[discover.day - 1],
      shown = more ? discover.results?.places || [] : [];
    if (!more) discover.area = String(f.elements.area?.value || "").trim() || (d ? d.region : "");
    if (!discover.area) return toast("請輸入區域。");
    // near this day's stops only while the area is still the day's own
    const nearDay = d && discover.area === d.region;
    const busy = Kit.progress({ text: "AI 正在上網搜尋，並用 Google 地圖核實…", seconds: 40 });
    if (more) $("[data-discover-more]")?.replaceWith(Object.assign(document.createElement("div"), { innerHTML: busy, id: "discoverMore" }));
    else out.innerHTML = busy;
    f.querySelector("[type=submit]").disabled = true;
    try {
      const r = await window.Together.discoverPlaces({
        area: discover.area,
        kind: discover.kind,
        prefs: [...discover.prefs],
        note: String(f.elements.note.value || "").trim(),
        have: [...shown.map((p) => p.name), ...places.flatMap((p) => [p.v[1], p.zh].filter(Boolean))].slice(0, 300),
        ...(more ? { more: true } : {}),
        ...(d ? { weekday: d.weekday } : {}),
        ...(nearDay ? { near: dayPoint(discover.day) } : {}),
      });
      discover.results = more ? { places: [...shown, ...r.places], dropped: 0 } : r;
      if (more && !r.places.length) toast("找不到更多新地點，可以換個類型或喜好再試。");
    } catch (e) {
      console.error(e);
      if (more) toast(fnError(e, "AI 未能推薦，請稍後再試。"));
      else discover.results = { places: [], error: fnError(e, "AI 未能推薦，請稍後再試。") };
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
    if (el.dataset.discoverMore !== undefined && $("#discoverForm")) runDiscover($("#discoverForm"), true);
  });
  document.addEventListener("submit", (e) => {
    if (e.target.id !== "discoverForm") return;
    e.preventDefault();
    runDiscover(e.target);
  });

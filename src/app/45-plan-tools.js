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
     // the 方案 on screen for that day (named when the day has more than one)
     const stops = stopsFor(d.n),
       plan = variantsOf(d.n).length ? viewedVariant(d.n)?.name || mainName(d.n) : "";
     return `<section class="print-day"><h2>DAY ${d.n} · ${esc(d.date)} ${esc(d.weekday)} · ${esc(d.region)}${plan ? ` · ${esc(plan)}` : ""}</h2>${d.hotel ? `<p class="print-sub">住宿：${esc(d.hotel)}</p>` : ""}${stops.length ? `<table><tbody>${stops.map((s) => `<tr><td class="print-time">${esc(s.time)}</td><td><b>${esc(s.title)}</b>${s.note ? `<div>📝 ${esc(s.note)}</div>` : ""}${s.detail ? `<div>${esc(s.detail)}</div>` : ""}${s.transport ? `<div class="print-sub">↳ ${esc(s.transport)}</div>` : ""}</td></tr>`).join("")}</tbody></table>` : '<p class="print-sub">未安排</p>'}</section>`;
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

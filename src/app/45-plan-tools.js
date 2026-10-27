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
  // Stops with coordinates for the route map: the first choice of each time slot, numbered like the plan, each with the
  // way to it (its transport); the day starts at last night's hotel (起) when the plan does not start at a hotel.
  function routeStops(day) {
    const geo = window.TRIP_GEO?.places || {},
      list = stopsFor(day),
      out = stopGroups(list)
        .map(([{ s }], n) => {
          const g = (s.placeId && geo[s.placeId]?.[0]) || (Number.isFinite(s.lat) && Number.isFinite(s.lng) ? s : null);
          return g ? { n: n + 1, time: s.time || "", title: s.title || "", lat: g.lat, lng: g.lng, leg: s.transport || "" } : null;
        })
        .filter(Boolean),
      h = list[0] && !list[0].hotelId ? dayStartHotel(day) : null;
    return h && Number.isFinite(h.lat) && out.length ? [{ n: "起", time: "出發", title: h.name, lat: h.lat, lng: h.lng, leg: "" }, ...out] : out;
  }
  // The way along the streets between the map's stops, kept on this phone (the same leg is not asked for twice).
  const decodeLine = (str) => {
    const pts = [];
    let i = 0,
      lat = 0,
      lng = 0;
    while (i < str.length) {
      for (const k of [0, 1]) {
        let b,
          shift = 0,
          r = 0;
        do {
          b = str.charCodeAt(i++) - 63;
          r |= (b & 31) << shift;
          shift += 5;
        } while (b >= 32);
        const d = r & 1 ? ~(r >> 1) : r >> 1;
        if (k) lng += d;
        else lat += d;
      }
      pts.push([lat / 1e5, lng / 1e5]);
    }
    return pts;
  };
  async function streetLines(stops) {
    const key = (a, b) => `path:${a.lat.toFixed(5)},${a.lng.toFixed(5)}>${b.lat.toFixed(5)},${b.lng.toFixed(5)}`,
      legs = stops.slice(1).map((b, j) => ({ a: stops[j], b })),
      got = legs.map(({ a, b }) => {
        try {
          return JSON.parse(localStorage.getItem(key(a, b)));
        } catch {
          return null;
        }
      }),
      ask = legs.filter((_, j) => !got[j]).slice(0, 12);
    if (ask.length) {
      const r = await window.Together.streetPaths(ask.map(({ a, b }) => ({ a: { lat: a.lat, lng: a.lng }, b: { lat: b.lat, lng: b.lng } })));
      ask.forEach((l, j) => {
        if (!r[j]?.line) return;
        got[legs.indexOf(l)] = { mode: r[j].mode, line: r[j].line };
        try {
          localStorage.setItem(key(l.a, l.b), JSON.stringify(got[legs.indexOf(l)]));
        } catch {}
      });
    }
    return got.map((v) => v && { mode: v.mode, pts: decodeLine(v.line) });
  }
  // Whole itinerary on paper (or "Save as PDF"): flights, hotels and every day's stops, printed from a temporary #printArea.
  function printPlan() {
    const L = lists(),
      fl = [...L.flights].sort((a, b) => String(a.depart).localeCompare(String(b.depart))),
      hs = [...L.hotels].sort((a, b) => String(a.checkIn).localeCompare(String(b.checkIn)));
    const title = meta.name || "旅程",
      range = days.length ? Kit.dateRange(days[0].iso, days.at(-1).iso, { year: true }) : "";
    const html = `<h1>${esc(title)}</h1><p class="print-sub">${esc([meta.destination, range, `${days.length} 天`].filter(Boolean).join(" · "))}</p>
 ${fl.length ? `<h2>航班</h2><table><tbody>${fl.map((f) => `<tr><td>${esc(fmtTime(f.depart))}</td><td><b>${esc(f.flightNo)}</b> ${esc(f.airline)}</td><td>${esc(f.from)} → ${esc(f.to)}</td><td>到達 ${esc(fmtTime(f.arrive))}</td></tr>`).join("")}</tbody></table>` : ""}
 ${hs.length ? `<h2>住宿</h2><table><tbody>${hs.map((h) => `<tr><td>${h.checkIn ? esc(Kit.dateRange(h.checkIn, h.checkOut)) : "日期未定"}</td><td><b>${esc(h.name)}</b></td><td>${esc(h.address)}</td></tr>`).join("")}</tbody></table>` : ""}
 ${days
   .map((d) => {
     // the 方案 on screen for that day (named when the day has more than one)
     const stops = stopsFor(d.n),
       plan = variantsOf(d.n).length ? viewedVariant(d.n)?.name || mainName(d.n) : "";
     return `<section class="print-day"><h2>DAY ${d.n} · ${esc(d.date)} · ${esc(d.region)}${plan ? ` · ${esc(plan)}` : ""}</h2>${d.hotel ? `<p class="print-sub">住宿：${esc(d.hotel)}</p>` : ""}${stops.length ? `<table><tbody>${stops.map((s) => `<tr><td class="print-time">${esc(s.time)}</td><td><b>${esc(s.title)}</b>${s.note ? `<div>📝 ${esc(s.note)}</div>` : ""}${s.detail ? `<div>${esc(s.detail)}</div>` : ""}${s.transport ? `<div class="print-sub">↳ ${esc(s.transport)}</div>` : ""}</td></tr>`).join("")}</tbody></table>` : '<p class="print-sub">未安排</p>'}</section>`;
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
        // day tab: icon, then lowest–highest (the two wrap onto two lines when the tabs are narrow)
        if (el.dataset.weatherTab) el.innerHTML = `<span>${icon}</span><span>${Math.round(w.min)}–${Math.round(w.max)}°</span>`;
        else {
          el.textContent = `${icon} ${text} · ${Math.round(w.min)}–${Math.round(w.max)}°C${w.rain != null ? ` · 降雨機會 ${w.rain}%` : ""}`;
          el.hidden = false;
        }
      });
    }
  }

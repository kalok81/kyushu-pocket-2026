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
            ["日期", `D${d.n} ${d.date}`],
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
        sub: h.checkIn ? Kit.dateRange(h.checkIn, h.checkOut) : "日期未定",
        source: "住宿",
        fields: [
          ["入住", Kit.date(h.checkIn)],
          ["退房", Kit.date(h.checkOut)],
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
        region: window.Together?.shopCats?.[x.cat] || "購物",
        summary: [x.qty, x.detail, x.place].filter(Boolean).join(" · "),
        sub: x.bought
          ? `✓ 已買${x.boughtBy ? `（${x.boughtBy}）` : ""}`
          : x.price != null && S.currencies[x.currency]
            ? `未買 · ${S.format(S.toMinor(x.price, x.currency), x.currency)}`
            : "未買",
        source: "購物",
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
    return `${header("資料簿", "搜尋全部旅程資料，或按分類及區域篩選")}${notebookBody()}`;
  }
  // Search, filters and results: the 資料簿 page, and the lower part of 總覽
  function notebookBody() {
    return `<div class="controls notebook-controls"><div class="searchrow"><input id="notebookSearch" class="search" type="search" aria-label="搜尋完整資料簿" placeholder="輸入店名、菜式、酒店、航班或日期…" value="${esc(notebookSearch)}"><select id="notebookRegion" aria-label="資料簿區域"><option>全部區域</option>${[...new Set(notebookRecords().map(notebookArea))].map((r) => `<option${r === notebookRegion ? " selected" : ""}>${esc(r)}</option>`).join("")}</select></div>${Kit.chips(
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
      `<div class="resultsbar"><span>找到 ${rs.length} 項${notebookSearch ? " ·「" + esc(notebookSearch) + "」" : ""}</span>${Kit.btn("清除篩選", { variant: "ghost", size: "sm", attrs: { id: "notebookReset" } })}</div><div class="notebook-list">${rs.map((r) => Kit.card({ cls: "notebook-card", top: `${Kit.badge(esc(r.type))}<span class="card-meta">${esc(r.region)}</span>`, title: esc(r.title), body: `${r.summary ? `<p class="notebook-summary">${esc(r.summary)}</p>` : ""}${r.sub ? `<p class="notebook-sub">${esc(r.sub)}</p>` : ""}<div class="card-foot"><small>${esc(r.source)}</small>${Kit.btn("查看詳情", { size: "sm", attrs: { "data-notebook-record": r.id } })}</div>` })).join("")}</div>${rs.length ? "" : Kit.empty("找不到符合的資料", "試用較短的店名、菜式或日期，或按「清除篩選」。")}`;
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

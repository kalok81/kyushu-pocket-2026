  // ---- AI 助手: translate a photographed menu or sign, and ask about the trip (receiptJobs via Together.aiJob) ----
  // Answers and translations stay on this phone only (the last few, without photos); the jobs are deleted once read.
  const ASK_KEYS = { tr: "pocket-ask-translations", chat: "pocket-ask-chat" };
  const askState = { busy: "", here: false, translations: storage.get(ASK_KEYS.tr), chat: storage.get(ASK_KEYS.chat), photo: null };
  const ASK_IDEAS = ["今晚附近有咩好食？", "明日落雨，可以點改行程？", "今日行程有咩要注意？", "呢度食飯要俾小費嗎？"];
  const askSave = () => {
    storage.set(ASK_KEYS.tr, askState.translations.slice(0, 5));
    storage.set(ASK_KEYS.chat, askState.chat.slice(-20).map(({ busy: _b, ...m }) => m));
  };
  const askTime = (t) => (t ? new Date(t).toLocaleString("zh-HK", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) : "");
  const askPrice = (n) => (n == null ? "" : (meta.currency || "JPY") === "JPY" ? `¥${n.toLocaleString("en-US")}` : `${n.toLocaleString("en-US")} ${meta.currency}`);
  function translationCard(t, k) {
    const items = t.items?.length
      ? `<ul class="ask-items">${t.items
          .map((i) => `<li><div><b>${esc(i.zh || i.original)}</b>${i.zh && i.original ? `<small lang="ja">${esc(i.original)}</small>` : ""}${i.note ? `<small class="ask-note">${esc(i.note)}</small>` : ""}</div>${i.price != null ? `<span class="ask-price">${esc(askPrice(i.price))}</span>` : ""}</li>`)
          .join("")}</ul>`
      : "";
    return Kit.card({
      cls: "ask-tr",
      top: `<span class="card-meta">${esc(askTime(t.at))}</span>${Kit.btn("刪除這個翻譯", { icon: "trash", iconOnly: true, variant: "ghost", size: "sm", attrs: { "data-ask-tr-del": k } })}`,
      title: esc(t.title || "翻譯"),
      body: `${k === 0 && askState.photo ? `<img class="ask-photo" src="data:image/jpeg;base64,${askState.photo}" alt="">` : ""}${t.summary ? `<p>${esc(t.summary)}</p>` : ""}${items}${t.tips ? `<p class="note ask-tips">${icon("sparkles")} ${esc(t.tips)}</p>` : ""}`,
    });
  }
  function askTranslations() {
    const busy = askState.busy === "translate" ? Kit.progress({ text: "AI 正在讀相片及翻譯…", seconds: 20 }) : "";
    return busy + askState.translations.map(translationCard).join("");
  }
  // The places named in an answer, as buttons that open them
  function askPlaces(names = []) {
    const found = names.map((n) => places.find((p) => p.v[1] === n || p.zh === n) || places.find((p) => p.v[1].includes(n) || n.includes(p.v[1]))).filter((p, i, all) => p && all.indexOf(p) === i);
    return found.length ? `<div class="links">${found.map((p) => Kit.btn(esc(p.v[1]), { size: "sm", icon: "pin", attrs: { "data-place": p.id } })).join("")}</div>` : "";
  }
  function askChat() {
    if (!askState.chat.length)
      return `<p class="note">可以問附近食乜、落雨點改行程、日本習慣等，AI 會參考你的行程、地點清單及天氣。</p>${Kit.chips(
        ASK_IDEAS.map((q) => ({ label: esc(q), attrs: { "data-ask-idea": q } })),
        { label: "問題例子" },
      )}`;
    return askState.chat
      .map(
        (m) =>
          `<div class="ask-msg me"><p>${esc(m.q)}</p></div><div class="ask-msg ai">${
            m.busy ? Kit.progress({ text: "AI 正在參考你的行程…", seconds: 15 }) : m.error ? `<p class="tg-warn">${esc(m.error)}</p>` : `<p>${esc(m.a)}</p>${askPlaces(m.places)}`
          }</div>`,
      )
      .join("");
  }
  function renderAsk() {
    const pick = (label, ic, variant, capture) =>
      `<label class="btn btn-${variant}">${icon(ic)}<span>${label}</span><input type="file" accept="image/*"${capture ? ' capture="environment"' : ""} class="sr-only" data-ask-photo></label>`;
    return `${header("AI 助手", "影相翻譯菜單及告示，或問旅程問題")}${Kit.sectionHead("影相翻譯", askState.translations.length ? Kit.btn("清除", { size: "sm", icon: "trash", attrs: { "data-ask-clear": "tr" } }) : "")}<div class="ask-pick">${pick("影相", "camera", "secondary", true)}${pick("選相片", "image", "outline", false)}</div><p class="note">菜單、告示、標籤、售票機都可以；電腦上可以直接貼上圖片。</p><div id="askTranslations" class="ask-list">${askTranslations()}</div>${Kit.sectionHead("問 AI", askState.chat.length ? Kit.btn("清除", { size: "sm", icon: "trash", attrs: { "data-ask-clear": "chat" } }) : "")}<div id="askChat" class="ask-chat" aria-live="polite">${askChat()}</div><form id="askForm" class="tg-form ask-form"><textarea name="q" rows="2" maxlength="500" required placeholder="例如：今晚附近有咩好食？"></textarea><label class="tg-check"><input type="checkbox" name="here" data-ask-here${askState.here ? " checked" : ""}> 附上我現在的位置</label>${Kit.btn("發問", { type: "submit", variant: "primary", icon: "sparkles", cls: "btn-block" })}</form>`;
  }
  const paintAsk = () => {
    if (current !== "ask") return;
    $("#app").innerHTML = renderAsk();
  };
  const paintAskPart = (id, html) => {
    const el = $(id);
    if (el) el.innerHTML = html;
  };
  async function translatePhoto(file) {
    if (askState.busy === "translate") return toast("上一張相片仍在翻譯中。");
    let b64;
    try {
      b64 = await window.Together.shrink(file, 1600, 0.8);
      if (b64.length > 700000) b64 = await window.Together.shrink(file, 1280, 0.7);
    } catch (e) {
      console.error(e);
      return toast("未能讀取這張相片，可以截圖再試。");
    }
    askState.busy = "translate";
    askState.photo = b64;
    paintAsk();
    try {
      const r = await window.Together.aiJob({ kind: "translate", images: [b64] });
      askState.translations.unshift({ ...r, at: Date.now() });
    } catch (e) {
      askState.photo = null;
      toast(e.message || "未能翻譯，請再試。");
    }
    askState.busy = "";
    askSave();
    paintAsk();
  }
  // Where the traveller is now (null when not allowed or too slow)
  const askHere = () =>
    new Promise((ok) =>
      navigator.geolocation
        ? navigator.geolocation.getCurrentPosition(
            (p) => ok({ lat: p.coords.latitude, lng: p.coords.longitude }),
            () => ok(null),
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
          )
        : ok(null),
    );
  // A day's forecast at its stops, or null (offline, no point, or too slow)
  async function askWeather(d) {
    const pt = dayPoint(d.n);
    if (!pt || !window.Weather) return null;
    const all = await Promise.race([window.Weather.forecast(pt.lat, pt.lng).catch(() => null), new Promise((ok) => setTimeout(ok, 4000))]);
    return all?.[isoDash(d)] || null;
  }
  // The trip as plain text for the AI: now, each day (weather, hotel, stops), saved places, hotels and events.
  async function askContext(here) {
    const now = new Date(),
      today = days.find((d) => d.iso === todayIso()),
      geo = window.TRIP_GEO?.places || {},
      dist = (p) => (here ? Math.min(...(geo[p.id] || []).map((g) => window.Nearby.distance(here, g)), Infinity) : Infinity),
      weather = await Promise.all(days.map(askWeather)),
      cut = (s, n) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);
    const lines = [
      `Trip: ${meta.name || ""} to ${meta.destination || ""}, ${days[0]?.iso || ""} to ${days.at(-1)?.iso || ""}.`,
      `Now: ${todayIso()} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}${today ? ` (D${today.n} of the trip)` : " (not during the trip)"}.`,
    ];
    if (here) {
      const near = nearestPlace(here);
      lines.push(`They are now at ${here.lat.toFixed(5)},${here.lng.toFixed(5)}${near && near.d < Infinity ? `, ${Math.round(near.d)} m from ${near.p.v[1]}` : ""}.`);
    }
    lines.push("", "Day plans:");
    days.forEach((d, i) => {
      const w = weather[i],
        stops = stopsFor(d.n).map((s) => `${s.time ? s.time + " " : ""}${s.title}`);
      lines.push(
        `D${d.n} ${d.date} ${d.region}${d.hotel ? ` · hotel ${d.hotel}` : ""}${w ? ` · weather ${window.Weather.describe(w.code).text} ${Math.round(w.min)}–${Math.round(w.max)}°C, rain ${w.rain ?? "?"}%` : ""}: ${stops.join("; ") || "(nothing planned)"}`,
      );
    });
    lines.push("", `Saved places (name | Chinese name | area | categories | highlights | price and hours${here ? " | metres from them" : ""}):`);
    places
      .filter((p) => !p.v[9]?.includes("已閉店"))
      .map((p) => ({ p, d: dist(p) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 250)
      .forEach(({ p, d }) =>
        lines.push([p.v[1], p.zh, areaOf(p) || p.v[0], p.cats.join("/"), cut(p.v[4], 80), cut(p.v[5], 80), ...(here ? [d < Infinity ? Math.round(d) : "?"] : [])].map((x) => cut(x, 80)).join(" | ")),
      );
    const hs = lists().hotels,
      evs = lists().events || [];
    if (hs.length) lines.push("", "Hotels:", ...hs.map((h) => `${h.name} · ${h.checkIn || "?"} to ${h.checkOut || "?"}${h.address ? ` · ${cut(h.address, 100)}` : ""}`));
    if (evs.length) lines.push("", "Events:", ...evs.map((e) => `${e.title} · ${e.start || "?"} to ${e.end || "?"}${e.hours ? ` · ${cut(e.hours, 60)}` : ""}${e.venue ? ` · ${cut(e.venue, 80)}` : ""}`));
    return lines.join("\n").slice(0, 60000);
  }
  async function askQuestion(q) {
    q = q.trim().slice(0, 500);
    if (!q || askState.busy === "ask") return;
    const withHere = !!$("#askForm")?.elements.here.checked,
      history = askState.chat
        .filter((m) => m.a)
        .slice(-6)
        .map(({ q, a }) => ({ q, a: a.slice(0, 1200) })),
      m = { q, busy: true, at: Date.now() };
    askState.chat.push(m);
    askState.busy = "ask";
    paintAsk();
    $("#askChat")?.lastElementChild?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    try {
      const here = withHere ? await askHere() : null;
      if (withHere && !here) toast("未能取得位置，會不附位置發問。");
      const r = await window.Together.aiJob({ kind: "ask", question: q, context: await askContext(here), history });
      Object.assign(m, { a: r.answer, places: r.places || [] });
    } catch (e) {
      m.error = e.message || "AI 暫時未能回答，請稍後再試。";
    }
    delete m.busy;
    askState.busy = "";
    askSave();
    if (current !== "ask") return;
    paintAskPart("#askChat", askChat());
    $("#askChat")?.lastElementChild?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  document.addEventListener("change", (e) => {
    if (e.target.dataset?.askHere !== undefined) askState.here = e.target.checked;
    if (e.target.dataset?.askPhoto === undefined || !e.target.files.length) return;
    translatePhoto(e.target.files[0]);
    e.target.value = "";
  });
  // A picture pasted on the page (outside the question box) is translated.
  document.addEventListener("paste", (e) => {
    if (current !== "ask" || $("#detail").open) return;
    const img = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith("image/"));
    if (!img) return;
    e.preventDefault();
    translatePhoto(img);
  });
  document.addEventListener("submit", (e) => {
    if (e.target.id !== "askForm") return;
    e.preventDefault();
    const q = e.target.elements.q.value;
    e.target.elements.q.value = "";
    askQuestion(q);
  });
  document.addEventListener("click", (e) => {
    const el = e.target.closest("button");
    if (!el || current !== "ask") return;
    if (el.dataset.askIdea) askQuestion(el.dataset.askIdea);
    if (el.dataset.askTrDel) {
      const k = Number(el.dataset.askTrDel);
      if (k === 0) askState.photo = null;
      askState.translations.splice(k, 1);
      askSave();
      paintAsk();
    }
    if (el.dataset.askClear) {
      const what = el.dataset.askClear;
      UI.confirm(what === "tr" ? "清除所有翻譯？" : "清除對話？", { danger: true, ok: "清除" }).then((ok) => {
        if (!ok) return;
        if (what === "tr") Object.assign(askState, { translations: [], photo: null });
        else askState.chat = askState.chat.filter((m) => m.busy);
        askSave();
        paintAsk();
      });
    }
  });

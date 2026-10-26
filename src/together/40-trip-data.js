  // ---- Trip data used by the trip page: places, day plans, hotels, flights, documents, favourites ----
  async function aiRoutes(data) {
    if (!navigator.onLine) throw new Error("offline");
    return (await (await callable("aiRoutes", 120000))(data)).data;
  }
  // The plan page's day tools (routes for every leg, AI arrangement, suggestions): one AI use each.
  // ✨ AI 推薦新地點 (explore page and the plan picker).
  async function discoverPlaces(data) {
    if (!navigator.onLine) throw new Error("offline");
    return (await (await callable("discoverPlaces", 120000))({ ...data, trip: tripId })).data;
  }
  async function planDay(data) {
    if (!navigator.onLine) throw new Error("offline");
    return (await (await callable("planDay", 120000))({ ...data, trip: tripId })).data;
  }
  async function suggestRoutes(data) {
    if (!navigator.onLine) throw new Error("offline");
    return (await (await callable("suggestRoutes", 45000))(data)).data;
  }
  // highlights: also ask for 必吃・必買・特色 from Google's description and reviews (place form).
  // photo: also the place's first Google Maps photo (place form, when the place has none yet).
  async function lookupPlace(url, { highlights = false, photo = false, name = "" } = {}) {
    if (!navigator.onLine) throw new Error("offline");
    return (await (await callable("lookupPlace", 70000))({ url, country: state.meta?.country || "", ...(highlights ? { highlights: true, trip: tripId } : {}), ...(photo ? { photo: true } : {}), ...(name ? { name } : {}) })).data;
  }
  // Up to 8 Google Maps photos of the linked place, to pick another one
  async function placePhotos(url, name = "") {
    if (!navigator.onLine) throw new Error("offline");
    return (await (await callable("lookupPlace", 70000))({ url, photos: true, country: state.meta?.country || "", ...(name ? { name } : {}) })).data.photos || [];
  }
  // Places: trips/{t}/places documents. A new one gets its id here so a plan stop can point at it straight away.
  function savePlace({ place, fields, cats, lat, lng, points = [], mapsUrl, photo = null, photoBy = "" }) {
    const { fs, db } = fb,
      data = { fields, cats, lat, lng, points, mapsUrl, photo: photo || null, photoBy: photo ? photoBy : "", deleted: false };
    if (place) {
      update("places", place.overlayId, data);
      toast("已儲存");
    } else {
      const ref = fs.doc(tcol("places"));
      fs.setDoc(ref, {
        ...data,
        base: null,
        by: state.user.uid,
        byName: me().name,
        at: Date.now(),
        createdAt: fs.serverTimestamp(),
      }).catch(() => toast("未能儲存，請確認你仍在旅伴名單。"));
      toast(navigator.onLine ? "已加入" : "已加入，有網絡時會自動同步");
      return "u_" + ref.id;
    }
  }
  function deletePlace(place) {
    fb.fs.deleteDoc(tdoc("places", place.overlayId)).catch(() => toast("未能刪除，請再試。"));
  }
  // Day plans: planDays/{day} holds the stop list and title of that day, and its other 方案 (variants, mainName);
  // deleting it clears the day. extra: the 方案 fields when they change.
  const planMap = () => Object.fromEntries(state.planDays.map((d) => [Number(d.id), d]));
  function savePlanDay(day, stops, extra = {}) {
    fb.fs
      .setDoc(tdoc("planDays", String(day)), { stops, ...extra, by: state.user.uid, byName: me().name, at: Date.now() }, { merge: true })
      .catch(() => toast("未能儲存行程，請再試。"));
  }
  function setDayLabel(day, label, stops, extra = {}) {
    fb.fs
      .setDoc(
        tdoc("planDays", String(day)),
        { stops, label, ...extra, by: state.user.uid, byName: me().name, at: Date.now() },
        { merge: true },
      )
      .catch(() => toast("未能儲存，請再試。"));
  }
  // Hotels, flights, shopping and notes for the trip page (住宿, 機票, 資料簿).
  const tripLists = () => ({ hotels: state.hotels, flights: state.flights, events: state.events, shopping: state.shopping, notes: state.notes });
  function saveItem(name, id, data) {
    if (id) {
      update(name, id, data);
      toast("已儲存");
    } else add(name, data);
  }
  function removeItem(name, id) {
    const docs = (state[name] || []).find((x) => x.id === id)?.docs;
    fb.fs.deleteDoc(tdoc(name, id)).then(
      () => dropPhotos(docs?.map((d) => d.path)),
      () => toast("未能刪除，請再試。"),
    );
  }
  // Booking documents for a hotel or flight (e-tickets, confirmations, screenshots): Storage trips/{t}/docs/, readable only by
  // the trip's companions (storage.rules). Photos are shrunk to JPEG; PDFs are kept as they are (under 15 MB).
  const DOC_MAX = 6,
    docItem = (kind, id) => (state[kind] || []).find((x) => x.id === id);
  async function openDocs(kind, id) {
    const x = docItem(kind, id);
    if (!x) return;
    const docs = x.docs || [],
      title = kind === "hotels" ? x.name : `${x.flightNo} ${x.from || ""} → ${x.to || ""}`;
    $("#detailBody").innerHTML =
      `<div class="eyebrow" data-docs-for="${esc(kind)}:${esc(id)}">文件</div><h2 class="detailtitle">${esc(title)}</h2><p class="note">訂單確認、電子機票或截圖，只限這個旅程的旅伴登入查看。</p><div class="doc-list">${docs.length ? docs.map((d) => `<div class="doc-row" data-doc-path="${esc(d.path)}"><div class="doc-thumb">${d.type === "application/pdf" ? "PDF" : "…"}</div><div><b>${esc(d.name)}</b><small>${esc(d.byName || "")} · ${Math.max(1, Math.round(d.size / 1024))} KB</small></div><a class="btn btn-outline btn-sm" data-doc-open hidden target="_blank" rel="noopener">打開</a>${Kit.btn(`刪除 ${esc(d.name)}`, { icon: "trash", iconOnly: true, variant: "ghost", size: "sm", attrs: { "data-doc-del": `${kind}:${id}:${d.path}` } })}</div>`).join("") : Kit.empty("還沒有文件", "可以上載訂單確認、電子機票或截圖。")}</div>${docs.length < DOC_MAX ? `${Kit.btn("上載文件（相片或 PDF）", { variant: "primary", icon: "clip", cls: "btn-block", attrs: { "data-doc-add": true } })}<input type="file" id="docInput" data-target="${esc(kind)}:${esc(id)}" accept="image/*,application/pdf" multiple hidden>` : `<p class="note">每項最多 ${DOC_MAX} 個文件。</p>`}`;
    if (!$("#detail").open) $("#detail").showModal();
    if (!docs.length) return;
    try {
      const { m, st } = await storage(),
        urls = [];
      $("#detail").addEventListener("close", () => urls.forEach(URL.revokeObjectURL), { once: true });
      await Promise.all(
        docs.map(async (d) => {
          const row = document.querySelector(`[data-doc-path="${CSS.escape(d.path)}"]`);
          try {
            const u = URL.createObjectURL(await m.getBlob(m.ref(st, d.path)));
            urls.push(u);
            if (!row) return;
            const a = row.querySelector("[data-doc-open]");
            a.href = u;
            a.hidden = false;
            if (d.type !== "application/pdf") row.querySelector(".doc-thumb").innerHTML = `<img src="${u}" alt="">`;
          } catch {
            if (row) row.querySelector(".doc-thumb").textContent = "✕";
          }
        }),
      );
    } catch (err) {
      console.error(err);
      toast(navigator.onLine ? "未能載入文件。" : "離線中，有網絡時才可查看文件。");
    }
  }
  async function uploadDocs(kind, id, files) {
    const x = docItem(kind, id);
    if (!x) return;
    const room = DOC_MAX - (x.docs?.length || 0);
    if (files.length > room) toast(`每項最多 ${DOC_MAX} 個文件，只會上載頭 ${room} 個。`);
    const added = [];
    toast("正在上載文件…");
    try {
      const { m, st } = await storage();
      for (const file of files.slice(0, room)) {
        const pdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
        if (pdf && file.size >= 15 * 1024 * 1024) {
          toast(`${file.name} 太大（上限 15 MB）`);
          continue;
        }
        const blob = pdf ? file : b64Blob(await shrink(file, 2400, 0.88)),
          type = pdf ? "application/pdf" : "image/jpeg";
        const path = `trips/${tripId}/docs/${kind}-${id}-${Date.now()}-${added.length}.${pdf ? "pdf" : "jpg"}`;
        await m.uploadBytes(m.ref(st, path), blob, { contentType: type });
        added.push({
          path,
          name: file.name.slice(0, 80),
          type,
          size: blob.size,
          by: state.user.uid,
          byName: me().name,
          at: Date.now(),
        });
      }
    } catch (err) {
      console.error(err);
      toast("有文件未能上載，請再試。");
    }
    if (!added.length) return;
    const fs = fb.fs;
    await fs
      .updateDoc(tdoc(kind, id), { docs: fs.arrayUnion ? fs.arrayUnion(...added) : [...(x.docs || []), ...added] })
      .catch(() => {
        toast("未能儲存文件，請再試。");
        dropPhotos(added.map((d) => d.path));
      });
    toast(`已上載 ${added.length} 個文件`);
  }
  async function deleteDocFile(kind, id, path) {
    const x = docItem(kind, id),
      d = x?.docs?.find((d) => d.path === path);
    if (!d || !(await UI.confirm(`刪除「${d.name}」？`, { text: "所有旅伴都會看不到這個文件。", danger: true, ok: "刪除" })))
      return;
    await fb.fs.updateDoc(tdoc(kind, id), { docs: x.docs.filter((v) => v.path !== path) }).then(
      () => dropPhotos([path]),
      () => toast("未能刪除，請再試。"),
    );
  }
  function resetPlanDay(day) {
    fb.fs.deleteDoc(tdoc("planDays", String(day))).then(
      () => toast("已清空這天"),
      () => toast("未能清空，請再試。"),
    );
  }
  // Favourites: members/{uid}.saved. The first time, seed with this device's stars.
  function syncFavorites() {
    const mine = state.members.find((m) => m.id === state.user?.uid);
    if (!mine || !started) return;
    if (Array.isArray(mine.saved)) {
      T().setSaved(mine.saved);
      return;
    }
    const seed = T().savedIds();
    saveFavorites(seed);
    T().setSaved(seed);
  }
  function saveFavorites(ids) {
    fb.fs
      .setDoc(tdoc("members", state.user.uid), { saved: ids.slice(0, 500) }, { merge: true })
      .catch(() => toast("未能同步收藏。"));
  }

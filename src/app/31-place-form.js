  // ---- 探索: place data, the place form (branches, photo, paste, 自動填寫) and duplicates ----
  // Places are trips/{t}/places documents (id "u_" + document id); each may have several pins (branches).
  function applyPlaceEdits(list) {
    const geo = {},
      clean = (o) => ({
        fields: Array.from({ length: 12 }, (_, i) => String(o.fields?.[i] ?? "")),
        cats: (o.cats || []).filter((c) => categories.includes(c)),
      });
    const out = list
      .filter((o) => !o.deleted)
      .sort((a, b) => (a.at || 0) - (b.at || 0))
      .map((o) => {
        const c = clean(o);
        // zh: Traditional Chinese name from the translateNames function, while it still matches the name
        const zh = o.zh && o.zhFor === c.fields[1] ? String(o.zh) : "";
        return { id: "u_" + o.id, overlayId: o.id, custom: true, v: c.fields, cats: c.cats, zh, mapsUrl: String(o.mapsUrl || ""), photo: o.photo || null, photoBy: String(o.photoBy || "") };
      });
    for (const o of list) {
      if (o.deleted) continue;
      const id = "u_" + o.id,
        src = o.mapsUrl || "https://www.google.com/maps",
        pts = (o.points || []).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
      if (pts.length) geo[id] = pts.map((p) => ({ lat: p.lat, lng: p.lng, label: String(p.label || ""), source: src }));
      else if (Number.isFinite(o.lat) && Number.isFinite(o.lng)) geo[id] = [{ lat: o.lat, lng: o.lng, label: "", source: src }];
    }
    places.splice(0, places.length, ...out);
    window.TRIP_GEO.places = geo;
    if (current === "explore" && $("#results")) renderResults();
    else if (current === "notebook" && $("#notebookResults")) notebookResults();
    else if (current === "nearby") nearbyResults();
    else if (current === "home") render();
    else if (current === "plan") refreshPlan();
  }
  const placeFields = [
    [2, "類型（例如：拉麵、咖啡店）", 40],
    [3, "地址／位置", 200],
    [4, "必吃・必買・特色", 1000],
    [5, "參考價格與營業時間", 1000],
    [10, "網站／參考連結", 500],
    [11, "備註與預約", 500],
  ];
  // A place can have several pins (branches): the main one from 自動填寫, others added as 分店 rows.
  const branchRow = (b = {}) =>
    `<div class="branch-row"><input name="bLabel" maxlength="60" placeholder="分店名稱" aria-label="分店名稱" value="${esc(b.label || "")}"><span class="searchrow"><input name="bUrl" class="search" inputmode="url" autocomplete="off" placeholder="Google 地圖連結" aria-label="分店 Google 地圖連結">${Kit.btn("定位", { icon: "pin", attrs: { "data-branch-find": true } })}</span><small class="branch-at">${Number.isFinite(b.lat) ? "已定位" : "未定位"}</small><input type="hidden" name="bLat" value="${b.lat ?? ""}"><input type="hidden" name="bLng" value="${b.lng ?? ""}">${Kit.btn("移除分店", { icon: "x", iconOnly: true, variant: "ghost", attrs: { "data-branch-del": true } })}</div>`;
  // plan={day,slot}: 行程「＋ 新增站點」 uses the same form, adds a time, and also saves the place to 探索.
  function placeForm(p, plan = null) {
    const v = (i) => esc(p?.v[i] || ""),
      pins = p ? window.TRIP_GEO.places[p.id] || [] : [],
      pin = pins[0],
      alt = plan && plan.slot != null ? stopsFor(plan.day)[plan.slot] : null,
      on = !!p && saved.has(p.id);
    openDialog(
      `${Kit.sheetHead(`${plan ? (alt ? "加入同一時間的選擇" : "新增站點") : p ? "修改地點" : "新增地點"}${favStar(on)}`, plan ? `D${plan.day}` : "")}${plan ? `<p class="note">${alt ? `與「${esc(alt.title)}」同在 ${esc(alt.time || "這個時段")}。` : `${esc(days[plan.day - 1].date)} · ${esc(days[plan.day - 1].region)}。`}地點會同時加入「探索」。</p>` : ""}<form class="tg-form" id="placeForm" data-id="${p ? esc(p.id) : ""}"${plan ? ` data-day="${plan.day}" data-slot="${plan.slot ?? ""}"` : ""}><div id="placePhotoBox">${placePhotoHtml(p?.photo, p?.photoBy)}</div>${plan && !alt ? '<label>時間（可留空，留空會放在最後）<input name="time" maxlength="30" placeholder="例如：12:00–13:00"></label>' : ""}<label>Google 地圖連結<span class="searchrow"><input name="mapsUrl" class="search" inputmode="url" autocomplete="off" placeholder="貼上 Google 地圖分享連結" value="${esc(p?.mapsUrl || "")}">${Kit.btn("自動填寫", { variant: "secondary", icon: "sparkles", attrs: { id: "placeLookup" } })}</span></label><p class="note" id="placeLookupInfo">在 Google 地圖按「分享」→ 複製連結，貼上後按「自動填寫」。只會填入空白欄位；類型、「必吃・必買・特色」及「參考價格與營業時間」由 AI 按 Google 資料及評論整理。</p><label>名稱<input name="f1" required maxlength="80" value="${v(1)}"></label><fieldset><legend>分類</legend>${categories.map((c) => `<label class="tg-check"><input type="checkbox" name="cats" value="${c}"${p?.cats.includes(c) ? " checked" : ""}> ${c}</label>`).join("")}</fieldset><label>區域<input name="f0" list="placeRegions" maxlength="60" required value="${v(0)}"><datalist id="placeRegions">${[...new Set(places.map((x) => x.v[0]).filter(Boolean))].map((r) => `<option value="${esc(r)}">`).join("")}</datalist></label>${placeFields.map(([i, label, max]) => `<label>${label}${max > 200 ? `<textarea name="f${i}" rows="3" maxlength="${max}">${v(i)}</textarea>` : `<input name="f${i}" maxlength="${max}" value="${v(i)}">`}</label>`).join("")}<input type="hidden" name="photo" value="${esc(p?.photo || "")}"><input type="hidden" name="photoBy" value="${esc(p?.photoBy || "")}"><input type="hidden" name="lat" value="${pin ? pin.lat : ""}"><input type="hidden" name="lng" value="${pin ? pin.lng : ""}"><input type="hidden" name="mainLabel" value="${esc(pin?.label || "")}"><fieldset class="branches"><legend>其他分店／地址</legend><div id="branchRows">${pins.slice(1).map(branchRow).join("")}</div>${Kit.btn("加入分店／地址", { size: "sm", icon: "plus", attrs: { "data-branch-add": true } })}<p class="note">每個分店貼上 Google 地圖連結後按「定位」。附近頁會用最近的分店計算距離。</p></fieldset><input type="hidden" name="fav" value="${on ? "1" : ""}">${Kit.btn(plan ? "加入行程及探索" : p ? "儲存修改" : "加入地點", { type: "submit", variant: "primary", cls: "btn-block" })}</form>`,
    );
  }
  // The form's ★ beside the title: kept in the hidden fav field, saved to 收藏 with the place
  const favStar = (on) =>
    `<button type="button" class="save btn btn-ghost btn-icon form-fav${on ? " saved" : ""}" data-place-fav aria-pressed="${on}" aria-label="${on ? "取消收藏" : "加入我的收藏"}">${icon("star")}</button>`;
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-place-fav]"),
      f = $("#placeForm");
    if (!b || !f) return;
    const on = !f.elements.fav.value;
    f.elements.fav.value = on ? "1" : "";
    b.classList.toggle("saved", on);
    b.setAttribute("aria-pressed", on);
    b.setAttribute("aria-label", on ? "取消收藏" : "加入我的收藏");
    toast(on ? "儲存地點時會加入收藏" : "儲存地點時不加入收藏");
  });
  async function findBranch(row) {
    const url = row.querySelector("[name=bUrl]").value.trim(),
      at = row.querySelector(".branch-at");
    if (!url) return toast("請先貼上分店的 Google 地圖連結。");
    at.textContent = "查詢中…";
    try {
      const r = await window.Together.lookupPlace(url);
      if (!Number.isFinite(r.lat)) throw new Error("no location");
      row.querySelector("[name=bLat]").value = r.lat;
      row.querySelector("[name=bLng]").value = r.lng;
      const lab = row.querySelector("[name=bLabel]");
      if (!lab.value.trim()) lab.value = r.name || "";
      at.textContent = r.address || "已定位";
    } catch (e) {
      at.textContent =
        fnError(e, "未能定位");
    }
  }
  // The place form's photo (from 自動填寫): kept in hidden fields, shown with its Google credit and a remove button.
  // A wrong photo: pick another of the place's Google Maps photos, or upload one's own.
  const OWN_PHOTO = "旅伴上載";
  const photoCredit = (by) => (by === OWN_PHOTO ? "相片：旅伴上載" : by ? `相片：${by} · Google 地圖` : "相片：Google 地圖");
  const placePhotoHtml = (photo, by) =>
    `${
      photo
        ? `<figure class="place-photo"><img src="data:image/jpeg;base64,${photo}" alt=""><figcaption>${esc(photoCredit(by))}</figcaption>${Kit.btn("移除相片", { icon: "x", iconOnly: true, size: "sm", cls: "place-photo-del", attrs: { "data-place-photo-del": true } })}</figure>`
        : ""
    }<div class="place-photo-actions">${Kit.btn(photo ? "換 Google 相片" : "選 Google 相片", { size: "sm", variant: "secondary", icon: "image", attrs: { "data-place-photo-pick": true } })}${Kit.fileBtn("上載相片", { size: "sm", variant: "secondary", icon: "camera", input: { "data-place-photo-file": true } })}</div><div id="placePhotoPick"></div>`;
  async function pickPlacePhoto() {
    const f = $("#placeForm"),
      box = $("#placePhotoPick"),
      url = f.elements.mapsUrl.value.trim();
    if (!url) return toast("請先貼上 Google 地圖連結。");
    box.innerHTML = Kit.progress({ text: "正在載入 Google 地圖相片…", seconds: 8 });
    try {
      const list = await window.Together.placePhotos(url, `${f.elements.f1.value} ${f.elements.f3.value}`.trim());
      pickedPhotos = list;
      if (!$("#placePhotoPick")) return;
      $("#placePhotoPick").innerHTML = list.length
        ? `<p class="note">揀一張做地點相片：</p><div class="photo-pick">${list.map((p, k) => `<button type="button" data-place-photo-use="${k}" aria-label="用第 ${k + 1} 張相片"><img src="data:image/jpeg;base64,${p.photo}" alt=""></button>`).join("")}</div>`
        : '<p class="note">Google 地圖沒有這個地點的其他相片，可以上載自己的相片。</p>';
    } catch (e) {
      console.error(e);
      if ($("#placePhotoPick")) $("#placePhotoPick").innerHTML = `<p class="note">${esc(fnError(e, "未能載入相片，請稍後再試。"))}</p>`;
    }
  }
  let pickedPhotos = [];
  async function uploadPlacePhoto(file) {
    if (!file) return;
    try {
      let b64 = await window.Together.shrink(file, 640, 0.75);
      if (b64.length > 300000) b64 = await window.Together.shrink(file, 480, 0.65);
      setPlacePhoto(b64, OWN_PHOTO);
    } catch (e) {
      console.error(e);
      toast("未能讀取這張相片，請換一張再試。");
    }
  }
  document.addEventListener("change", (e) => {
    if (e.target.matches("[data-place-photo-file]")) uploadPlacePhoto(e.target.files[0]);
  });
  // Shared to the installed app from Google Maps (manifest.webmanifest share_target opens ./?title=…&text=…&url=…): the
  // address loses its query and turns to 探索; after the first render, the link opens 新增地點 as if pasted.
  function takeSharedLink() {
    const q = new URLSearchParams(location.search);
    if (!["url", "text", "title"].some((k) => q.has(k))) return null;
    history.replaceState(null, "", location.pathname + "#explore");
    return ["url", "text", "title"].map((k) => q.get(k) || "").join(" ").match(/https?:\/\/\S+/)?.[0] || "";
  }
  function addSharedLink(link) {
    if (!Kit.isMapsLink(link)) return toast("請在 Google 地圖按「分享」，再選口袋旅伴。");
    placeForm(null);
    $("#placeForm").elements.mapsUrl.value = link;
    lookupPlaceForm();
  }
  // Pasted anywhere on 探索 (or into its search box): a Google Maps link opens 新增地點 and runs 自動填寫; a picture opens
  // it with that photo. Duplicates are caught when saving (placeDuplicate).
  document.addEventListener("paste", (e) => {
    const t = e.target;
    if (current !== "explore" || $("#detail").open || (t.matches?.("input, textarea, select") && t.id !== "search")) return;
    const img = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith("image/")),
      text = (e.clipboardData?.getData("text") || "").trim();
    if (img) {
      e.preventDefault();
      placeForm(null);
      uploadPlacePhoto(img);
      return;
    }
    if (!/^https?:\/\/\S+$/i.test(text)) return;
    e.preventDefault();
    if (!Kit.isMapsLink(text)) return toast("請貼上 Google 地圖連結。");
    placeForm(null);
    $("#placeForm").elements.mapsUrl.value = text;
    lookupPlaceForm();
  });
  function setPlacePhoto(photo, by = "") {
    const f = $("#placeForm");
    if (!f) return;
    f.elements.photo.value = photo || "";
    f.elements.photoBy.value = photo ? by : "";
    $("#placePhotoBox").innerHTML = placePhotoHtml(photo, by);
  }
  function lookupPlaceForm() {
    const f = $("#placeForm"),
      el = f.elements,
      // The AI write-up (類型, 必吃・必買・特色, 參考價格與營業時間) is asked for only while one of them is empty (one AI use).
      wantHighlights = ["f2", "f4", "f5"].some((k) => !el[k].value.trim());
    return mapsAutofill(f, {
      btn: $("#placeLookup"),
      info: $("#placeLookupInfo"),
      opts: { highlights: wantHighlights, photo: !el.photo.value, name: `${el.f1.value} ${el.f3.value}`.trim() },
      seconds: wantHighlights ? 12 : 5,
      wait: wantHighlights ? "正在查詢 Google 地圖，並由 AI 整理評論…" : "正在查詢 Google 地圖…",
      fill: (r, put) => {
        put("f1", r.name);
        put("f2", r.type);
        put("f3", r.address);
        put("f4", r.highlights);
        if (r.photo && !el.photo.value) setPlacePhoto(r.photo, r.photoBy);
        put("f5", r.priceHours || [r.price && "價格：" + r.price, r.hours && "時間：\n" + r.hours].filter(Boolean).join("\n"));
        put("f10", [r.website, r.tabelog, r.mapsUrl].filter(Boolean).join("\n"));
        if (r.category && ![...el.cats].some((c) => c.checked)) [...el.cats].forEach((c) => (c.checked = c.value === r.category));
        if (Number.isFinite(r.lat) && Number.isFinite(r.lng)) {
          el.lat.value = r.lat;
          el.lng.value = r.lng;
          const near = nearestPlace(r, places.filter((p) => p.v[0]));
          if (near && near.d < 8000) put("f0", near.p.v[0]);
        }
        put("f0", r.district);
        if (r.highlights || r.priceHours) return "已填入。類型、「必吃・必買・特色」及「參考價格與營業時間」由 AI 按 Google 資料及評論整理，請檢查後按儲存。";
      },
    });
  }
  // Already in 探索: the same Google place, the same or a similar name (without spaces, brackets or punctuation), or a
  // pin within 20 m
  function placeDuplicate(name, mapsUrl, lat, lng, except) {
    const bare = (t) =>
        String(t || "")
          .toLowerCase()
          .replace(/[（(][^）)]*[)）]/g, "")
          .replace(/[\s【】「」『』・･,，、.。:：\-－−&＆’']/g, ""),
      gid = (u) => String(u || "").match(/(?:query_place_id=|place_id[:=]|!1s)([\w:-]{10,})/)?.[1] || "",
      n = bare(name),
      id = gid(mapsUrl),
      pt = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
    return places.find((x) => {
      if (x.id === except) return false;
      const m = bare(x.v[1]),
        z = bare(x.zh);
      if (id && id === gid(x.mapsUrl)) return true;
      if (n.length >= 2 && (m === n || z === n || (Math.min(n.length, m.length) >= 4 && (m.includes(n) || n.includes(m))))) return true;
      return pt && window.Nearby && (window.TRIP_GEO.places[x.id] || []).some((g) => window.Nearby.distance(pt, g) <= 20);
    });
  }
  function savePlaceForm(f) {
    const v = new FormData(f),
      cats = v.getAll("cats").map(String);
    if (!cats.length) return toast("請最少選一個分類。");
    const dup = !f.dataset.dupOk && placeDuplicate(v.get("f1"), v.get("mapsUrl"), parseFloat(v.get("lat")), parseFloat(v.get("lng")), f.dataset.id);
    if (dup)
      return UI.confirm("探索已有相似地點", {
        text: `「${dup.v[1]}」${dup.v[0] ? ` · ${dup.v[0]}` : ""}，仍然${f.dataset.id ? "儲存" : "加入"}？`,
        ok: f.dataset.id ? "仍然儲存" : "仍然加入",
      }).then((ok) => {
        if (!ok) return;
        f.dataset.dupOk = "1";
        savePlaceForm(f);
      });
    const p = places.find((x) => x.id === f.dataset.id),
      fields = Array.from({ length: 12 }, (_, i) => String(p?.v[i] ?? ""));
    for (const i of [0, 1, ...placeFields.map(([i]) => i)]) fields[i] = String(v.get("f" + i) || "").trim();
    fields[6] = cats[0];
    if (!p) {
      fields[7] = "旅伴新增";
      fields[9] = new Date().toISOString().slice(0, 10) + "｜旅伴新增";
    }
    const lat = parseFloat(v.get("lat")),
      lng = parseFloat(v.get("lng"));
    const bl = v.getAll("bLabel"),
      blat = v.getAll("bLat"),
      blng = v.getAll("bLng"),
      branches = bl
        .map((label, k) => ({ lat: parseFloat(blat[k]), lng: parseFloat(blng[k]), label: String(label).trim().slice(0, 60) }))
        .filter((b) => Number.isFinite(b.lat) && Number.isFinite(b.lng));
    const main =
        Number.isFinite(lat) && Number.isFinite(lng) ? [{ lat, lng, label: String(v.get("mainLabel") || "").slice(0, 60) }] : [],
      points = [...main, ...branches].slice(0, 10);
    const newId = window.Together.savePlace({
      place: p,
      fields,
      cats,
      lat: Number.isFinite(lat) ? lat : (points[0]?.lat ?? null),
      lng: Number.isFinite(lng) ? lng : (points[0]?.lng ?? null),
      points: points.length > 1 ? points : [],
      mapsUrl: String(v.get("mapsUrl") || "")
        .trim()
        .slice(0, 500),
      photo: String(v.get("photo") || "") || null,
      photoBy: String(v.get("photoBy") || "").slice(0, 60),
    });
    const id = newId || p?.id;
    if (id && !!v.get("fav") !== saved.has(id)) markSaved(id, !!v.get("fav"));
    if (f.dataset.linkShop && newId) window.Together.linkShopping(f.dataset.linkShop.split(","), newId);
    if (f.dataset.day && newId) {
      // Also a plan stop for that place (as an alternative of a time slot, or at the time entered).
      const day = Number(f.dataset.day),
        list = stopsFor(day),
        url = urlList(fields[10])[0] || "",
        time = String(v.get("time") || "")
          .trim()
          .slice(0, 30);
      const stop = {
        time,
        area: fields[0],
        title: fields[1],
        detail: fields[4],
        transport: "",
        ref: url,
        target: `${fields[1]} ${fields[3]}`.trim(),
        placeId: newId,
        ...(points[0] ? { lat: points[0].lat, lng: points[0].lng } : {}),
      };
      if (f.dataset.slot !== "") {
        const at = slotEnd(list, Number(f.dataset.slot));
        stop.time = list[at].time;
        savePlan(day, [...list.slice(0, at + 1), stop, ...list.slice(at + 1)]);
      } else savePlan(day, insertByTime(list, stop));
    }
    $("#detail").close();
  }
  document.addEventListener("submit", (e) => {
    if (e.target.id === "placeForm") {
      e.preventDefault();
      savePlaceForm(e.target);
    }
  });
  function bindExplore() {
    renderResults();
    $("#search").addEventListener("input", (e) => {
      search = e.target.value;
      renderResults();
    });
    $("#region").addEventListener("change", (e) => {
      region = e.target.value;
      renderResults();
    });
  }

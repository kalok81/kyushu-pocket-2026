  // ---- Pages, navigation and the shared click handler; renders the first page ----
  const sectionViews = {
    home: renderHome,
    plan: renderPlan,
    hotels: renderHotels,
    explore: renderExplore,
    nearby: renderNearby,
    flights: renderFlights,
    events: renderEvents,
    jrpass: renderJrPass,
    ask: renderAsk,
    notebook: renderNotebook,
    shopping: () => window.Together.renderShopping(),
    trips: () => window.Together.renderTrips(),
    together: () =>
      window.Together
        ? window.Together.render()
        : header("共用") + Kit.empty("未能載入共用功能", "請重新整理網頁。"),
  };
  window.TripApp = Object.freeze({
    days,
    places,
    refreshLists,
    shoppingChanged,
    applyPlaceEdits,
    applyPlanEdits,
    setSaved,
    savedIds: () => [...saved],
  });
  // Pages without a tab of their own light up the tab they are reached from.
  const navOf = { nearby: "explore", hotels: "home", flights: "home", events: "home", jrpass: "home", ask: "home" };
  function setActive(view) {
    current = view;
    document.querySelectorAll(".bottomnav a").forEach((a) => {
      const active = a.dataset.view === (navOf[view] || view);
      a.classList.toggle("active", active);
      if (active) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    $("#sourceBtn").classList.toggle("active", view === "notebook");
  }
  function refreshExplore() {
    $("#app").innerHTML = renderExplore();
    bindExplore();
  }
  function refreshNotebook() {
    $("#app").innerHTML = current === "home" ? renderHome() + footer() : renderNotebook();
    bindNotebook();
  }
  function navigate() {
    render();
  }
  function render() {
    const [v, qs] = (location.hash.slice(1) || "home").split("?"),
      params = new URLSearchParams(qs),
      view = Object.hasOwn(sectionViews, v) ? v : "home";
    if (params.has("category")) category = exploreCats.includes(params.get("category")) ? params.get("category") : "全部";
    if (params.has("day")) selectedDay = Math.min(days.length, Math.max(1, Number(params.get("day")) || 1));
    setActive(view);
    Kit.close();
    $("#app").innerHTML = sectionViews[view]() + (view === "home" ? footer() : "");
    if (view === "explore") bindExplore();
    if (view === "notebook" || view === "home") bindNotebook();
    if (view === "nearby") nearbyResults();
    if (view === "plan") paintWeather();
    window.Together?.refresh();
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  $("#detail .dialog-close").onclick = () => $("#detail").close();
  // ☰ menu: the pages without a tab, sharing, and the signed-in account.
  function openMenu() {
    const row = (href, ic, title, sub) => Kit.row({ href, lead: icon(ic), title, sub, trail: icon("chevron") });
    Kit.open(
      `${Kit.sheetHead(esc(meta.name || "口袋旅伴"), "選單")}<nav class="list plain" aria-label="更多頁面">${row("#trips", "suitcase", "我的旅程", "切換、建立或複製旅程，邀請旅伴")}${row("#hotels", "bed", "住宿", `${lists().hotels.length} 間住宿`)}${row("#flights", "plane", "機票", `${lists().flights.length} 個航班`)}${row("#events", "ticket", "活動", `${lists().events?.length || 0} 個活動`)}${row("#ask", "sparkles", "AI 助手", "影相翻譯菜單、問旅程問題")}${row("#nearby", "locate", "附近", "100／200／500 米內的地點")}${row("#notebook", "book", "資料簿", "搜尋所有旅程資料")}${Kit.row({ lead: icon("share"), title: "分享連結", sub: "給已加入旅程的旅伴", attrs: { id: "shareBtn" } })}</nav>${window.Together?.account?.() || ""}`,
    );
  }
  $("#menuBtn").onclick = openMenu;
  document.addEventListener("click", async (e) => {
    if (!e.target.closest("#shareBtn")) return;
    const url = location.origin + location.pathname + location.hash;
    try {
      if (navigator.share) await navigator.share({ title: document.title, url });
      else {
        await navigator.clipboard.writeText(url);
        toast("已複製連結，可以分享給旅伴。");
      }
    } catch (e) {
      if (e.name !== "AbortError") toast("請複製瀏覽器網址分享。");
    }
  });
  document.addEventListener("click", async (e) => {
    const el = e.target.closest("button");
    if (!el) return;
    if (el.id === "locateNow" || el.dataset.locate !== undefined) locateNearby();
    if (el.dataset.radius) {
      nearbyState.radius = Number(el.dataset.radius);
      refreshNearby();
    }
    if (el.dataset.nearCategory) {
      nearbyState.category = el.dataset.nearCategory;
      refreshNearby();
    }
    if (el.id === "pickOnMap") openMapPicker();
    if (el.id === "nearbyCoverage") nearbyCoverage();
    if (el.dataset.place) placeDetail(el.dataset.place);
    if (el.dataset.placeNew !== undefined) placeForm(null);
    if (el.dataset.hotelNew !== undefined) hotelForm(null);
    if (el.dataset.hotelEdit) hotelForm(lists().hotels.find((h) => h.id === el.dataset.hotelEdit));
    if (el.id === "hotelLookup") lookupHotel();
    if (el.dataset.hotelDel) {
      const id = el.dataset.hotelDel;
      UI.confirm("刪除這個住宿？", { danger: true, ok: "刪除" }).then((ok) => ok && window.Together.removeItem("hotels", id));
    }
    if (el.dataset.flightNew !== undefined) flightForm(null);
    if (el.dataset.flightEdit) flightForm(lists().flights.find((f) => f.id === el.dataset.flightEdit));
    if (el.dataset.flightDel) {
      const id = el.dataset.flightDel;
      UI.confirm("刪除這個航班？", { danger: true, ok: "刪除" }).then((ok) => ok && window.Together.removeItem("flights", id));
    }
    if (el.dataset.planPrint !== undefined) printPlan();
    if (el.dataset.dayMap !== undefined) {
      const d = days[selectedDay - 1];
      const stops = routeStops(selectedDay);
      if (!stops.length) return toast("這天的站點未有位置，未能顯示地圖。");
      window.MapPicker.route({ title: `DAY ${d.n} · ${d.region}`, stops, openDialog, esc, lines: streetLines, transit: (a, b, box) => transitFrame(box, a, b) });
    }
    if (el.dataset.dayLabel !== undefined) {
      const day = selectedDay;
      UI.prompt("這天的標題", days[day - 1].region, "例如：首爾市區、濟州").then((label) => {
        if (label != null && label.trim()) window.Together.setDayLabel(day, label.trim().slice(0, 40), (planEdits[day]?.stops || []).map(stopFields));
      });
    }
    if (el.dataset.placePlan) {
      const p = places.find((x) => x.id === el.dataset.placePlan);
      if (p) addPlaceToPlan(p);
    }
    if (el.dataset.stopNew !== undefined) placeForm(null, { day: selectedDay, slot: null });
    if (el.dataset.planPick !== undefined) pickPlaceForPlan(selectedDay);
    if (el.dataset.ppCat) {
      ppCat = el.dataset.ppCat;
      document.querySelectorAll("[data-pp-cat]").forEach((b) => {
        b.classList.toggle("active", b.dataset.ppCat === ppCat);
        b.setAttribute("aria-pressed", b.dataset.ppCat === ppCat);
      });
      ppResults();
    }
    if (el.dataset.ppAdd) addPickedPlace(el.dataset.ppAdd);
    if (el.dataset.spotExplore) {
      const sp = buySpots[Number(el.dataset.spotExplore)];
      if (sp) {
        placeForm(null);
        $("#placeForm").dataset.linkShop = sp.ids.join(",");
        const f = $("#placeForm").elements;
        f.f1.value = sp.name;
        if (sp.address && sp.address !== sp.name) f.f3.value = sp.address;
        if (Number.isFinite(sp.lat)) {
          f.lat.value = sp.lat;
          f.lng.value = sp.lng;
        }
        const c = [...f.cats].find((x) => x.value === "商店");
        if (c) c.checked = true;
        const a = Number.isFinite(sp.lat) && areaAt(sp);
        if (a) f.f0.value = a;
      }
    }
    if (el.dataset.ppHotel) addPickedPlace(el.dataset.ppHotel, true);
    if (el.dataset.ppSpot) {
      const sp = ppSpots[Number(el.dataset.ppSpot)];
      if (sp) sp.placeId ? addPickedPlace(sp.placeId) : addPickedPlace(null, false, sp);
    }
    if (el.dataset.stopAlt) pickPlaceForPlan(selectedDay, Number(el.dataset.stopAlt));
    if (el.dataset.routeLink) {
      const gs = stopGroups(stopsFor(selectedDay)),
        n = Number(el.dataset.routeLink);
      if (gs[n]) routeDialog(selectedDay, gs[n][0].i, gs[n - 1] || [], gs[n]);
    }
    if (el.dataset.stopOwn) placeForm(null, { day: selectedDay, slot: Number(el.dataset.stopOwn) });
    if (el.dataset.stopEdit) stopForm(selectedDay, Number(el.dataset.stopEdit));
    // Deleting a stop takes effect at once; the undo bar puts the day back as it was.
    if (el.dataset.stopDelete) {
      const i = Number(el.dataset.stopDelete),
        day = selectedDay,
        before = stopsFor(day);
      if (before[i]) {
        savePlan(
          day,
          before.filter((_, j) => j !== i),
        );
        Kit.snack(`已刪除「${before[i].title}」`, { action: "復原" }).then((undo) => undo && savePlan(day, before));
      }
    }
    if (el.dataset.stopMove) {
      const [i, dir] = el.dataset.stopMove.split(":").map(Number),
        list = [...stopsFor(selectedDay)],
        j = i + dir;
      if (list[j]) {
        [list[i], list[j]] = [list[j], list[i]];
        savePlan(selectedDay, list);
      }
    }
    if (el.dataset.planReset !== undefined) {
      const day = selectedDay;
      // a 方案 other than the main one: only its stops; the main one: the whole day (all its 方案 and title)
      if (viewedVariant(day)) UI.confirm("清空這個方案？", { text: "主要方案不受影響。", danger: true, ok: "清空" }).then((ok) => ok && savePlan(day, []));
      else
        UI.confirm("清空這天？", { text: `這天的站點及標題會刪除${variantsOf(day).length ? "，其他方案亦會刪除" : ""}。`, danger: true, ok: "清空" }).then(
          (ok) => ok && window.Together.resetPlanDay(day),
        );
    }
    if (el.dataset.planVariant) {
      planView = { ...planView, [selectedDay]: el.dataset.planVariant === "main" ? null : el.dataset.planVariant };
      refreshPlan();
    }
    if (el.dataset.planVariantNew !== undefined) newVariant(selectedDay);
    if (el.dataset.planVariantRename !== undefined) renameVariant(selectedDay);
    if (el.dataset.planVariantMain !== undefined) makeMainVariant(selectedDay);
    if (el.dataset.planVariantDel !== undefined) deleteVariant(selectedDay);
    if (el.dataset.placeEdit) placeForm(places.find((p) => p.id === el.dataset.placeEdit));
    if (el.id === "placeLookup") lookupPlaceForm();
    if (el.dataset.placePhotoDel !== undefined) setPlacePhoto(null);
    if (el.dataset.placePhotoPick !== undefined) pickPlacePhoto();
    if (el.dataset.placePhotoUse) {
      const p = pickedPhotos[Number(el.dataset.placePhotoUse)];
      p && setPlacePhoto(p.photo, p.photoBy);
    }
    if (el.dataset.branchAdd !== undefined) {
      $("#branchRows").insertAdjacentHTML("beforeend", branchRow());
      $("#branchRows").lastElementChild.querySelector("input").focus();
    }
    if (el.dataset.branchFind !== undefined) findBranch(el.closest(".branch-row"));
    if (el.dataset.branchDel !== undefined) el.closest(".branch-row").remove();
    if (el.id === "stopLookup") lookupStopForm();
    if (el.dataset.placeDelete) {
      const p = places.find((x) => x.id === el.dataset.placeDelete);
      if (p)
        UI.confirm(`刪除「${p.v[1]}」？`, { text: "所有旅伴都會看不到這個地點。", danger: true, ok: "刪除" }).then((ok) => {
          if (ok) {
            window.Together.deletePlace(p);
            $("#detail").close();
          }
        });
    }
    if (el.dataset.save) {
      const id = el.dataset.save;
      markSaved(id, !saved.has(id));
      // the star in an open place sheet follows too
      $("#detailBody")
        .querySelectorAll(`[data-save="${id}"]`)
        .forEach((b) => {
          b.classList.toggle("saved", saved.has(id));
          b.setAttribute("aria-pressed", saved.has(id));
        });
    }
    if (el.dataset.cat) {
      category = el.dataset.cat;
      refreshExplore();
    }
    if (el.id === "savedToggle") {
      onlySaved = !onlySaved;
      refreshExplore();
    }
    if (el.id === "resetFilters") {
      category = "全部";
      region = "全部區域";
      search = "";
      onlySaved = false;
      refreshExplore();
    }
    if (el.dataset.day) {
      const n = Number(el.dataset.day);
      if (location.hash === "#plan?day=" + n) render();
      else location.hash = "plan?day=" + n;
    }
    if (el.dataset.notebookType) {
      notebookType = el.dataset.notebookType;
      refreshNotebook();
    }
    if (el.id === "notebookReset") {
      notebookSearch = "";
      notebookType = "全部";
      notebookRegion = "全部區域";
      refreshNotebook();
    }
    if (el.dataset.notebookRecord) notebookDetail(el.dataset.notebookRecord);
    if (el.dataset.copy) {
      try {
        await navigator.clipboard.writeText(el.dataset.copy);
        toast("已複製地址");
      } catch {
        toast("請在地址上長按複製");
      }
    }
  });
  // A tap anywhere on an explore card opens the place (its own buttons and links keep their job).
  document.addEventListener("click", (e) => {
    const card = e.target.closest("[data-card-place]");
    if (card && !e.target.closest("a,button,summary,details")) placeDetail(card.dataset.cardPlace);
  });
  document.addEventListener("click", (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (a && a.getAttribute("href") === location.hash) {
      e.preventDefault();
      navigate();
    }
  });
  window.addEventListener("hashchange", () => navigate());
  const shared = takeSharedLink();
  render();
  if (shared !== null) addSharedLink(shared);

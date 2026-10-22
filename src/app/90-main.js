  // ---- Pages, navigation and the shared click handler; renders the first page ----
  const sectionViews = {
    home: renderHome,
    plan: renderPlan,
    hotels: renderHotels,
    explore: renderExplore,
    nearby: renderNearby,
    flights: renderFlights,
    notebook: renderNotebook,
    shopping: () => window.Together.renderShopping(),
    trips: () => window.Together.renderTrips(),
    together: () =>
      window.Together
        ? window.Together.render()
        : header("TOGETHER", "一起記，一起走。") + '<div class="empty"><h2>未能載入共用功能</h2><p>請重新整理網頁。</p></div>',
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
  function setActive(view) {
    current = view;
    document.querySelectorAll(".bottomnav a").forEach((a) => {
      const active = a.dataset.view === view;
      a.classList.toggle("active", active);
      if (active) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    $("#sourceBtn").classList.toggle("active", view === "notebook");
  }
  function sourceList() {
    if ($("#detail").open) $("#detail").close();
    if (location.hash === "#notebook") navigate();
    else location.hash = "notebook";
  }
  function refreshExplore() {
    $("#app").innerHTML = renderExplore() + footer();
    bindExplore();
  }
  function refreshNotebook() {
    $("#app").innerHTML = renderNotebook() + footer();
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
    openStop = null; // a page opened afresh shows no stop's edit buttons
    $("#app").innerHTML = sectionViews[view]() + footer();
    if (view === "explore") bindExplore();
    if (view === "notebook") bindNotebook();
    if (view === "nearby") nearbyResults();
    if (view === "plan") paintWeather();
    window.Together?.refresh();
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  $("#sourceBtn").onclick = sourceList;
  $("#detail .dialog-close").onclick = () => $("#detail").close();
  $("#detail").addEventListener("click", (e) => {
    if (e.target === $("#detail")) $("#detail").close();
  });
  $("#shareBtn").onclick = async () => {
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
  };
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
      window.MapPicker.route({ title: `DAY ${d.n} · ${d.region}`, stops: routeStops(selectedDay), openDialog, esc });
    }
    if (el.dataset.dayLabel !== undefined) {
      const day = selectedDay;
      UI.prompt("這天的標題", days[day - 1].region, "例如：首爾市區、濟州").then((label) => {
        if (label != null && label.trim()) window.Together.setDayLabel(day, label.trim().slice(0, 40), stopsFor(day));
      });
    }
    if (el.dataset.placePlan) {
      const p = places.find((x) => x.id === el.dataset.placePlan);
      if (p) addPlaceToPlan(p);
    }
    if (el.dataset.stopMore) {
      const i = Number(el.dataset.stopMore);
      openStop = openStop === i ? null : i;
      refreshPlan();
    }
    if (el.dataset.stopNew !== undefined) placeForm(null, { day: selectedDay, slot: null });
    if (el.dataset.planPick !== undefined) pickPlaceForPlan(selectedDay);
    if (el.dataset.ppCat) {
      ppCat = el.dataset.ppCat;
      document.querySelectorAll("[data-pp-cat]").forEach((b) => b.classList.toggle("active", b.dataset.ppCat === ppCat));
      ppResults();
    }
    if (el.dataset.ppAdd) addPickedPlace(el.dataset.ppAdd);
    if (el.dataset.spotExplore) {
      const sp = buySpots[Number(el.dataset.spotExplore)];
      if (sp) {
        placeForm(null);
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
    if (el.dataset.stopDelete) {
      const i = Number(el.dataset.stopDelete),
        list = stopsFor(selectedDay);
      {
        const day = selectedDay;
        UI.confirm(`刪除「${list[i]?.title}」？`, { danger: true, ok: "刪除" }).then((ok) => {
          if (ok) {
            openStop = null;
            savePlan(
              day,
              stopsFor(day).filter((_, j) => j !== i),
            );
          }
        });
      }
    }
    if (el.dataset.stopMove) {
      const [i, dir] = el.dataset.stopMove.split(":").map(Number),
        list = [...stopsFor(selectedDay)],
        j = i + dir;
      if (list[j]) {
        [list[i], list[j]] = [list[j], list[i]];
        openStop = j;
        savePlan(selectedDay, list);
      }
    }
    if (el.dataset.planReset !== undefined) {
      const day = selectedDay;
      UI.confirm("清空這天？", { text: "這天的站點及標題會刪除。", danger: true, ok: "清空" }).then(
        (ok) => ok && window.Together.resetPlanDay(day),
      );
    }
    if (el.dataset.placeEdit) placeForm(places.find((p) => p.id === el.dataset.placeEdit));
    if (el.id === "placeLookup") lookupPlaceForm();
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
      saved.has(id) ? saved.delete(id) : saved.add(id);
      const ok = storage.set("kyushu-saved-v1", [...saved]);
      window.Together?.saveFavorites([...saved]);
      if ($("#results")) renderResults();
      if ($("#notebookResults")) notebookResults();
      if (current === "nearby") nearbyResults();
      if (!ok) toast("瀏覽器未允許儲存；收藏只保留至本次離開。");
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
      openStop = null;
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
  document.addEventListener("click", (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (a && a.getAttribute("href") === location.hash) {
      e.preventDefault();
      navigate();
    }
  });
  window.addEventListener("hashchange", () => navigate());
  render();

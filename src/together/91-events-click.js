  // ---- Click handlers for the together pages ----
  document.addEventListener("click", (e) => {
    const el = e.target.closest("button");
    if (!el) return;
    const d = el.dataset;
    if (d.tg === "login") login();
    if (d.tg === "logout" && fb) logout();
    if (d.tg === "scan") $("#tgReceipt")?.click();
    if (d.draftDrop) {
      const id = d.draftDrop;
      UI.confirm("捨棄這張收據？", { danger: true, ok: "捨棄" }).then((ok) => {
        if (!ok) return;
        const j = jobs.find((x) => x.id === id);
        fb.fs.deleteDoc(jobRef(id)).then(
          () => dropPhotos(j?.photos),
          () => toast("未能刪除，請再試。"),
        );
        delete localEdits[id];
      });
    }
    if (d.tg === "mergeDrafts") mergeDrafts(d.keys.split(","));
    if (d.draftRetry)
      fb.fs
        .updateDoc(jobRef(d.draftRetry), { status: "pending", retries: fb.fs.increment(1) })
        .catch(() => toast("未能重試，請再試。"));
    if (d.draftAdd) {
      const x = drafts().find((i) => i.key === d.draftAdd);
      if (x)
        addDraft(x, true).then((ok) => {
          if (ok) renderDrafts();
        });
    }
    if (d.tg === "draftsAddAll")
      (async () => {
        const all = drafts(),
          ok = all.filter((x) => x.status === "done" && !draftDup(x, all));
        let n = 0;
        for (const x of ok)
          if (await addDraft(x, false)) n++;
          else break;
        renderDrafts();
        const left = drafts().filter((x) => x.status === "done").length;
        if (n) toast(`已加入 ${n} 筆${left ? `，尚有 ${left} 筆待確認` : ""}`);
      })();
    if (d.receipts) showReceipts(d.receipts);
    if (d.fxSet) setRate(d.fxSet);
    if (d.tg === "checkSuggest") addSuggestions();
    if (d.docs) {
      const [k, i] = d.docs.split(":");
      openDocs(k, i);
    }
    if (d.docAdd) $("#docInput")?.click();
    if (d.docDel) {
      const [k, i, ...rest] = d.docDel.split(":");
      deleteDocFile(k, i, rest.join(":"));
    }
    if (d.settle) {
      state.settleMode = d.settle;
      refresh();
    }
    if (d.expCat) {
      const x = state.expenses.find((i) => i.id === d.expCat);
      if (x)
        UI.choose("開支分類", CATS, x.category || "food").then((v) => {
          if (v && CATS[v] && v !== x.category) update("expenses", x.id, { category: v });
        });
    }
    if (d.tg === "itemAdd") {
      $("#tgItemRows").insertAdjacentHTML("beforeend", itemRow());
      $("#tgItemRows").lastElementChild.querySelector("input").focus();
    }
    if (d.tg === "itemDel") {
      const rows = $("#tgItemRows");
      el.closest(".tg-line-row").remove();
      if (!rows.children.length) rows.innerHTML = itemRow();
    }
    if (d.tg === "retry") {
      if (fb && state.user) {
        state.status = "checking";
        refresh();
        chooseTrip();
      } else load().catch(() => {});
    }
    if (d.noteKind) {
      state.noteKind = d.noteKind;
      if ($('#detail [data-tg-form="note"]:not([data-place-id])')) openForm();
    }
    if (d.noteFilter) {
      state.noteFilter = d.noteFilter;
      refresh();
    }
    if (d.tg === "notePhoto") $("#notePhotoInput")?.click();
    if (d.notePhotoDel) {
      notePhotoDraft.splice(Number(d.notePhotoDel), 1);
      $("#notePhotoPreview").innerHTML = notePhotoPreview();
    }
    if (d.notePhoto) {
      const [id, i] = d.notePhoto.split(":");
      showNotePhoto(id, Number(i));
    }
    if (d.couponUsed) {
      const c = state.notes.find((n) => n.id === d.couponUsed);
      if (c) update("notes", c.id, c.used ? { used: false, usedBy: null, usedAt: null } : { used: true, usedBy: me().name, usedAt: Date.now() });
    }
    if (d.copyCode)
      navigator.clipboard?.writeText(d.copyCode).then(
        () => toast("已複製優惠碼"),
        () => toast("請長按優惠碼複製"),
      );
    if (d.tgTab) {
      state.tab = d.tgTab;
      refresh();
    }
    if (d.tripOpen) switchTrip(d.tripOpen);
    if (d.tripRemove) {
      const em = d.tripRemove;
      UI.confirm(`把 ${em} 移出這個旅程？`, { danger: true, ok: "移出" }).then(
        (ok) =>
          ok &&
          callable("manageTrip", 45000)
            .then((f) => f({ action: "removeMember", trip: tripId, email: em }))
            .then(
              () => {
                state.meta.members = state.meta.members.filter((x) => x !== em);
                refresh();
                toast("已移除");
              },
              (e) => toast(e?.message?.replace(/\s*\[\d+\]$/, "") || "未能移除。"),
            ),
      );
    }
    if (d.tgDel) {
      const [name, id] = d.tgDel.split(":");
      remove(name, id);
    }
    if (d.tg === "shopPic") $("#shopPicInput")?.click();
    if (d.tg === "shopPhotoClear") {
      shopPhoto = null;
      $("#shopPreview").innerHTML = "";
    }
    if (d.tg === "shopAdd") openShopSheet();
    if (d.articleAll) {
      const j = jobs.find((x) => x.id === d.articleAll),
        picks = (articlePicks[d.articleAll] ??= new Set()),
        all = j?.result?.choices?.length || 0;
      if (picks.size === all) picks.clear();
      else for (let i = 0; i < all; i++) picks.add(i);
      repaintJobs();
    }
    if (d.articleAdd) addArticlePicks(d.articleAdd);
    if (d.tg === "shopPlaceAdd") {
      const rows = $("#shopPlaceRows");
      if (rows.querySelectorAll("input").length >= 6) toast("最多 6 個購買地點。");
      else {
        rows.insertAdjacentHTML("beforeend", placeRow(""));
        rows.lastElementChild.querySelector("input")?.focus();
      }
    }
    if (d.tg === "shopFindAll") shopAiFill();
    if (d.tg === "newEntry") {
      // after an edit, a new note starts empty
      if (state.noteEdit) notePhotoDraft = [];
      state.noteEdit = null;
      openForm();
    }
    if (d.noteEdit) editNote(d.noteEdit);
    if (d.tg === "dayNote") dayNote(Number(d.noteDay));
    if (d.shopFilter) {
      state.shopFilter = d.shopFilter;
      refresh();
    }
    if (d.shopCat) {
      state.shopCat = d.shopCat;
      refresh();
    }
    if (d.shopView) {
      state.shopView = d.shopView;
      const sp = $("#shopPage");
      if (sp) sp.dataset.sig = "";
      refresh();
    }
    if (d.shopOpen) openShopItem(d.shopOpen);
    if (d.shopEdit) {
      const x = state.shopping.find((i) => i.id === d.shopEdit);
      if (x) openShopSheet(x);
    }
    if (d.shopToggle) {
      const x = state.shopping.find((i) => i.id === d.shopToggle);
      if (x) {
        const before = { bought: !!x.bought, boughtBy: x.boughtBy || null, boughtAt: x.boughtAt || null };
        update("shopping", x.id, x.bought ? { bought: false, boughtBy: null, boughtAt: null } : { bought: true, boughtBy: me().name, boughtAt: Date.now() });
        // tapped by mistake: 復原 puts it back
        Kit.snack(`${before.bought ? "已改回未買" : "已買"}「${String(x.name).slice(0, 20)}」`, { action: "復原" }).then((undo) => undo && update("shopping", x.id, before));
      }
    }
    if (
      (d.shopToggle || d.tgDel?.startsWith("shopping:")) &&
      $("#detail").open &&
      $("#detailBody .shop-detail-photo, #detailBody .shop-item")
    )
      $("#detail").close();
  });

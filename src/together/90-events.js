  // ---- Event handlers for everything above ----
  document.addEventListener("submit", (e) => {
    const tf = e.target.closest("[data-trip-form]");
    if (tf) {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(tf));
      const create = tf.dataset.tripForm === "create";
      tripAction(tf, { ...v, action: create ? "create" : "update", trip: tripId }, (r) => {
        if (create) {
          lastTrip.set(r.id);
          location.hash = "home";
        }
        location.reload();
      });
      return;
    }
    const cp = e.target.closest("[data-trip-copy]");
    if (cp) {
      e.preventDefault();
      const v = new FormData(cp),
        t = state.meta,
        what = v.getAll("copy").map(String),
        start = String(v.get("startDate")),
        end = String(v.get("endDate"));
      if (end < start) return toast("結束日期要在開始日期之後。");
      const days = Math.round((Date.parse(end) - Date.parse(start)) / 864e5) + 1;
      tripAction(
        cp,
        {
          action: "create",
          name: String(v.get("name")).trim(),
          destination: t.destination || "",
          startDate: start,
          endDate: end,
          currency: t.currency || "JPY",
          homeCurrency: t.homeCurrency || "HKD",
        },
        async (r) => {
          cp.querySelector("[data-trip-msg]").textContent = "正在複製資料…";
          const failed = await copyTrip(r.id, what, days);
          if (failed)
            (await UI.confirm("部分資料未能複製", {
              text: `有 ${failed} 項未能複製，其餘已完成。`,
              ok: "開啟新旅程",
              cancel: "留在這裡",
            })) && switchTrip(r.id);
          else switchTrip(r.id);
        },
      );
      return;
    }
    const inv = e.target.closest("[data-trip-invite]");
    if (inv) {
      e.preventDefault();
      const v = new FormData(inv),
        who = String(v.get("who") || "").trim(),
        google = v.get("kind") === "google";
      tripAction(
        inv,
        google
          ? { action: "addMember", trip: tripId, kind: "google", email: who }
          : { action: "addMember", trip: tripId, kind: "account", id: who, name: String(v.get("name") || "").trim() },
        (r) => {
          if (!state.meta.members.includes(r.email)) state.meta.members.push(r.email);
          inv.reset();
          inv.querySelector("[data-trip-msg]").textContent = r.password
            ? `已建立帳號 ${r.email.split("@")[0]}，密碼：${r.password}（只會顯示一次，請私下交給對方）`
            : `已加入 ${r.email.endsWith("@" + ACCOUNT_DOMAIN) ? r.email.split("@")[0] : r.email}`;
          refresh();
        },
      );
      return;
    }
    const f = e.target.closest("[data-tg-form]");
    if (!f) return;
    if (f.dataset.tgForm === "login") {
      e.preventDefault();
      const v = new FormData(f);
      loginWithAccount(String(v.get("id")).trim(), String(v.get("password")));
      return;
    }
    if (state.status !== "ready") return;
    e.preventDefault();
    const v = new FormData(f),
      str = (k) => String(v.get(k) || "").trim(),
      day = Number(v.get("day")) || null;
    if (f.dataset.tgForm === "note") {
      // From a place's detail (data-place-id) or the 共用 page (optional day and place).
      const placeId = f.dataset.placeId || placeIdOf(str("placeQ")).replace(/^-$/, "") || null,
        place = placeId && T().places.find((p) => p.id === placeId),
        coupon = f.dataset.kind === "coupon",
        url = str("url");
      if (coupon ? !str("title") : !str("text")) return;
      if (url && !/^https?:\/\//i.test(url)) return toast("連結要以 http:// 或 https:// 開頭。");
      add("notes", {
        text: str("text").slice(0, 1000),
        day: f.dataset.placeId ? null : day,
        placeId,
        placeName: place ? place.v[1] : null,
        ...(url ? { url: url.slice(0, 500) } : {}),
        ...(notePhotoDraft.length && !f.dataset.placeId ? { photos: notePhotoDraft.slice(0, NOTE_PHOTO_MAX) } : {}),
        ...(coupon ? { kind: "coupon", title: str("title").slice(0, 80), code: str("code").slice(0, 60), until: str("until").slice(0, 10), used: false } : {}),
      });
      if (!f.dataset.placeId) {
        notePhotoDraft = [];
        Kit.close();
        return;
      }
    }
    if (f.dataset.tgForm === "check") {
      if (!str("text")) return;
      add("checklist", {
        text: str("text").slice(0, 60),
        group: CHECK_GROUPS[str("group")] ? str("group") : "other",
        doneBy: [],
      });
      f.elements.text.value = "";
      f.elements.text.focus();
      return;
    }
    if (f.dataset.tgForm === "expense") {
      const prices = v.getAll("itemAmount"),
        items = v
          .getAll("itemName")
          .map((n, i) => ({
            name: String(n).trim().slice(0, 40),
            amount: prices[i] === "" ? null : Math.round(Number(prices[i]) * 100) / 100,
          }))
          .filter((i) => i.name && (i.amount == null || (i.amount >= 0 && i.amount <= 1e7)))
          .slice(0, 30);
      const sum = items.reduce((t, i) => t + (i.amount || 0), 0),
        amount = v.get("amount") === "" ? sum : Number(v.get("amount")),
        split = v.getAll("split").map(String);
      if (!str("title") || !(amount > 0) || amount > 1e7) return toast("請輸入項目和金額（或物品金額）。");
      if (!split.length) return toast("請最少選一位分帳旅伴。");
      const exp = {
          title: str("title").slice(0, 80),
          amount: Math.round(amount * 100) / 100,
          currency: pickCur(String(v.get("currency"))),
          paidBy: str("paidBy"),
          split,
          day: day || today(),
          items,
          ...(CATS[str("category")] ? { category: str("category") } : {}),
        },
        dup = duplicateOf(exp);
      const go = () => {
        add("expenses", exp);
        Kit.close();
      };
      if (dup) UI.confirm("似乎已經記錄過", { text: dupText(dup), ok: "仍然加入" }).then((ok) => ok && go());
      else go();
      return;
    }
    if (f.dataset.tgForm === "shop" && isLink(str("name")) && !state.shopEdit) {
      queueProductLink(str("name"));
      Kit.close();
      return;
    }
    if (f.dataset.tgForm === "shop") {
      const price = v.get("price") === "" ? null : Number(v.get("price"));
      if (!str("name")) return;
      if (price != null && !(price >= 0 && price <= 1e7)) return toast("價錢不正確。");
      const item = {
        name: str("name").slice(0, 80),
        qty: str("qty").slice(0, 30),
        forWhom: str("forWhom").slice(0, 60),
        detail: str("detail").slice(0, 500),
        reviews: str("reviews").slice(0, 1000),
        // several addresses, one per line (empty and repeated rows dropped)
        place: [...new Set(v.getAll("place").map((t) => String(t).trim().slice(0, 200)).filter(Boolean))].slice(0, 6).join("\n"),
        placeId: placeIdOf(str("placeQ")).slice(0, 40),
        cat: SHOP_CATS[str("cat")] ? str("cat") : "other",
        price: price == null ? null : Math.round(price * 100) / 100,
        currency: pickCur(String(v.get("currency"))),
        photo: shopPhoto,
      };
      // A chosen explore place fills an empty 購買地點 with its name and address.
      const chosen = item.placeId && item.placeId !== "-" && T().places.find((p) => p.id === item.placeId);
      if (chosen && !item.place) item.place = `${chosen.v[1]} ${chosen.v[3]}`.trim().slice(0, 200);
      // every 購買地點 already placed (Google Maps check, or unchanged lines): save the pins now
      const pins = knownPins(item.place);
      if (pins) Object.assign(item, { pins, lat: pins[0].lat, lng: pins[0].lng, geoFor: item.place });
      if (state.shopEdit) {
        update("shopping", state.shopEdit, { ...item, ai: false });
        toast("已儲存");
      } else add("shopping", { ...item, bought: false, boughtBy: null, boughtAt: null });
      state.shopEdit = null;
      shopPhoto = null;
      Kit.close();
      refresh();
      return;
    }
    f.reset();
  });
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
    if (d.tg === "newEntry") openForm();
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
      if (x)
        update(
          "shopping",
          x.id,
          x.bought
            ? { bought: false, boughtBy: null, boughtAt: null }
            : { bought: true, boughtBy: me().name, boughtAt: Date.now() },
        );
    }
    if (
      (d.shopToggle || d.tgDel?.startsWith("shopping:")) &&
      $("#detail").open &&
      $("#detailBody .shop-detail-photo, #detailBody .shop-item")
    )
      $("#detail").close();
  });
  document.addEventListener("change", (e) => {
    if (e.target.id === "tgReceipt" && e.target.files.length) {
      if (state.status === "ready") queueReceipts([...e.target.files]);
      e.target.value = "";
      Kit.close();
    }
    if (e.target.id === "shopPicInput" && e.target.files.length) {
      shopPics([...e.target.files]);
      e.target.value = "";
    }
  });
  document.addEventListener("change", (e) => {
    const k = e.target.dataset?.articlePick;
    if (!k) return;
    const [id, i] = k.split(":"),
      picks = (articlePicks[id] ??= new Set());
    e.target.checked ? picks.add(Number(i)) : picks.delete(Number(i));
    repaintJobs();
  });
  document.addEventListener("change", (e) => {
    const id = e.target.dataset?.check;
    if (!id) return;
    const x = state.checklist.find((i) => i.id === id),
      me = state.user.uid;
    if (!x) return;
    const fs = fb.fs,
      done = new Set(x.doneBy || []);
    e.target.checked ? done.add(me) : done.delete(me);
    update("checklist", id, { doneBy: fs.arrayUnion ? (e.target.checked ? fs.arrayUnion(me) : fs.arrayRemove(me)) : [...done] });
  });
  document.addEventListener("change", (e) => {
    if (e.target.id !== "docInput" || !e.target.files.length) return;
    const [k, i] = e.target.dataset.target.split(":");
    uploadDocs(k, i, [...e.target.files]);
    e.target.value = "";
  });
  document.addEventListener(
    "toggle",
    (e) => {
      if (e.target.classList?.contains("tg-fx")) state.fxOpen = e.target.open;
    },
    true,
  );
  const placeField = (t) => t.name === "place" && t.closest('[data-tg-form="shop"]');
  document.addEventListener("change", (e) => {
    if (placeField(e.target)) placeFromMaps(e.target);
  });
  document.addEventListener("paste", (e) => {
    if (placeField(e.target)) setTimeout(() => placeFromMaps(e.target));
  });
  document.addEventListener("change", (e) => {
    if (e.target.dataset?.tripSwitch !== undefined) switchTrip(e.target.value);
  });
  document.addEventListener("input", (e) => {
    if (e.target.id === "shopSearch") {
      state.shopSearch = e.target.value;
      const sp = $("#shopPage");
      if (sp) paint(sp, shopPage());
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.dataset?.df !== undefined) e.preventDefault();
  });
  // Draft edits are kept locally while typing and saved to the job when a field is left, so they survive reloads.
  document.addEventListener("change", (e) => {
    const k = e.target.dataset?.draftPick;
    if (!k) return;
    e.target.checked ? picked.add(k) : picked.delete(k);
    renderDrafts();
  });
  document.addEventListener("input", (e) => {
    const k = e.target.dataset?.df,
      card = e.target.closest?.("[data-draft]");
    if (!k || !card) return;
    (localEdits[card.dataset.draft] ??= {})[k] = e.target.value;
  });
  document.addEventListener("change", (e) => {
    const k = e.target.dataset?.df,
      card = e.target.closest?.("[data-draft]");
    if (!k || !card || !fb) return;
    const v =
      k === "day"
        ? Number(e.target.value)
        : k === "amount"
          ? e.target.value === ""
            ? ""
            : Number(e.target.value)
          : e.target.value;
    fb.fs.updateDoc(jobRef(card.dataset.draft), { ["edit." + k]: v }).catch(() => {});
    if (k !== "title") renderDrafts();
  });
  addEventListener("online", () => {
    refresh();
    renderDrafts();
  });
  addEventListener("offline", () => {
    refresh();
    renderDrafts();
  });
  setInterval(() => {
    if (jobs.some((j) => !["done", "failed"].includes(j.status))) renderDrafts();
  }, 30000);
  document.addEventListener("change", (e) => {
    if (e.target.id !== "notePhotoInput" || !e.target.files.length) return;
    addNotePhotos([...e.target.files]);
    e.target.value = "";
  });
  // A picture pasted anywhere on the shopping list, the notes or the expenses page goes where photos go there.
  document.addEventListener("paste", (e) => {
    const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith("image/"));
    if (!files.length || state.status !== "ready") return;
    const view = location.hash.slice(1).split("?")[0];
    if (view === "shopping") queueProducts(files);
    else if (view === "together" && state.tab === "notes") {
      if (!$("#notePhotoPreview")) openForm();
      addNotePhotos(files);
    }
    else if (view === "together" && state.tab === "expenses") queueReceipts(files);
    else return;
    e.preventDefault();
  });
  // A link typed into the note / coupon form's 連結 is read by the AI (once per address).
  let noteFillUrl = "";
  document.addEventListener("change", (e) => {
    const f = e.target.closest?.('[data-tg-form="note"]:not([data-place-id])');
    if (!f || e.target.name !== "url") return;
    const url = e.target.value.trim();
    if (/^https?:\/\/\S+$/i.test(url) && url !== noteFillUrl) {
      noteFillUrl = url;
      requestNoteFill({ url });
    }
  });

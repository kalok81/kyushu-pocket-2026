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
      const editing = !f.dataset.placeId && state.noteEdit && state.notes.find((n) => n.id === state.noteEdit);
      if (editing) {
        // every field the form shows, emptied ones included (an empty link or no photos)
        update("notes", editing.id, {
          text: str("text").slice(0, 1000),
          day,
          placeId,
          placeName: place ? place.v[1] : null,
          url: url.slice(0, 500),
          photos: notePhotoDraft.slice(0, NOTE_PHOTO_MAX),
          ...(coupon ? { title: str("title").slice(0, 80), code: str("code").slice(0, 60), until: str("until").slice(0, 10) } : {}),
        });
        toast("已儲存");
        state.noteEdit = null;
        notePhotoDraft = [];
        Kit.close();
        return;
      }
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
      const go = () => {
        if (state.shopEdit) {
          update("shopping", state.shopEdit, { ...item, ai: false });
          toast("已儲存");
        } else add("shopping", { ...item, bought: false, boughtBy: null, boughtAt: null });
        state.shopEdit = null;
        shopPhoto = null;
        Kit.close();
        refresh();
      };
      // already on the list (same or similar name): ask first
      const dup = shopDuplicate(item.name, state.shopEdit);
      if (dup) UI.confirm("清單已有相似物品", { text: `「${dup.name}」${dup.qty ? ` · ${dup.qty}` : ""}${dup.bought ? "（已買）" : ""}，仍然加入？`, ok: state.shopEdit ? "仍然儲存" : "仍然加入" }).then((ok) => ok && go());
      else go();
      return;
    }
    f.reset();
  });

  // ---- Change, input, paste and key handlers for the together pages ----
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
    if (e.target.id === "expSearch") {
      state.expSearch = e.target.value;
      refresh();
    }
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
  document.addEventListener("change", (e) => {
    const k = e.target.dataset?.dpay;
    if (!k) return;
    if (k === "paidBy") draftPay.paidBy = e.target.value;
    else draftPay.split = [...document.querySelectorAll('[data-dpay="split"]:checked')].map((i) => i.value);
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
  // A picture pasted anywhere on the shopping list, the notes or the expenses page goes where photos go there. A link
  // pasted on the shopping list (outside a form, or into its search box) is read like a product link.
  document.addEventListener("paste", (e) => {
    const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith("image/"));
    if (state.status !== "ready") return;
    const view = location.hash.slice(1).split("?")[0],
      t = e.target,
      text = (e.clipboardData?.getData("text") || "").trim();
    if (!files.length) {
      if (view !== "shopping" || $("#detail")?.open || !/^https?:\/\/\S+$/i.test(text)) return;
      if (t.matches?.("input, textarea, select") && t.id !== "shopSearch") return;
      e.preventDefault();
      return queueProductLink(text);
    }
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

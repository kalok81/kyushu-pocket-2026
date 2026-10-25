  // ---- Sheets, menus and the undo bar ----
  // Sheet: the one #detail dialog (a bottom sheet on phones) shows forms and details.
  // What the sheet's fields hold (typed or filled in by the AI), to tell whether anything would be lost.
  const sheetState = () =>
    [...$("#detailBody").querySelectorAll("form input, form textarea, form select")]
      .map((e) => (e.type === "checkbox" || e.type === "radio" ? e.checked : e.value))
      .concat($("#detailBody").querySelectorAll("form img").length)
      .join("\u0001");
  let sheetStart = "";
  function open(html) {
    $("#detailBody").innerHTML = html;
    sheetStart = sheetState();
    if (!$("#detail").open) $("#detail").showModal();
  }
  // Tapping outside a sheet that is a form (add / edit) does nothing: only its ✕ (or saving) closes it. Tapping
  // outside other sheets, Esc or the back gesture: never while an AI or map lookup is running (its progress bar),
  // and only after asking when the form has unsaved changes. The ✕ always closes.
  const sheetBusy = () => !!$("#detailBody .ai-progress:not(.done)");
  async function closeSoftly() {
    if (sheetBusy()) return window.UI.toast("AI 正在處理，完成後才可關閉；要放棄請按右上角 ✕。");
    if (sheetState() !== sheetStart && !(await window.UI.confirm("放棄未儲存的內容？", { text: "已輸入或 AI 已填入的資料會消失。", ok: "放棄", cancel: "繼續編輯", danger: true }))) return;
    close();
  }
  addEventListener("DOMContentLoaded", () => {
    const d = $("#detail");
    d.addEventListener("click", (e) => e.target === d && !$("#detailBody > form") && closeSoftly());
    d.addEventListener("cancel", (e) => {
      e.preventDefault();
      closeSoftly();
    });
  });
  function close() {
    if ($("#detail").open) $("#detail").close();
  }
  // Menus: one open at a time, placed under (or above) their button so cards with hidden overflow never clip them;
  // a choice, a tap elsewhere or Escape closes them. They follow their button when the page scrolls.
  const closeMenus = (keep) =>
    document.querySelectorAll("details.more[open]").forEach((d) => d !== keep && d.removeAttribute("open"));
  function placeMenu(d) {
    const m = d.querySelector(".menu"),
      r = d.querySelector("summary").getBoundingClientRect(),
      w = m.offsetWidth,
      h = m.offsetHeight;
    m.style.left = `${Math.max(8, Math.min(r.right - w, innerWidth - w - 8))}px`;
    m.style.top = `${r.bottom + 4 + h > innerHeight - 8 ? Math.max(8, r.top - h - 4) : r.bottom + 4}px`;
  }
  document.addEventListener(
    "toggle",
    (e) => {
      const d = e.target;
      if (!d.classList?.contains("more") || !d.open) return;
      closeMenus(d);
      placeMenu(d);
    },
    true,
  );
  const placeOpen = () => document.querySelectorAll("details.more[open]").forEach(placeMenu);
  addEventListener("scroll", placeOpen, { passive: true, capture: true });
  addEventListener("resize", placeOpen);
  document.addEventListener("click", (e) => {
    const inMenu = e.target.closest?.("details.more");
    if (e.target.closest?.(".menu-item")) setTimeout(() => closeMenus());
    else closeMenus(inMenu);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMenus();
  });
  // Undo bar: shows text and an action for a few seconds. Resolves true when the action is pressed, false when it
  // times out, another bar replaces it or the page is closed (so a pending delete still goes through).
  let snackDone = null;
  function snack(text, { action = "", ms = 5000 } = {}) {
    snackDone?.(false);
    return new Promise((resolve) => {
      const el = $("#toast");
      let timer;
      const done = (v) => {
        if (snackDone !== done) return;
        snackDone = null;
        clearTimeout(timer);
        el.classList.remove("show", "snack");
        resolve(v);
      };
      snackDone = done;
      el.innerHTML = `<span>${esc(text)}</span>${action ? `<button type="button" class="snack-action">${icon("undo")}${esc(action)}</button>` : ""}`;
      el.classList.add("show", "snack");
      el.querySelector(".snack-action")?.addEventListener("click", () => done(true));
      timer = setTimeout(() => done(false), ms);
    });
  }
  addEventListener("pagehide", () => snackDone?.(false));

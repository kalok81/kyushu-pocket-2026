  // ---- Painting the Together sections of the current page ----
  function paint(el, { sig, shell, live = {} }) {
    if (el.dataset.sig !== sig) {
      el.innerHTML = shell;
      el.dataset.sig = sig;
    }
    for (const [k, v] of Object.entries(live)) {
      const l = el.querySelector(`[data-tg-live="${k}"]`);
      if (l) l.innerHTML = v;
    }
  }
  function refresh() {
    if (!started && !$("#tgPage")) $("#app").innerHTML = header("POCKET TRAVEL", "口袋旅伴") + '<div id="tgPage"></div>';
    const p = $("#tgPage");
    if (p) paint(p, page());
    const tp = $("#tripsPage");
    if (tp) paint(tp, tripsPage());
    const box = $("#tgDrafts");
    if (box && !box.childElementCount && jobs.length) renderDrafts();
    const sp = $("#shopPage");
    if (sp) paint(sp, shopPage());
    document.querySelectorAll("[data-tg-day]").forEach((el) => paint(el, daySlot(Number(el.dataset.tgDay))));
    document.querySelectorAll("[data-tg-place]").forEach((el) => paint(el, placeSlot(el.dataset.tgPlace)));
  }
  function render() {
    const p = new URLSearchParams(location.hash.split("?")[1]);
    if (tabs[p.get("tab")]) state.tab = p.get("tab");
    if (p.has("day")) state.day = Math.min(7, Math.max(1, Number(p.get("day")) || 1));
    return `${header("TOGETHER", "一起記，一起走。", "筆記、開支與共用行程 · 只限旅伴登入，內容不會公開")}<div id="tgPage"></div>`;
  }

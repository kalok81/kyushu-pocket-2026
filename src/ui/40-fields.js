  // ---- Clear buttons: every text field in a form gets an × that empties it ----
  // Fields are wrapped as they appear (pages and sheets are rendered as HTML), and the × shows only while the field
  // has text (CSS :placeholder-shown, so values filled in by the AI count too).
  const CLEARABLE =
    'form input:not([type]),form input[type=text],form input[type=url],form input[type=number],form input[type=email],form input[type=tel],form textarea';
  function addClear(el) {
    if (el.closest(".field, .tg-line-row, [data-no-clear], [data-tg-form=login]") || el.readOnly) return;
    const wrap = document.createElement("span");
    wrap.className = `field${el.tagName === "TEXTAREA" ? " field-area" : ""}`;
    if (!el.hasAttribute("placeholder")) el.setAttribute("placeholder", " ");
    el.replaceWith(wrap);
    wrap.append(el);
    wrap.insertAdjacentHTML("beforeend", `<button type="button" class="field-clear" tabindex="-1" aria-label="清除">${icon("x")}</button>`);
  }
  const wrapAll = (root) => root.querySelectorAll?.(CLEARABLE).forEach(addClear);
  new MutationObserver((list) => {
    for (const m of list) for (const n of m.addedNodes) if (n.nodeType === 1) n.matches?.(CLEARABLE) ? addClear(n) : wrapAll(n);
  }).observe(document.body, { childList: true, subtree: true });
  wrapAll(document.body);
  document.addEventListener("click", (e) => {
    const b = e.target.closest(".field-clear");
    if (!b) return;
    const el = b.parentElement.querySelector("input,textarea");
    el.value = "";
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.focus();
  });

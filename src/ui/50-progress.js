  // ---- Progress bars for AI analyses and map lookups ----
  // The AI does not report progress, so the bar moves by time: fast at first, slowing towards 92% over the usual
  // duration, and jumps to 100% when the answer arrives. Background jobs pass their start time, so a bar picks up
  // where it was after the page is drawn again.
  const progress = ({ text = "", seconds = 15, since = Date.now() } = {}) => {
    const spent = Math.max(0, (Date.now() - since) / 1000),
      from = Math.min(90, (spent / seconds) * 92),
      rest = Math.max(1, seconds - spent);
    return `<div class="ai-progress" role="progressbar" aria-label="${esc(text || "處理中")}" aria-valuemin="0" aria-valuemax="100"><div class="ai-progress-bar"><i style="--from:${from.toFixed(1)}%;--rest:${rest.toFixed(1)}s"></i></div>${text ? `<span>${esc(text)}</span>` : ""}</div>`;
  };
  // A bar placed just before el (e.g. a form's note line) until the returned function is called.
  function busy(el, opts = {}) {
    if (!el) return () => {};
    el.previousElementSibling?.classList.contains("ai-progress") && el.previousElementSibling.remove();
    el.insertAdjacentHTML("beforebegin", progress(opts));
    const bar = el.previousElementSibling;
    return () => {
      bar.classList.add("done");
      setTimeout(() => bar.remove(), 400);
    };
  }

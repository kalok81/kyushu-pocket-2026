  // ---- 購物: the form's photo and AI fill jobs ----
  function renderShopping() {
    return `${header("購物")}<div id="shopPage"></div>`;
  }
  async function pickShopPhoto(file) {
    try {
      let b = await shrink(file, 900, 0.7);
      if (b.length > 380000) b = await shrink(file, 600, 0.6);
      shopPhoto = b;
      const p = $("#shopPreview");
      if (p) p.innerHTML = shopPreview();
      requestFill(b);
    } catch (e) {
      toast("未能讀取這張相片，請改用 JPG 或 PNG，或直接影相。");
      console.error(e);
    }
  }
  // Form photo → a productFill job; when the function answers, fill the empty fields of the open form.
  let fillJob = null,
    fillDone = () => {};
  function fillStatus(text, busy, seconds = 15) {
    const i = $("#shopFillInfo");
    if (i) i.textContent = text;
    fillDone();
    fillDone = busy ? Kit.busy(i, { seconds }) : () => {};
  }
  function requestFill(image) {
    if (!navigator.onLine) return fillStatus("離線中，AI 未能辨識，請手動輸入。", false);
    const job = queueJob({ images: [image], kind: "productFill", file: "購物表格相片" });
    fillJob = job.id;
    job.sent.catch((e) => {
      fillJob = null;
      fillStatus("未能上載相片給 AI，請手動輸入。", false);
      console.error(e);
    });
    fillStatus("AI 正在辨識物品…", true);
  }
  function handleFillJobs() {
    for (const j of jobs.filter((j) => j.kind === "productFill" && (j.status === "done" || j.status === "failed"))) {
      if (j.id === fillJob) {
        fillJob = null;
        const f = $('[data-tg-form="shop"]');
        if (j.status === "failed" || !f) fillStatus(j.error || "AI 未能辨識，請手動輸入。", false);
        else {
          const el = f.elements,
            r = j.result || {},
            put = (n, v) => {
              const input = f.querySelector(`[name="${n}"]`);
              if (v != null && v !== "" && input && !String(input.value).trim()) input.value = v;
            };
          put("name", r.name);
          put("qty", r.qty);
          put("detail", r.detail);
          put("reviews", r.reviews);
          put("place", r.place);
          put("price", r.price);
          if (r.cat && SHOP_CATS[r.cat]) el.cat.value = r.cat;
          if (r.price != null && r.currency) el.currency.value = r.currency;
          f.querySelector(".shop-more").open = true;
          fillStatus("AI 已填入空白欄位，請檢查。", false);
        }
      }
      fb.fs.deleteDoc(jobRef(j.id)).catch(() => {});
    }
  }

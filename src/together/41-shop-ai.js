  // ---- 購物 (shopping list): page, AI product photos, matching shops and geocoding ----
  // Product photos for the shopping list go through the same background jobs; the function adds the item itself.
  async function queueProducts(files) {
    if (files.length > 10) {
      toast("一次最多 10 張，已取頭 10 張。");
      files = files.slice(0, 10);
    }
    let n = 0;
    for (const f of files) {
      try {
        let image = await shrink(f, 1000, 0.72);
        if (image.length > 380000) image = await shrink(f, 800, 0.65);
        queueJob({ images: [image], kind: "product", file: String(f.name || "相片").slice(0, 120) }).sent.catch((e) => {
          toast("未能上載相片，請確認你仍在旅伴名單。");
          console.error(e);
        });
        n++;
      } catch (e) {
        photoError(f, e);
      }
    }
    if (n) toast(`已加入 ${n} 張物品相片，AI 會在背景辨識並加入清單`);
  }
  // A product page or picture link: the function reads it in the background and adds the item like a photo.
  function queueProductLink(url) {
    let host = "";
    try {
      host = new URL(url).hostname;
    } catch {}
    if (!/^https?:\/\//i.test(url) || !host) return toast("請貼上 http:// 或 https:// 開頭的連結。");
    queueJob({ url: url.slice(0, 500), kind: "product", file: host.slice(0, 120) }).sent.catch(() => toast("未能送出連結，請確認你仍在旅伴名單。"));
    toast("已送出連結，AI 會在背景讀取並加入清單");
  }
  // An article link that lists several products comes back as choices: tick the ones to buy, then add them together.
  const articlePicks = {},
    repaintJobs = () => {
      const el = $('[data-tg-live="jobs"]');
      if (el) el.innerHTML = productJobsHtml();
    };
  function choicesHtml(j) {
    const r = j.result,
      picks = (articlePicks[j.id] ??= new Set()),
      cur = (c) => (c.price != null ? esc(S.format(S.toMinor(c.price, c.currency), c.currency)) : "");
    return `<article class="card tg-item article-choices" data-draft="${esc(j.id)}"><div class="tg-meta">${Kit.badge(`找到 ${r.choices.length} 件`)}<span>${esc(r.title || j.file)}</span></div><ul class="list choice-list">${r.choices
      .map(
        (c, i) =>
          `<li><label><input type="checkbox" data-article-pick="${esc(j.id)}:${i}"${picks.has(i) ? " checked" : ""}>${c.photo ? `<img src="${photoSrc(c.photo)}" alt="">` : `<span class="choice-ph">${icon("bag")}</span>`}<span><b>${esc(c.name)}</b><small>${[c.qty, cur(c), c.place].filter(Boolean).map(esc).join(" · ")}</small>${c.detail ? `<small>${esc(c.detail)}</small>` : ""}</span></label></li>`,
      )
      .join("")}</ul><div class="links">${Kit.btn(`加入所選（${picks.size}）`, { variant: "primary", size: "sm", icon: "plus", attrs: { "data-article-add": j.id, disabled: !picks.size } })}${Kit.btn(picks.size === r.choices.length ? "全部不選" : "全選", { size: "sm", attrs: { "data-article-all": j.id } })}${Kit.btn("捨棄", { size: "sm", icon: "trash", attrs: { "data-draft-drop": j.id } })}</div></article>`;
  }
  async function addArticlePicks(id) {
    const j = jobs.find((x) => x.id === id),
      picks = [...(articlePicks[id] || [])].sort((a, b) => a - b);
    if (!j?.result?.choices || !picks.length) return;
    const { fs } = fb;
    let n = 0;
    for (const i of picks) {
      const c = j.result.choices[i];
      if (!c) continue;
      await fs
        .addDoc(tcol("shopping"), {
          name: c.name,
          qty: c.qty || "",
          detail: c.detail || "",
          cat: SHOP_CATS[c.cat] ? c.cat : "other",
          place: c.place || "",
          price: c.price ?? null,
          currency: pickCur(c.currency),
          photo: c.photo && c.photo.length <= 400000 ? c.photo : null,
          ...(j.result.link ? { url: j.result.link } : {}),
          bought: false,
          boughtBy: null,
          boughtAt: null,
          ai: true,
          by: state.user.uid,
          byName: me().name,
          at: Date.now() + n,
          createdAt: fs.serverTimestamp(),
        })
        .then(() => n++, (e) => console.error(e));
    }
    if (n) {
      fs.deleteDoc(jobRef(id)).catch(() => {});
      delete articlePicks[id];
      toast(`已加入 ${n} 件物品`);
    } else toast("未能加入，請再試。");
  }
  function productJobsHtml() {
    const pj = jobs.filter((j) => j.kind === "product" && !j.result?.choices),
      lists = jobs.filter((j) => j.kind === "product" && j.status === "done" && j.result?.choices?.length);
    if (!pj.length && !lists.length) return "";
    if (!pj.length) return `<div class="tg-drafts">${lists.map(choicesHtml).join("")}</div>`;
    const busy = pj.filter((j) => j.status !== "failed").length;
    return `<div class="tg-drafts">${lists.map(choicesHtml).join("")}<div class="tg-drafts-head"><b>${busy ? `AI 辨識中 ${busy} 項` : "未能辨識"}</b></div>${pj
      .map((j) => {
        const st = jobState(j),
          fail = st === "fail",
          retry = canRetry(j);
        return `<article class="card tg-item tg-draft" data-draft="${esc(j.id)}"><div class="tg-meta">${Kit.badge(fail ? "未能辨識" : STATUS[st])}<span>${esc(j.file)}</span></div>${fail ? `<p class="note">${esc(j.error || "未能辨識。")}</p>` : Kit.progress({ seconds: j.url ? 25 : 20, since: j.at })}${fail || retry ? `<div class="links">${retry ? Kit.btn("重試", { size: "sm", icon: "redo", attrs: { "data-draft-retry": j.id } }) : ""}${Kit.btn("捨棄", { size: "sm", icon: "trash", attrs: { "data-draft-drop": j.id } })}</div>` : ""}</article>`;
      })
      .join("")}</div>`;
  }
  // Shopping list: item photos are stored inline (small JPEG) so they stay readable offline.
  let shopPhoto = null;
  const photoSrc = (b64) => `data:image/jpeg;base64,${b64}`;
  // Shopping categories (shopping/{id}.cat); the product AI picks one, and companions can change it.
  const SHOP_CATS = { drug: "💄 藥妝", food: "🍱 食品", fashion: "👕 衣服鞋袋", home: "🏠 生活用品", stationery: "✏️ 文具", toys: "🧸 玩具精品", electronics: "🔌 電器", other: "📦 其他" };
  const shopCat = (x) => (SHOP_CATS[x.cat] ? x.cat : "other");

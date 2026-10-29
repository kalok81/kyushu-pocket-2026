  // ---- Receipts read by AI in the background (receiptJobs), drafts, merging and duplicates ----
  // Receipts are read in the background: each photo becomes a receiptJobs document. Firestore keeps unsent
  // writes on the phone and retries after a reload, and the processReceipt function reads the receipt
  // server-side even if the page is closed. Payer and split are chosen in the drafts box (the expense form is a sheet
  // that is usually closed); by default you paid and it is split among everyone.
  let jobs = [];
  const localEdits = {};
  const draftPay = { paidBy: "", split: null };
  const payOf = () => {
    const ids = people().map((p) => p.id),
      paidBy = ids.includes(draftPay.paidBy) ? draftPay.paidBy : state.user.uid;
    return { paidBy, split: draftPay.split ? draftPay.split.filter((id) => ids.includes(id)) : ids };
  };
  const STUCK = 3 * 60 * 1000;
  const jobState = (j) =>
    j.status === "done"
      ? "done"
      : j.status === "failed"
        ? "fail"
        : j.uploading
          ? "upload"
          : j.status === "processing"
            ? "busy"
            : "queued";
  const canRetry = (j) =>
    (j.status === "failed" && (j.image != null || j.images != null)) ||
    (["pending", "processing"].includes(j.status) && !j.uploading && Date.now() - (j.startedAt || j.at || 0) > STUCK);
  function draftOf(j) {
    const r = j.result || {},
      e = { ...j.edit, ...localEdits[j.id] },
      day = r.date && T().days.find((x) => x.iso === r.date.replaceAll("-", "/"));
    return {
      key: j.id,
      file: j.file,
      at: j.at || 0,
      part: r.part || (j.status === "failed" ? "unknown" : "whole"),
      photos: j.images || (j.image != null ? [j.image] : []),
      status: jobState(j),
      error: j.error,
      retry: canRetry(j),
      title: e.title ?? (r.merchant || (r.source === "tags" ? "價錢牌" : "收據")),
      amount: e.amount ?? r.total ?? "",
      currency: e.currency ?? pickCur(r.currency),
      day: Number(e.day ?? (day ? day.n : today())),
      category: e.category ?? (CATS[r.category] ? r.category : ""),
      items: r.items || [],
      warn:
        r.currency === "OTHER"
          ? `⚠️ 收據不是${tripCurrencies()
              .map((c) => CURRENCY_NAMES[c] || c)
              .join("或")}，請自行換算。`
          : r.source === "tags"
            ? "⚠️ 由價錢牌讀出（沒有收據），已用各件的含稅價合計，請對照實際付款金額。"
            : r.totalFromItems
              ? "⚠️ 讀不到總額，已用物品合計，請對照收據。"
              : r.confidence === "low"
                ? "⚠️ 相片不太清楚，請仔細檢查。"
                : "",
      // Not blocking: totals often differ from the item lines because of tax, discounts or a missed line.
      hint: (() => {
        const lines = (r.items || []).filter((i) => i.amount > 0),
          sum = lines.reduce((t, i) => t + i.amount, 0),
          total = Number(r.total);
        return lines.length >= 2 && total > 0 && !r.totalFromItems && Math.abs(sum - total) > Math.max(1, total * 0.05)
          ? `物品合計 ${sum.toLocaleString("en-US")} 與總額 ${total.toLocaleString("en-US")} 不同（可能有稅項、折扣或漏讀），請對照收據。`
          : "";
      })(),
    };
  }
  const drafts = () => jobs.filter((j) => !j.kind || j.kind === "receipt").map(draftOf);
  const draftDup = (d, all = drafts()) => {
    const exp = { title: d.title, amount: Number(d.amount), currency: d.currency, day: Number(d.day) },
      earlier = all
        .slice(
          0,
          all.findIndex((x) => x.key === d.key),
        )
        .find(
          (x) =>
            x.status === "done" &&
            x.currency === exp.currency &&
            Math.abs(Number(x.amount) - exp.amount) < 0.005 &&
            (Number(x.day) === exp.day || sameName(x.title, exp.title)),
        );
    const dup = duplicateOf(exp);
    return dup ? `⚠️ 可能重複：${dupText(dup)} 已經記錄過。` : earlier ? `⚠️ 與「${earlier.title}」可能是同一張收據。` : "";
  };
  // Partial shots: pair them in upload order (a top/middle shot followed by the next partial ones up to a bottom
  // shot, within 10 minutes, same shop when both names are known). Several split receipts give several suggestions.
  const PART_ORDER = { top: 0, middle: 1, unknown: 1, bottom: 2 };
  function mergeGroups(all) {
    const parts = all
        .filter((d) => (d.status === "done" || d.status === "fail") && d.photos.length && d.part !== "whole")
        .sort((a, b) => a.at - b.at),
      groups = [];
    const shop = (d) => (d.status === "done" && d.title && d.title !== "收據" ? d.title : "");
    let cur = [];
    const close = () => {
      if (cur.length >= 2 && cur.some((d) => d.part !== "top") && cur.some((d) => d.part !== "bottom")) groups.push(cur);
      cur = [];
    };
    for (const d of parts) {
      const last = cur[cur.length - 1],
        sameShop =
          !last ||
          !shop(d) ||
          !shop(last) ||
          sameName(shop(d), shop(last)) ||
          shop(d).includes(shop(last)) ||
          shop(last).includes(shop(d));
      const complete = cur.some((x) => x.part === "top") && cur.some((x) => x.part === "bottom");
      if (last && (d.at - last.at > 10 * 60 * 1000 || !sameShop || cur.length >= 4 || complete)) close();
      cur.push(d);
    }
    close();
    return groups.map((g) => g.sort((a, b) => PART_ORDER[a.part] - PART_ORDER[b.part]));
  }
  const picked = new Set();
  function mergeDrafts(keys) {
    const group = keys
        .map((k) => drafts().find((d) => d.key === k))
        .filter(Boolean)
        .sort((a, b) => PART_ORDER[a.part] - PART_ORDER[b.part] || a.at - b.at),
      images = group.flatMap((d) => d.photos);
    if (group.length < 2 || !images.length) return;
    if (images.length > 4) return toast("同一張收據最多 4 張相片，請少揀幾張。");
    keys.forEach((k) => picked.delete(k));
    const { fs, db } = fb;
    const src = group.map((d) => jobs.find((j) => j.id === d.key) || {}),
      hashes = src.flatMap((j) => j.hashes || []).slice(0, 4),
      stored = src.flatMap((j) => j.photos || []);
    queueJob({
      images,
      hashes,
      file: group
        .map((d) => d.file)
        .join(" + ")
        .slice(0, 120),
    }).sent.then(
      (ref) => {
        group.forEach((d) => {
          fs.deleteDoc(jobRef(d.key)).catch(() => {});
          delete localEdits[d.key];
        });
        if (stored.length && stored.length <= 4) fs.updateDoc(ref, { photos: stored }).catch(() => {});
      },
      () => toast("未能合併，請再試。"),
    );
    toast("已合併，正在重新分析");
  }
  const STATUS = { upload: "上載中", queued: "等候分析", busy: "分析中…", done: "已讀取", fail: "未能讀取" };
  function draftHtml(d, all) {
    const pick =
      (d.status === "done" || d.status === "fail") && d.photos.length
        ? `<label class="tg-pick"><input type="checkbox" data-draft-pick="${d.key}"${picked.has(d.key) ? " checked" : ""}> 選擇</label>`
        : "";
    const head = `<div class="tg-meta">${Kit.badge(STATUS[d.status])}<span>${esc(d.file)}</span>${pick}</div>`,
      retry = d.retry ? Kit.btn("重試", { size: "sm", icon: "redo", attrs: { "data-draft-retry": d.key } }) : "",
      drop = Kit.btn("捨棄", { size: "sm", icon: "trash", attrs: { "data-draft-drop": d.key } });
    if (d.status !== "done" && d.status !== "fail")
      return `<article class="card tg-item tg-draft" data-draft="${d.key}">${head}${Kit.progress({ seconds: 30, since: d.at })}${d.retry ? `<p class="note">等候時間較長，可以按重試。</p><div class="links">${retry}${drop}</div>` : ""}</article>`;
    if (d.status === "fail")
      return `<article class="card tg-item tg-draft" data-draft="${d.key}">${head}<p class="note">${esc(d.error || "未能讀取。")}</p><div class="links">${retry}${drop}</div></article>`;
    const warn = draftDup(d, all) || d.warn;
    return `<article class="card tg-item tg-draft" data-draft="${d.key}">${head}<div class="tg-row"><label>項目<input data-df="title" maxlength="80" value="${esc(d.title)}"></label><label>金額<input data-df="amount" type="number" inputmode="decimal" min="0.01" step="0.01" value="${esc(d.amount)}"></label></div><div class="tg-row"><label>貨幣<select data-df="currency">${curOptions(d.currency)}</select></label><label>日子<select data-df="day">${dayOptions(d.day)}</select></label></div><label>分類<select data-df="category"><option value="">未分類</option>${catOptions(d.category)}</select></label>${d.items.length ? `<ul class="tg-lines">${d.items.map((i) => `<li><span>${esc(i.name)}</span><span>${esc(i.amount)}</span></li>`).join("")}</ul>` : ""}${warn ? `<p class="note tg-warn">${esc(warn)}</p>` : ""}${d.hint ? `<p class="note">ℹ️ ${esc(d.hint)}</p>` : ""}<div class="links">${Kit.btn("加入", { variant: "secondary", size: "sm", icon: "plus", attrs: { "data-draft-add": d.key } })}${drop}</div></article>`;
  }
  function payBox(all) {
    if (!all.some((d) => d.status === "done")) return "";
    const { paidBy, split } = payOf();
    return `<fieldset class="tg-draft-pay"><legend>這些收據</legend><label>誰付款<select data-dpay="paidBy">${people().map((p) => `<option value="${esc(p.id)}"${p.id === paidBy ? " selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label><div class="tg-draft-split"><span>分給</span>${people().map((p) => `<label class="tg-check"><input type="checkbox" data-dpay="split" value="${esc(p.id)}"${split.includes(p.id) ? " checked" : ""}> ${esc(p.name)}</label>`).join("")}</div></fieldset>`;
  }
  function renderDrafts() {
    const box = $("#tgDrafts");
    if (!box) return;
    const all = drafts();
    if (!all.length) {
      box.innerHTML = "";
      return;
    }
    const a = document.activeElement,
      card = a?.closest?.("[data-draft]"),
      field = a?.dataset?.df;
    const finished = all.filter((d) => d.status === "done" || d.status === "fail").length,
      ready = all.filter((d) => d.status === "done" && !draftDup(d, all)).length,
      uploading = all.filter((d) => d.status === "upload").length,
      pct = Math.round((finished / all.length) * 100);
    for (const k of [...picked]) if (!all.some((d) => d.key === k && d.photos.length)) picked.delete(k);
    const suggestions = mergeGroups(all)
      .map(
        (g) =>
          `<div class="notice tg-merge">${esc(g.map((d) => d.file).join("、"))} 似乎是同一張收據的不同部分。${Kit.btn("合併並重新分析", { variant: "secondary", size: "sm", attrs: { "data-tg": "mergeDrafts", "data-keys": g.map((d) => d.key).join(",") } })}</div>`,
      )
      .join("");
    const pickedBar =
      picked.size >= 2
        ? `<div class="notice tg-merge">已選 ${picked.size} 張相片。${Kit.btn("合併所選（同一張收據）", { variant: "secondary", size: "sm", attrs: { "data-tg": "mergeDrafts", "data-keys": [...picked].join(",") } })}</div>`
        : "";
    box.innerHTML = `${suggestions}${pickedBar}<div class="tg-drafts-head"><b>待確認收據 ${finished}/${all.length}</b>${ready ? Kit.btn(`全部加入（${ready}）`, { variant: "primary", size: "sm", icon: "check", attrs: { "data-tg": "draftsAddAll" } }) : ""}</div><div class="tg-progress" role="progressbar" aria-label="收據分析進度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><div style="width:${pct}%"></div></div><p class="note">${uploading ? `${uploading} 張正在上載${navigator.onLine ? "" : "（離線中，有網絡時會繼續）"}。` : ""}收據在背景分析，可以關閉網頁，稍後回來確認。付款人及「分給」用下面的選擇；「可能重複」的不會在「全部加入」時加入。</p>${payBox(all)}${all.map((d) => draftHtml(d, all)).join("")}`;
    if (card && field) {
      const el = box.querySelector(`[data-draft="${card.dataset.draft}"] [data-df="${field}"]`);
      if (el) el.focus();
    }
  }
  async function queueReceipts(files) {
    const { fs } = fb;
    if (files.length > 10) {
      toast("一次最多 10 張，已取頭 10 張。");
      files = files.slice(0, 10);
    }
    const hashes = await Promise.all(files.map((f) => fileHash(f).catch(() => null))),
      known = knownHashes(),
      seen = new Map(),
      dups = [];
    files.forEach((f, i) => {
      const h = hashes[i];
      if (!h) return;
      const why = known.get(h) || (seen.has(h) ? `與這批的「${seen.get(h)}」是同一張相片` : "");
      if (why) dups.push({ i, text: `「${f.name || "相片"}」${why}` });
      else seen.set(h, f.name || "相片");
    });
    if (
      dups.length &&
      !(await UI.confirm("這些相片已經上載過", { list: dups.map((d) => d.text), ok: "仍然上載", cancel: "跳過這些相片" }))
    ) {
      const skip = new Set(dups.map((d) => d.i));
      files = files.filter((_, i) => !skip.has(i));
      hashes.splice(0, hashes.length, ...hashes.filter((_, i) => !skip.has(i)));
    }
    let n = 0;
    for (const [i, f] of files.entries()) {
      try {
        let images = await receiptImages(f);
        if (images.join("").length > 850000) images = [await shrink(f, 1400, 0.7)];
        const { ref, sent } = queueJob({ images, hashes: hashes[i] ? [hashes[i]] : [], file: String(f.name || "相片").slice(0, 120) });
        sent.catch((e) => {
          toast("未能上載收據，請確認你仍在旅伴名單。");
          console.error(e);
        });
        n++;
        bigCopy(f)
          .then((b) => putPhotos(ref.id, [b]))
          .then((photos) => fs.updateDoc(ref, { photos }))
          .catch((e) => console.warn("receipt photo upload", e));
      } catch (e) {
        photoError(f, e);
      }
    }
    if (n) toast(`已加入 ${n} 張收據，會在背景分析`);
  }
  const jobRef = (id) => tdoc("receiptJobs", id);
  async function addDraft(d, ask) {
    const { paidBy, split } = payOf(),
      amount = Number(d.amount);
    if (!String(d.title).trim() || !(amount > 0) || amount > 1e7) {
      toast("請檢查項目和金額。");
      return false;
    }
    if (!split.length) {
      toast("請在「分給」最少選一位旅伴。");
      return false;
    }
    const exp = {
        title: String(d.title).trim().slice(0, 80),
        amount: Math.round(amount * 100) / 100,
        currency: d.currency,
        paidBy,
        split,
        day: Number(d.day),
        items: d.items.slice(0, 30),
        ...(CATS[d.category] ? { category: d.category } : {}),
      },
      dup = duplicateOf(exp);
    if (dup && ask && !(await UI.confirm("似乎已經記錄過", { text: dupText(dup), ok: "仍然加入" }))) return false;
    const job = jobs.find((j) => j.id === d.key) || {};
    let receipts = job.photos || [];
    if (!receipts.length && d.photos.length) {
      try {
        toast("正在保存收據相片…");
        receipts = await putPhotos(d.key, d.photos.map(b64Blob));
      } catch (e) {
        console.warn("receipt photo upload", e);
        toast("收據相片未能保存（可能離線），開支照樣加入。");
      }
    }
    add("expenses", {
      ...exp,
      ...(receipts.length ? { receipts: receipts.slice(0, 4) } : {}),
      ...(job.hashes?.length ? { receiptHashes: job.hashes.slice(0, 4) } : {}),
    });
    fb.fs.deleteDoc(jobRef(d.key)).catch(() => {});
    jobs = jobs.filter((j) => j.id !== d.key);
    delete localEdits[d.key];
    return true;
  }
  // Receipt viewer: photos are read with the companion's login (getBlob), never through public links.
  async function showReceipts(id) {
    const e = state.expenses.find((x) => x.id === id);
    if (!e?.receipts?.length) return;
    $("#detailBody").innerHTML =
      `${Kit.sheetHead(esc(e.title), "收據")}<p class="note">${esc(dupText(e))}</p><div class="receipt-photos">載入中…</div>`;
    $("#detail").showModal();
    try {
      const { m, st } = await storage(),
        urls = await Promise.all(e.receipts.map(async (p) => URL.createObjectURL(await m.getBlob(m.ref(st, p)))));
      const box = $(".receipt-photos");
      if (box)
        box.innerHTML = urls
          .map((u, i) => `<a href="${u}" target="_blank" rel="noopener"><img src="${u}" alt="收據相片 ${i + 1}"></a>`)
          .join("");
      $("#detail").addEventListener("close", () => urls.forEach(URL.revokeObjectURL), { once: true });
    } catch (err) {
      const box = $(".receipt-photos");
      if (box) box.textContent = navigator.onLine ? "未能載入收據相片。" : "離線中，有網絡時才可查看收據相片。";
      console.error(err);
    }
  }

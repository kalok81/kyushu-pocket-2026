  // ---- Notes and coupons: photos for the note being written, AI fill from a photo or link ----
  // Photos picked for the note or coupon being written (shrunk JPEG, base64), shown under the form until it is sent.
  const NOTE_PHOTO_MAX = 3;
  let notePhotoDraft = [];
  const notePhotoPreview = () =>
    notePhotoDraft.map((p, i) => `<span class="note-photo-thumb"><img src="${photoSrc(p)}" alt="">${Kit.btn("移除相片", { icon: "x", iconOnly: true, size: "sm", cls: "thumb-del", attrs: { "data-note-photo-del": i } })}</span>`).join("");
  async function addNotePhotos(files) {
    for (const file of files.slice(0, NOTE_PHOTO_MAX - notePhotoDraft.length)) {
      try {
        let b64 = await shrink(file, 1280, 0.8);
        if (b64.length > 300000) b64 = await shrink(file, 1000, 0.7);
        if (b64.length > 300000) {
          toast("相片太大，請截圖細一點。");
          continue;
        }
        notePhotoDraft.push(b64);
        if (notePhotoDraft.length === 1) requestNoteFill({ images: [b64] });
      } catch (e) {
        toast(scanError(e));
      }
    }
    if (files.length > NOTE_PHOTO_MAX) toast(`每則最多 ${NOTE_PHOTO_MAX} 張相片。`);
    const box = $("#notePhotoPreview");
    if (box) box.innerHTML = notePhotoPreview();
  }
  // AI fill for the note / coupon form: the first photo added, or a link typed in 連結, becomes a noteFill job;
  // the answer fills only the fields that are still empty.
  let noteFillJob = null,
    noteFillDone = () => {};
  function noteFillStatus(text, busy) {
    const i = $("#noteFillInfo");
    if (i) i.textContent = text;
    noteFillDone();
    noteFillDone = busy ? Kit.busy(i, { seconds: 15 }) : () => {};
  }
  function requestNoteFill({ images, url }) {
    if (!navigator.onLine) return noteFillStatus("離線中，AI 未能分析，請自行填寫。", false);
    const job = queueJob({
      ...(images ? { images } : { url: url.slice(0, 500) }),
      kind: "noteFill",
      mode: state.noteKind === "coupon" ? "coupon" : "note",
      file: images ? "筆記相片" : (() => { try { return new URL(url).hostname.slice(0, 120); } catch { return "網頁"; } })(),
    });
    noteFillJob = job.id;
    job.sent.catch(() => {
      noteFillJob = null;
      noteFillStatus("未能送出給 AI，請自行填寫。", false);
    });
    noteFillStatus(images ? "AI 正在讀取相片…" : "AI 正在讀取網頁…", true);
  }
  function handleNoteFillJobs() {
    for (const j of jobs.filter((j) => j.kind === "noteFill" && (j.status === "done" || j.status === "failed"))) {
      if (j.id === noteFillJob) {
        noteFillJob = null;
        const f = $('[data-tg-form="note"]:not([data-place-id])');
        if (j.status === "failed" || !f) noteFillStatus(j.error || "AI 未能分析，請自行填寫。", false);
        else {
          const el = f.elements,
            r = j.result || {},
            put = (n, v) => {
              if (el[n] && v && !String(el[n].value).trim()) el[n].value = v;
            };
          if (f.dataset.kind === "coupon") {
            put("title", r.title);
            put("text", r.text);
            put("code", r.code);
            put("until", r.until);
          } else put("text", [r.title, r.text].filter(Boolean).join("\n"));
          const p = r.place && placeFor(r.place);
          if (p && el.placeQ && !el.placeQ.value) el.placeQ.value = placeLabel(p);
          noteFillStatus(
            r.kind === "coupon" && f.dataset.kind !== "coupon" ? "AI 已填入內容；看來是優惠券，可以按上面「🎟 優惠券」改為優惠券。" : "AI 已填入空白欄位，請檢查。",
            false,
          );
        }
      }
      fb.fs.deleteDoc(jobRef(j.id)).catch(() => {});
    }
  }
  function showNotePhoto(id, i) {
    const n = state.notes.find((x) => x.id === id),
      p = n?.photos?.[i];
    if (!p) return;
    $("#detailBody").innerHTML = `${Kit.sheetHead(esc(n.title || String(n.text || "").split("\n")[0].slice(0, 40)), n.kind === "coupon" ? "優惠券" : "筆記")}${n.code ? `<p class="coupon-code big"><b>${esc(n.code)}</b></p>` : ""}<img class="note-photo-full" src="${photoSrc(p)}" alt="">`;
    if (!$("#detail").open) $("#detail").showModal();
  }

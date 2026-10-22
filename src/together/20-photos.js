  // ---- Photos: decoding (HEIC too), shrinking, receipt strips and Firebase Storage copies ----
  // Browsers differ: try ImageBitmap (with and without EXIF rotation), then <img>; HEIC that the
  // browser cannot read is converted on the phone with the vendored heic2any (loaded only when needed).
  const isHeic = (f) => /hei[cf]/i.test(f.type || "") || /\.hei[cf]$/i.test(f.name || "");
  const viaImg = (blob) =>
    new Promise((ok, fail) => {
      const url = URL.createObjectURL(blob),
        img = new Image();
      img.onload = () => {
        ok(img);
        URL.revokeObjectURL(url);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        fail(new Error("img"));
      };
      img.src = url;
    });
  let heicLib;
  const loadHeic = () =>
    (heicLib ??= new Promise((ok, fail) => {
      const js = document.createElement("script");
      js.src = "vendor/heic2any/heic2any.min.js";
      js.onload = () => ok(window.heic2any);
      js.onerror = () => {
        heicLib = null;
        fail(new Error("heic2any"));
      };
      document.head.append(js);
    }));
  async function decodeImage(file) {
    for (const attempt of [
      () => createImageBitmap(file, { imageOrientation: "from-image" }),
      () => createImageBitmap(file),
      () => viaImg(file),
    ]) {
      try {
        return await attempt();
      } catch {}
    }
    if (!isHeic(file)) throw new Error("unsupported image");
    const out = await (await loadHeic())({ blob: file, toType: "image/jpeg", quality: 0.9 });
    return viaImg(Array.isArray(out) ? out[0] : out);
  }
  // Long receipts are cut into up to three overlapping strips so the total line stays legible to the AI.
  async function receiptImages(file) {
    const img = await decodeImage(file),
      w = img.naturalWidth || img.width,
      h = img.naturalHeight || img.height,
      parts = h / w > 3.2 ? 3 : h / w > 1.6 ? 2 : 1,
      toB64 = (c) =>
        new Promise((r) => c.toBlob(r, "image/jpeg", 0.8)).then((b) => {
          if (!b) throw new Error("encode");
          return new Promise((ok, fail) => {
            const fr = new FileReader();
            fr.onload = () => ok(String(fr.result).split(",")[1]);
            fr.onerror = fail;
            fr.readAsDataURL(b);
          });
        });
    const strip = h / parts,
      overlap = strip * 0.08,
      out = [];
    for (let i = 0; i < parts; i++) {
      const top = Math.max(0, i * strip - overlap),
        bottom = Math.min(h, (i + 1) * strip + overlap),
        sh = bottom - top,
        k = Math.min(1, 1600 / Math.max(w, sh)),
        c = document.createElement("canvas");
      c.width = Math.round(w * k);
      c.height = Math.round(sh * k);
      c.getContext("2d").drawImage(img, 0, top, w, sh, 0, 0, c.width, c.height);
      out.push(await toB64(c));
    }
    img.close?.();
    return out;
  }
  async function shrink(file, max = 1600, quality = 0.85) {
    const img = await decodeImage(file),
      w = img.naturalWidth || img.width,
      h = img.naturalHeight || img.height,
      k = Math.min(1, max / Math.max(w, h)),
      c = document.createElement("canvas");
    c.width = Math.round(w * k);
    c.height = Math.round(h * k);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    img.close?.();
    const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", quality));
    if (!blob) throw new Error("encode");
    return new Promise((ok, fail) => {
      const fr = new FileReader();
      fr.onload = () => ok(String(fr.result).split(",")[1]);
      fr.onerror = fail;
      fr.readAsDataURL(blob);
    });
  }
  const scanError = (e) =>
    /unsupported|heic|img|encode/.test(e?.message) ? "未能讀取這張相片，請改用 JPG 或 PNG，或直接影相。" : "未能處理這張相片。";
  // Receipt photos are also kept in Firebase Storage (receipts/{uid}/{job}-{n}.jpg, members only): a 2400px copy
  // uploaded in the background, or the job's own photos when the expense is added if that upload never finished.
  let storageMod;
  const storage = async () => {
    storageMod ??= await import("./vendor/firebase/firebase-storage.js");
    return { m: storageMod, st: storageMod.getStorage(fb.app) };
  };
  const b64Blob = (b64) => new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: "image/jpeg" });
  async function putPhotos(jobId, blobs) {
    const { m, st } = await storage();
    return Promise.all(
      blobs.map(async (b, i) => {
        const path = `receipts/${state.user.uid}/${jobId}-${i}.jpg`;
        await m.uploadBytes(m.ref(st, path), b, { contentType: "image/jpeg" });
        return path;
      }),
    );
  }
  async function dropPhotos(paths) {
    if (!paths?.length) return;
    try {
      const { m, st } = await storage();
      await Promise.all(paths.map((p) => m.deleteObject(m.ref(st, p)).catch(() => {})));
    } catch {}
  }
  async function bigCopy(file) {
    const b64 = await shrink(file, 2400, 0.9);
    return b64Blob(b64);
  }
  // Same photo file uploaded again: a SHA-256 fingerprint of the file, checked against waiting receipts and expenses.
  async function fileHash(file) {
    const h = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return [...new Uint8Array(h)]
      .slice(0, 16)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  function knownHashes() {
    const known = new Map();
    for (const e of state.expenses) for (const h of e.receiptHashes || []) known.set(h, `已記錄為開支：${dupText(e)}`);
    for (const j of jobs.filter((j) => !j.kind || j.kind === "receipt"))
      for (const h of j.hashes || []) known.set(h, `已在待確認收據：「${j.file}」`);
    return known;
  }

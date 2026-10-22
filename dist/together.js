"use strict";
// Sign-in gate, trip choice, trip data, shared notes/expenses/shopping list, plan edits and favourites (Firebase).
// Each trip lives under trips/{tripId} (its own member list); the public site holds no trip details.
// Generated from src/together/*.js by scripts/build.mjs — edit those files, not this one.
window.Together = (() => {
  // ---- Firebase config, shared state and helpers (Firestore paths, adding/updating/removing, people) ----
  // Firebase web config is public by design; access is enforced by firestore.rules and the member list.
  const config = {
    apiKey: "AIzaSyC_qsxlY9mX0OKK5bIXwUXvrrxCOFnc18M",
    authDomain: "kyushu-2e307.firebaseapp.com",
    projectId: "kyushu-2e307",
    storageBucket: "kyushu-2e307.firebasestorage.app",
    messagingSenderId: "672657048901",
    appId: "1:672657048901:web:d1e2f7dd92389f78f3ea2c",
  };
  const APP_CHECK_KEY = "6Lfpt_otAAAAADBIq06Vcd_4KI5NJtGosFA4ZlTG";
  const state = {
    status: "idle",
    error: "",
    user: null,
    tab: "notes",
    day: 1,
    notes: [],
    expenses: [],
    checklist: [],
    members: [],
    shopping: [],
    places: [],
    planDays: [],
    hotels: [],
    flights: [],
    placesLoaded: false,
    shopFilter: "todo",
    shopSearch: "",
    shopView: "list",
    shopEdit: null,
    fx: null,
    liveFx: null,
    settleMode: null,
  };
  const T = () => window.TripApp,
    S = window.Split,
    $ = (s) => document.querySelector(s);
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  // Message for a failed Cloud Function call: the function's own (Chinese) message, a clear one when the App Check
  // security check failed (the SDK then waits a day before retrying), else the fallback.
  const fnError = (e, fallback) =>
    e?.code === "functions/unauthenticated" || /appCheck/i.test(String(e?.code || e?.message || ""))
      ? "這部手機未能通過安全驗證，地圖及 AI 功能暫時不能使用；請稍後再試，或用另一個瀏覽器。"
      : String(e?.code || "").startsWith("functions/") && e.message
        ? e.message.replace(/\s*\[\d+\]$/, "")
        : fallback;
  const toast = (s) => window.UI.toast(s);
  const header = (k, t, p) => `<div class="pagehead"><div class="eyebrow">${k}</div><h1>${t}</h1>${p ? `<p>${p}</p>` : ""}</div>`;
  let fb,
    loading,
    unsub = [],
    started = false,
    tripId = null;
  const tcol = (name) => fb.fs.collection(fb.db, "trips", tripId, name),
    tdoc = (name, id) => fb.fs.doc(fb.db, "trips", tripId, name, String(id));
  const TRIP_KEY = "pocket-trip",
    lastTrip = {
      get() {
        try {
          return localStorage.getItem(TRIP_KEY);
        } catch {
          return null;
        }
      },
      set(v) {
        try {
          localStorage.setItem(TRIP_KEY, v);
        } catch {}
      },
    };
  function add(name, data) {
    const { fs, db } = fb,
      u = state.user;
    fs.addDoc(tcol(name), { ...data, by: u.uid, byName: me().name, at: Date.now(), createdAt: fs.serverTimestamp() }).catch(() =>
      toast("未能儲存，請確認你仍在旅伴名單。"),
    );
    toast(navigator.onLine ? "已加入" : "已加入，有網絡時會自動同步");
  }
  // Receipt photos are shrunk on the phone, read by the scanReceipt Cloud Function, then only fill the form.
  let functionsModule;
  const callable = async (name, timeout) => {
    functionsModule ??= await import("./vendor/firebase/firebase-functions.js");
    return functionsModule.httpsCallable(functionsModule.getFunctions(fb.app, "asia-northeast1"), name, { timeout });
  };
  function update(name, id, data) {
    fb.fs.updateDoc(tdoc(name, id), data).catch(() => toast("未能儲存，請再試。"));
  }
  async function remove(name, id) {
    if (
      !(await UI.confirm("確定刪除？", {
        text: name === "expenses" ? "所有旅伴都會看不到這項，收據相片亦會一併刪除。" : "所有旅伴都會看不到這項。",
        danger: true,
        ok: "刪除",
      }))
    )
      return;
    const paths = name === "expenses" ? state.expenses.find((e) => e.id === id)?.receipts : null;
    fb.fs.deleteDoc(tdoc(name, id)).then(
      () => dropPhotos(paths),
      () => toast("未能刪除，請再試。"),
    );
  }
  const me = () => {
    const u = state.user;
    return { id: u.uid, name: state.members.find((m) => m.id === u.uid)?.name || u.displayName || u.email.split("@")[0] };
  };
  const people = () => {
    const list = state.members.map((m) => ({ id: m.id, name: m.name || "旅伴" }));
    if (state.user && !list.some((m) => m.id === state.user.uid)) list.push(me());
    return list.sort((a, b) => a.name.localeCompare(b.name));
  };
  const nameOf = (uid) => people().find((p) => p.id === uid)?.name || "旅伴";
  const dayLabel = (n) => {
    const d = T().days[n - 1];
    return d ? `D${d.n} ${d.date} ${d.region}` : "";
  };
  const today = () => {
    const now = new Date(),
      iso = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")}`;
    return T().days.find((d) => d.iso === iso)?.n || 1;
  };
  const dayOptions = (sel) =>
    T()
      .days.map((d) => `<option value="${d.n}"${d.n === sel ? " selected" : ""}>${esc(dayLabel(d.n))}</option>`)
      .join("");
  const when = (at) =>
    at ? new Date(at).toLocaleString("zh-HK", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  const meta = (x, extra = "") =>
    `<div class="tg-meta">${extra}<span>${esc(x.byName || "旅伴")} · ${esc(when(x.at))}</span>${x.pending ? '<span class="tg-pending">未同步</span>' : ""}</div>`;
  const del = (name, x) => `<button class="smallbtn" data-tg-del="${name}:${esc(x.id)}" aria-label="刪除">刪除</button>`;
  // ---- Loading Firebase, signing in, choosing the trip and listening to its collections ----
  function load() {
    if (fb) return Promise.resolve(fb);
    if (loading) return loading;
    state.status = "loading";
    state.error = "";
    refresh();
    loading = Promise.all(["app", "auth", "firestore", "app-check"].map((n) => import(`./vendor/firebase/firebase-${n}.js`)))
      .then(([app, auth, fs, check]) => {
        const a = app.initializeApp(config);
        // App Check (reCAPTCHA Enterprise) shows requests come from this site; the Google Maps and trip functions require it.
        try {
          check.initializeAppCheck(a, {
            provider: new check.ReCaptchaEnterpriseProvider(APP_CHECK_KEY),
            isTokenAutoRefreshEnabled: true,
          });
        } catch (e) {
          console.warn("App Check", e);
        }
        let db;
        try {
          db = fs.initializeFirestore(a, {
            localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
          });
        } catch {
          db = fs.getFirestore(a);
        }
        fb = { app: a, auth: auth.getAuth(a), A: auth, db, fs };
        auth.onAuthStateChanged(fb.auth, (user) => {
          stop();
          state.user = user;
          if (!user) {
            if (started) return location.reload();
            state.status = "signedOut";
            refresh();
            return;
          }
          state.status = "checking";
          refresh();
          chooseTrip();
        });
        return fb;
      })
      .catch((e) => {
        loading = null;
        state.status = "error";
        state.error = "未能載入共用功能，請檢查網絡後再試。";
        refresh();
        throw e;
      });
    return loading;
  }
  function stop() {
    unsub.forEach((u) => u());
    unsub = [];
    jobs = [];
    Object.assign(state, {
      notes: [],
      expenses: [],
      checklist: [],
      members: [],
      shopping: [],
      places: [],
      planDays: [],
      hotels: [],
      flights: [],
      placesLoaded: false,
      fx: null,
    });
  }
  // Trips this companion belongs to (trips/{id}.members holds lower-case emails); open the last one used.
  async function chooseTrip() {
    const { fs, db } = fb,
      email = String(state.user.email || "").toLowerCase();
    try {
      const snap = await fs.getDocs(fs.query(fs.collection(db, "trips"), fs.where("members", "array-contains", email)));
      state.trips = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => String(b.startDate || "").localeCompare(String(a.startDate || "")));
    } catch (e) {
      state.status = e.code === "permission-denied" ? "denied" : "error";
      state.error = e.code === "permission-denied" ? "" : "未能載入旅程，請稍後再試。";
      refresh();
      return;
    }
    if (!state.trips.length) {
      state.status = "notrip";
      refresh();
      return;
    }
    const keep = state.trips.find((t) => t.id === lastTrip.get()) || state.trips[0];
    tripId = keep.id;
    lastTrip.set(tripId);
    state.meta = keep;
    document.title = `${keep.name} · 口袋旅伴`;
    const sub = $(".brand small");
    if (sub) sub.textContent = keep.name;
    listen();
  }
  function switchTrip(id) {
    if (id && id !== tripId) {
      lastTrip.set(id);
      location.reload();
    }
  }
  function listen() {
    const { fs, db } = fb;
    const watch = (name) =>
      fs.onSnapshot(
        tcol(name),
        { includeMetadataChanges: true },
        (snap) => {
          state[name] = snap.docs
            .map((d) => ({ ...d.data(), id: d.id, pending: d.metadata.hasPendingWrites }))
            .sort((a, b) => (b.at || 0) - (a.at || 0));
          if (state.status !== "ready") {
            state.status = "ready";
            saveProfile();
          }
          if (name === "shopping" && started) {
            setTimeout(geocodeShopping, 1000);
            T().shoppingChanged?.();
          }
          if (name === "notes" && started) T().shoppingChanged?.();
          if (name === "places") {
            state.placesLoaded = true;
            if (started) T().applyPlaceEdits(state.places);
            else start();
          }
          if (name === "planDays" && started) T().applyPlanEdits(planMap());
          if ((name === "hotels" || name === "flights") && started) {
            T().refreshLists();
            const box = $("#detailBody [data-docs-for]");
            if (box && $("#detail").open) {
              const [k, i] = box.dataset.docsFor.split(":");
              if (k === name) openDocs(k, i);
            }
          }
          if (name === "members" && started) syncFavorites();
          refresh();
        },
        (err) => {
          stop();
          state.status = err.code === "permission-denied" ? "denied" : "error";
          state.error = err.code === "permission-denied" ? "" : "同步失敗，請稍後再試。";
          refresh();
        },
      );
    const watchJobs = fs.onSnapshot(
      fs.query(tcol("receiptJobs"), fs.where("by", "==", state.user.uid)),
      { includeMetadataChanges: true },
      (snap) => {
        jobs = snap.docs
          .map((d) => ({ ...d.data(), id: d.id, uploading: d.metadata.hasPendingWrites }))
          .sort((a, b) => (a.at || 0) - (b.at || 0));
        renderDrafts();
        handleFillJobs();
        const sp = $("#shopPage");
        if (sp) paint(sp, shopPage());
      },
      (e) => console.error("receipt jobs", e),
    );
    const watchFx = fs.onSnapshot(
      tdoc("settings", "fx"),
      (snap) => {
        state.fx = snap.data() || null;
        refresh();
      },
      () => {},
    );
    loadFx();
    unsub = [
      watchJobs,
      watchFx,
      ...["notes", "expenses", "checklist", "members", "shopping", "places", "planDays", "hotels", "flights"].map(watch),
    ];
  }
  // The trip page starts once its places have loaded (pins come from the places themselves).
  function start() {
    if (started || !state.placesLoaded) return;
    started = true;
    window.TRIP_GEO = { places: {} };
    document.body.classList.remove("locked");
    window.startTrip(state.meta);
    T().applyPlaceEdits(state.places);
    T().applyPlanEdits(planMap());
    syncFavorites();
    setTimeout(geocodeShopping, 1500);
  }
  async function logout() {
    if (!(await UI.confirm("確定登出？", { text: "登出後，這部手機會刪除已下載的旅程資料。", ok: "登出" }))) return;
    try {
      await fb.A.signOut(fb.auth);
      await fb.fs.terminate(fb.db);
      await fb.fs.clearIndexedDbPersistence(fb.db);
    } catch {}
    location.reload();
  }
  function saveProfile() {
    const u = state.user;
    fb.fs
      .setDoc(
        tdoc("members", u.uid),
        { name: (u.displayName || u.email.split("@")[0]).slice(0, 40), email: u.email, at: Date.now() },
        { merge: true },
      )
      .catch(() => {});
  }
  // Account IDs map to addresses on a reserved domain; accounts are created with scripts/accounts.mjs.
  const ACCOUNT_DOMAIN = "kyushu-trip.invalid",
    authError = (e) =>
      ({
        "auth/invalid-credential": "帳號或密碼不正確。",
        "auth/wrong-password": "帳號或密碼不正確。",
        "auth/user-not-found": "帳號或密碼不正確。",
        "auth/invalid-email": "帳號格式不正確。",
        "auth/too-many-requests": "嘗試次數太多，請稍後再試。",
        "auth/network-request-failed": "未能連線，請檢查網絡。",
        "auth/unauthorized-domain": "這個網址未加入 Firebase 登入網域。",
        "auth/operation-not-allowed": "這種登入方式未啟用。",
      })[e.code] || "登入失敗，請再試。";
  async function login() {
    try {
      await load();
      const p = new fb.A.GoogleAuthProvider();
      try {
        await fb.A.signInWithPopup(fb.auth, p);
      } catch (e) {
        if (["auth/popup-blocked", "auth/operation-not-supported-in-environment"].includes(e.code))
          await fb.A.signInWithRedirect(fb.auth, p);
        else throw e;
      }
    } catch (e) {
      if (e.code === "auth/popup-closed-by-user" || e.code === "auth/cancelled-popup-request") return;
      toast(authError(e));
    }
  }
  async function loginWithAccount(id, password) {
    const email = id.includes("@") ? id : `${id.toLowerCase()}@${ACCOUNT_DOMAIN}`;
    try {
      await load();
      await fb.A.signInWithEmailAndPassword(fb.auth, email, password);
    } catch (e) {
      toast(authError(e));
    }
  }
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
  // ---- Receipts read by AI in the background (receiptJobs), drafts, merging and duplicates ----
  // Receipts are read in the background: each photo becomes a receiptJobs document. Firestore keeps unsent
  // writes on the phone and retries after a reload, and the processReceipt function reads the receipt
  // server-side even if the page is closed. Payer and split come from the expense form when adding.
  let jobs = [];
  const localEdits = {};
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
      title: e.title ?? (r.merchant || "收據"),
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
    fs.addDoc(tcol("receiptJobs"), {
      images,
      hashes,
      file: group
        .map((d) => d.file)
        .join(" + ")
        .slice(0, 120),
      status: "pending",
      by: state.user.uid,
      byName: me().name,
      at: Date.now(),
      createdAt: fs.serverTimestamp(),
    }).then(
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
    const head = `<div class="tg-meta"><span class="badge">${STATUS[d.status]}</span><span>${esc(d.file)}</span>${pick}</div>`,
      retry = d.retry ? `<button type="button" class="smallbtn" data-draft-retry="${d.key}">重試</button>` : "",
      drop = `<button type="button" class="smallbtn" data-draft-drop="${d.key}">捨棄</button>`;
    if (d.status !== "done" && d.status !== "fail")
      return `<article class="tg-item tg-draft" data-draft="${d.key}">${head}<div class="tg-progress tg-progress-busy"><div></div></div>${d.retry ? `<p class="note">等候時間較長，可以按重試。</p><div class="links">${retry}${drop}</div>` : ""}</article>`;
    if (d.status === "fail")
      return `<article class="tg-item tg-draft" data-draft="${d.key}">${head}<p class="note">${esc(d.error || "未能讀取。")}</p><div class="links">${retry}${drop}</div></article>`;
    const warn = draftDup(d, all) || d.warn;
    return `<article class="tg-item tg-draft" data-draft="${d.key}">${head}<div class="tg-row"><label>項目<input data-df="title" maxlength="80" value="${esc(d.title)}"></label><label>金額<input data-df="amount" type="number" inputmode="decimal" min="0.01" step="0.01" value="${esc(d.amount)}"></label></div><div class="tg-row"><label>貨幣<select data-df="currency">${curOptions(d.currency)}</select></label><label>日子<select data-df="day">${dayOptions(d.day)}</select></label></div><label>分類<select data-df="category"><option value="">未分類</option>${catOptions(d.category)}</select></label>${d.items.length ? `<ul class="tg-lines">${d.items.map((i) => `<li><span>${esc(i.name)}</span><span>${esc(i.amount)}</span></li>`).join("")}</ul>` : ""}${warn ? `<p class="note tg-warn">${esc(warn)}</p>` : ""}${d.hint ? `<p class="note">ℹ️ ${esc(d.hint)}</p>` : ""}<div class="links"><button type="button" class="action primary" data-draft-add="${d.key}">加入</button>${drop}</div></article>`;
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
          `<div class="notice tg-merge">🧾 ${esc(g.map((d) => d.file).join("、"))} 似乎是同一張收據的不同部分。<button type="button" class="action primary" data-tg="mergeDrafts" data-keys="${g.map((d) => d.key).join(",")}">合併並重新分析</button></div>`,
      )
      .join("");
    const pickedBar =
      picked.size >= 2
        ? `<div class="notice tg-merge">已選 ${picked.size} 張相片。<button type="button" class="action primary" data-tg="mergeDrafts" data-keys="${[...picked].join(",")}">合併所選（同一張收據）</button></div>`
        : "";
    box.innerHTML = `${suggestions}${pickedBar}<div class="tg-drafts-head"><b>待確認收據 ${finished}/${all.length}</b>${ready ? `<button type="button" class="action primary" data-tg="draftsAddAll">全部加入（${ready}）</button>` : ""}</div><div class="tg-progress" role="progressbar" aria-label="收據分析進度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><div style="width:${pct}%"></div></div><p class="note">${uploading ? `${uploading} 張正在上載${navigator.onLine ? "" : "（離線中，有網絡時會繼續）"}。` : ""}收據在背景分析，可以關閉網頁，稍後回來確認。付款人及「分給」使用下面表格的設定；有 ⚠️ 的不會在「全部加入」時加入。</p>${all.map((d) => draftHtml(d, all)).join("")}`;
    if (card && field) {
      const el = box.querySelector(`[data-draft="${card.dataset.draft}"] [data-df="${field}"]`);
      if (el) el.focus();
    }
  }
  async function queueReceipts(files) {
    const { fs, db } = fb;
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
        const ref = fs.doc(tcol("receiptJobs"));
        fs.setDoc(ref, {
          images,
          hashes: hashes[i] ? [hashes[i]] : [],
          file: String(f.name || "相片").slice(0, 120),
          status: "pending",
          by: state.user.uid,
          byName: me().name,
          at: Date.now(),
          createdAt: fs.serverTimestamp(),
        }).catch((e) => {
          toast("未能上載收據，請確認你仍在旅伴名單。");
          console.error(e);
        });
        n++;
        bigCopy(f)
          .then((b) => putPhotos(ref.id, [b]))
          .then((photos) => fs.updateDoc(ref, { photos }))
          .catch((e) => console.warn("receipt photo upload", e));
      } catch (e) {
        toast(`${f.name || "相片"}：${scanError(e)}`);
        console.error(e);
      }
    }
    if (n) toast(`已加入 ${n} 張收據，會在背景分析`);
  }
  const jobRef = (id) => tdoc("receiptJobs", id);
  async function addDraft(d, ask) {
    const f = $('[data-tg-form="expense"]'),
      v = new FormData(f),
      split = v.getAll("split").map(String),
      amount = Number(d.amount);
    if (!String(d.title).trim() || !(amount > 0) || amount > 1e7) {
      toast("請檢查項目和金額。");
      return false;
    }
    if (!split.length) {
      toast("請在下面表格最少選一位分帳旅伴。");
      return false;
    }
    const exp = {
        title: String(d.title).trim().slice(0, 80),
        amount: Math.round(amount * 100) / 100,
        currency: d.currency,
        paidBy: String(v.get("paidBy")),
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
      `<div class="eyebrow">RECEIPT</div><h2 class="detailtitle">${esc(e.title)}</h2><p class="note">${esc(dupText(e))}</p><div class="receipt-photos">載入中…</div>`;
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
  // ---- 開支 (expenses): currencies, exchange rates, categories, statistics and settling up ----
  // The trip's local and home currencies (trips/{t}.currency, homeCurrency); names for the pickers.
  const CURRENCY_NAMES = {
    JPY: "日圓",
    HKD: "港幣",
    KRW: "韓圜",
    TWD: "新台幣",
    THB: "泰銖",
    CNY: "人民幣",
    SGD: "新加坡元",
    MYR: "馬幣",
    USD: "美元",
    EUR: "歐元",
    GBP: "英鎊",
    AUD: "澳元",
    CAD: "加元",
    VND: "越南盾",
    PHP: "菲律賓披索",
    IDR: "印尼盾",
  };
  const tripCurrencies = () => [...new Set([state.meta?.currency || "JPY", state.meta?.homeCurrency || "HKD"])];
  const curOptions = (sel) =>
    tripCurrencies()
      .map(
        (c) =>
          `<option value="${c}"${c === sel ? " selected" : ""}>${CURRENCY_NAMES[c] || c} ${window.Split.currencies[c]?.symbol || ""}</option>`,
      )
      .join("");
  const pickCur = (c) => (tripCurrencies().includes(c) ? c : tripCurrencies()[0]);
  const CATS = {
    food: "🍜 餐飲",
    transport: "🚃 交通",
    shopping: "🛍 購物",
    stay: "🏨 住宿",
    fun: "🎡 景點娛樂",
    other: "📦 其他",
  };
  const catOptions = (sel) =>
    Object.entries(CATS)
      .map(([k, v]) => `<option value="${k}"${k === sel ? " selected" : ""}>${v}</option>`)
      .join("");
  // Exchange rates into the home currency (home units per 1 unit): a rate a companion set (settings/fx, shared) wins over
  // the day's market rate from open.er-api.com (only currency codes are sent), cached on the phone for offline use.
  const home = () => state.meta?.homeCurrency || "HKD",
    FX_KEY = "pocket-fx-";
  const manualRate = (c) => {
    const r = state.fx?.rates?.[c];
    return typeof r === "number" && r > 0 ? r : null;
  };
  const liveRate = (c) => (state.liveFx?.home === home() && state.liveFx.rates[c]) || null;
  const rateOf = (c) => (c === home() ? 1 : manualRate(c) || liveRate(c));
  function loadFx() {
    const h = home();
    try {
      const c = JSON.parse(localStorage.getItem(FX_KEY + h) || "null");
      if (c?.home === h) state.liveFx = c;
    } catch {}
    if (!navigator.onLine || (state.liveFx && Date.now() - state.liveFx.fetched < 6 * 36e5)) return;
    fetch(`https://open.er-api.com/v6/latest/${h}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.result !== "success") return;
        const rates = {};
        for (const c of Object.keys(S.currencies)) if (j.rates?.[c] > 0) rates[c] = 1 / j.rates[c];
        state.liveFx = { home: h, rates, date: j.time_last_update_unix * 1000, fetched: Date.now() };
        try {
          localStorage.setItem(FX_KEY + h, JSON.stringify(state.liveFx));
        } catch {}
        refresh();
      })
      .catch(() => {});
  }
  const toHome = (e) => {
    const r = rateOf(e.currency);
    return r ? e.amount * r : null;
  };
  const fmtHome = (v) => S.format(Math.round(v * 10 ** S.currencies[home()].decimals), home());
  async function setRate(c) {
    const h = home(),
      live = liveRate(c),
      cur = manualRate(c);
    const v = await UI.prompt(
      `1 ${CURRENCY_NAMES[c] || c} = 幾多${CURRENCY_NAMES[h] || h}？`,
      cur ? String(cur) : "",
      live ? `留空＝自動匯率 ${+live.toPrecision(4)}` : "例如 0.052",
    );
    if (v == null) return;
    const n = Number(v.trim());
    if (v.trim() && !(n > 0 && n < 1e6)) return toast("匯率不正確。");
    const rates = { ...(state.fx?.rates || {}) };
    if (v.trim()) rates[c] = n;
    else delete rates[c];
    fb.fs
      .setDoc(tdoc("settings", "fx"), { rates, by: state.user.uid, byName: me().name, at: Date.now() })
      .catch(() => toast("未能儲存匯率，請再試。"));
    toast(v.trim() ? "已設定匯率，所有旅伴都會使用" : "已改回自動匯率");
  }
  const itemRow = (it = {}) =>
    `<div class="tg-line-row"><input name="itemName" maxlength="40" placeholder="物品" aria-label="物品" value="${esc(it.name ?? "")}"><input name="itemAmount" type="number" inputmode="decimal" min="0" max="10000000" step="0.01" placeholder="金額" aria-label="金額" value="${it.amount ?? ""}"><button type="button" class="smallbtn" data-tg="itemDel" aria-label="移除物品">×</button></div>`;
  // Same receipt twice: same amount and currency, plus the same day or the same shop name.
  const sameName = (a, b) => String(a).replace(/\s+/g, "").toLowerCase() === String(b).replace(/\s+/g, "").toLowerCase();
  const duplicateOf = ({ title, amount, currency, day }) =>
    state.expenses.find(
      (e) => e.currency === currency && Math.abs(e.amount - amount) < 0.005 && (e.day === day || sameName(e.title, title)),
    );
  const dupText = (e) =>
    `${dayLabel(e.day)}「${e.title}」${S.format(S.toMinor(e.amount, e.currency), e.currency)}（${e.byName || "旅伴"} 記錄）`;
  function expenseItem(e) {
    const h = e.currency !== home() && toHome(e);
    return `<article class="tg-item">${meta(e, `<span class="badge">${esc(dayLabel(e.day))}</span><button type="button" class="badge tg-cat${CATS[e.category] ? "" : " none"}" data-exp-cat="${esc(e.id)}" aria-label="更改分類">${CATS[e.category] || "＋ 分類"}</button>`)}<div class="tg-expense"><h3>${esc(e.title)}</h3><b>${esc(S.format(S.toMinor(e.amount, e.currency), e.currency))}${h ? `<small class="tg-conv">≈ ${esc(fmtHome(h))}</small>` : ""}</b></div>${e.items?.length ? `<ul class="tg-lines">${e.items.map((i) => `<li><span>${esc(i.name)}</span>${i.amount != null ? `<span>${esc(S.format(S.toMinor(i.amount, e.currency), e.currency))}</span>` : ""}</li>`).join("")}</ul>` : ""}<p class="note">${esc(nameOf(e.paidBy))} 付款 · 分給 ${esc((e.split || []).map(nameOf).join("、"))}</p><div class="links">${e.receipts?.length ? `<button class="action" data-receipts="${esc(e.id)}">🧾 收據（${e.receipts.length}）</button>` : ""}${del("expenses", e)}</div></article>`;
  }
  // Spending overview in the home currency: total, per companion, per day and per category, and the rates used.
  function stats() {
    const list = state.expenses.filter((e) => S.currencies[e.currency]);
    if (!list.length) return "";
    const h = home(),
      curs = [...new Set([...tripCurrencies(), ...list.map((e) => e.currency)])].filter((c) => c !== h);
    const rateRow = (c) => {
      const m = manualRate(c),
        r = rateOf(c);
      return `<li><span>1 ${c} = ${r ? +r.toPrecision(4) : "？"} ${h}</span><span class="note">${m ? `手動設定${state.fx?.byName ? `（${esc(state.fx.byName)}）` : ""}` : r ? `自動 · ${new Date(state.liveFx.date).toLocaleDateString("zh-HK", { month: "numeric", day: "numeric" })}` : "未有匯率（需要網絡）"}</span><button type="button" class="smallbtn" data-fx-set="${c}">設定</button></li>`;
    };
    const rates = curs.length
      ? `<details class="tg-fx"${state.fxOpen ? " open" : ""}><summary>匯率</summary><ul>${curs.map(rateRow).join("")}</ul><p class="note">自動匯率每日更新；可以改用你們實際兌換的匯率，所有旅伴共用。</p></details>`
      : "";
    const missing = [...new Set(list.map((e) => e.currency))].filter((c) => !rateOf(c));
    if (missing.length)
      return `<section class="panel tg-stats"><h3>開支統計</h3><p class="note">未有 ${missing.join("、")} 的匯率，暫時未能換算成${CURRENCY_NAMES[h] || h}。連上網絡或手動設定匯率即可。</p>${rates}</section>`;
    const add = (m, k, v) => m.set(k, (m.get(k) || 0) + v),
      days = new Map(),
      cats = new Map(),
      paid = new Map(),
      share = new Map();
    let total = 0;
    for (const e of list) {
      const v = toHome(e);
      total += v;
      add(days, e.day, v);
      add(cats, CATS[e.category] ? e.category : "", v);
      add(paid, e.paidBy, v);
      (e.split || []).forEach((u) => add(share, u, v / e.split.length));
    }
    const bars = (rows) => {
      const max = Math.max(...rows.map((r) => r[1]), 1);
      return `<div class="tg-bars">${rows.map(([k, v]) => `<div class="tg-bar"><span>${esc(k)}</span><div><i style="width:${Math.max(2, (v / max) * 100).toFixed(1)}%"></i></div><b>${esc(fmtHome(v))}</b></div>`).join("")}</div>`;
    };
    const ppl = [...new Set([...paid.keys(), ...share.keys()])],
      nDays = days.size;
    return `<section class="panel tg-stats"><h3>開支統計</h3><div class="tg-total"><b>${esc(fmtHome(total))}</b><span>合共 ${list.length} 筆${nDays > 1 ? ` · 平均每日 ${esc(fmtHome(total / nDays))}` : ""}</span></div>
  <h4>每人</h4><ul class="tg-people">${ppl.map((u) => `<li><b>${esc(nameOf(u))}</b><span>分擔 ${esc(fmtHome(share.get(u) || 0))}</span><span class="note">已付 ${esc(fmtHome(paid.get(u) || 0))}</span></li>`).join("")}</ul>
  <h4>按類別</h4>${bars([...cats].sort((a, b) => b[1] - a[1]).map(([k, v]) => [CATS[k] || "未分類", v]))}
  <h4>按日子</h4>${bars([...days].sort((a, b) => a[0] - b[0]).map(([d, v]) => [T().days[d - 1] ? `D${d} ${T().days[d - 1].date}` : `D${d}`, v]))}
  ${curs.some((c) => list.some((e) => e.currency === c)) ? `<p class="note">以${CURRENCY_NAMES[h] || h}計算。</p>` : ""}${rates}</section>`;
  }
  function summary() {
    const bal = S.balances(state.expenses),
      cs = Object.keys(bal),
      h = home();
    if (!cs.length) return "";
    const combined = cs.length > 1 || cs[0] !== h ? S.combine(bal, rateOf, h) : null,
      mode = combined ? state.settleMode || "home" : "each";
    const moveRows = (moves, c) =>
      moves.length
        ? moves
            .map((m) => `<p><b>${esc(nameOf(m.from))}</b> 要畀 <b>${esc(nameOf(m.to))}</b> ${esc(S.format(m.amount, c))}</p>`)
            .join("")
        : "<p>已經清數。</p>";
    const toggle = combined
      ? `<div class="chips tg-settle-mode"><button type="button" class="chip${mode === "home" ? " active" : ""}" data-settle="home">全部換成${CURRENCY_NAMES[h] || h}</button><button type="button" class="chip${mode === "each" ? " active" : ""}" data-settle="each">各貨幣分開</button></div>`
      : "";
    const body =
      mode === "home"
        ? `<div class="tg-currency">${moveRows(S.settle(combined), h)}</div><p class="note">按目前匯率把各貨幣換算成${CURRENCY_NAMES[h] || h}後一次過結算。</p>`
        : `${cs
            .map((c) => {
              const total = state.expenses.filter((e) => e.currency === c).reduce((t, e) => t + S.toMinor(e.amount, c), 0);
              return `<div class="tg-currency"><div class="eyebrow">${c} · 合共 ${esc(S.format(total, c))}</div>${moveRows(S.settle(bal[c]), c)}</div>`;
            })
            .join("")}<p class="note">各貨幣分開計算，不作匯率換算。</p>`;
    return `<section class="panel tg-summary"><h3>分帳結算</h3>${toggle}${body}</section>`;
  }
  // ---- 共用 page (notes, expenses, checklist): lists, forms and the slots on other pages ----
  const tabs = { notes: "筆記", expenses: "開支", checklist: "清單" };
  const CHECK_GROUPS = { pre: "行前準備", pack: "行李", other: "其他" };
  const CHECK_SUGGEST = {
    pre: ["旅遊保險", "網卡／eSIM", "兌換外幣", "入境登記／簽證", "預約機場交通"],
    pack: ["護照", "信用卡及現金", "手機充電器", "尿袋", "轉插", "常用藥物", "換洗衣物", "雨傘", "個人用品", "購物袋"],
  };
  function noteItem(n) {
    const place = n.placeName ? `<span class="badge">${esc(n.placeName)}</span>` : "",
      day = n.day ? `<span class="badge">${esc(dayLabel(n.day))}</span>` : "";
    return `<article class="tg-item">${meta(n, day + place)}<p class="tg-text">${esc(n.text)}</p>${del("notes", n)}</article>`;
  }
  const tripSwitch = () =>
    state.trips?.length > 1
      ? `<select class="trip-switch" data-trip-switch aria-label="切換旅程">${state.trips.map((t) => `<option value="${esc(t.id)}"${t.id === tripId ? " selected" : ""}>${esc(t.name)}</option>`).join("")}</select>`
      : `<span class="trip-name">${esc(state.meta?.name || "")}</span>`;
  function statusBar() {
    const online = navigator.onLine,
      pending = ["notes", "expenses", "shopping", "checklist"].reduce((t, k) => t + state[k].filter((x) => x.pending).length, 0);
    return `${tripSwitch()}<span>已登入：<b>${esc(me().name)}</b></span><span class="tg-pending-${online ? "on" : "off"}">${online ? (pending ? `${pending} 項同步中…` : "已同步") : "離線中 · 修改會在有網絡時同步"}</span><button class="smallbtn" data-tg="logout">登出</button>`;
  }
  function lists() {
    if (state.tab === "notes")
      return state.notes.length
        ? state.notes.map(noteItem).join("")
        : '<div class="empty"><h2>還沒有筆記</h2><p>寫下提醒、想吃的東西或任何旅程點滴。</p></div>';
    if (state.tab === "checklist") return checklist();
    if (state.tab === "expenses")
      return (
        stats() +
        summary() +
        (state.expenses.length
          ? state.expenses.map(expenseItem).join("")
          : '<div class="empty"><h2>還沒有開支</h2><p>每筆開支記下誰付款、分給誰，網站會計算誰要畀誰。</p></div>')
      );
  }
  // Shared checklist: everyone sees the same items and ticks them off for themselves (doneBy holds their uids).
  function checklist() {
    const me = state.user.uid,
      items = [...state.checklist].sort((a, b) => (a.at || 0) - (b.at || 0));
    if (!items.length)
      return '<div class="empty"><h2>還沒有清單</h2><p>加入要準備和要帶的東西，每位旅伴各自剔選。</p><button type="button" class="action primary" data-tg="checkSuggest">加入建議項目</button></div>';
    const mine = items.filter((i) => (i.doneBy || []).includes(me)).length,
      ppl = people();
    const row = (i) => {
      const done = (i.doneBy || []).includes(me),
        others = (i.doneBy || []).filter((u) => u !== me).map(nameOf);
      return `<li class="check-row${done ? " done" : ""}"><label><input type="checkbox" data-check="${esc(i.id)}"${done ? " checked" : ""}><span>${esc(i.text)}</span></label>${ppl.length > 1 ? `<small>${others.length ? `✓ ${esc(others.join("、"))}` : ""}</small>` : ""}<button type="button" class="smallbtn" data-tg-del="checklist:${esc(i.id)}" aria-label="刪除 ${esc(i.text)}">×</button></li>`;
    };
    return `<div class="check-progress"><b>你已完成 ${mine}／${items.length}</b><div class="tg-progress"><div style="width:${Math.round((mine / items.length) * 100)}%"></div></div></div>${Object.entries(
      CHECK_GROUPS,
    )
      .map(([g, label]) => {
        const list = items.filter((i) => (CHECK_GROUPS[i.group] ? i.group : "other") === g);
        return list.length
          ? `<section class="panel check-group"><h3>${label}</h3><ul>${list.map(row).join("")}</ul></section>`
          : "";
      })
      .join("")}<button type="button" class="smallbtn" data-tg="checkSuggest">＋ 加入未有的建議項目</button>`;
  }
  function addSuggestions() {
    const have = new Set(state.checklist.map((i) => i.text.trim()));
    let n = 0;
    for (const [group, list] of Object.entries(CHECK_SUGGEST))
      for (const text of list)
        if (!have.has(text)) {
          fb.fs
            .addDoc(tcol("checklist"), {
              text,
              group,
              doneBy: [],
              by: state.user.uid,
              byName: me().name,
              at: Date.now() + n,
              createdAt: fb.fs.serverTimestamp(),
            })
            .catch(() => {});
          n++;
        }
    toast(n ? `已加入 ${n} 項` : "建議項目已全部在清單內");
  }
  function forms() {
    if (state.tab === "checklist")
      return `<form class="panel tg-form check-form" data-tg-form="check"><div class="tg-row"><label>項目<input name="text" maxlength="60" required placeholder="例如：護照、尿袋"></label><label>分類<select name="group">${Object.entries(
        CHECK_GROUPS,
      )
        .map(([k, v]) => `<option value="${k}">${v}</option>`)
        .join("")}</select></label></div><button type="submit" class="locate-button">加入清單</button></form>`;
    if (state.tab === "notes")
      return `<form class="panel tg-form" data-tg-form="note"><label>筆記<textarea name="text" rows="3" maxlength="1000" required placeholder="例如：別府那天記得帶毛巾"></textarea></label><label>關於<select name="day"><option value="">整個旅程</option>${dayOptions(0)}</select></label><button type="submit" class="locate-button">加入筆記</button></form>`;
    if (state.tab === "expenses") {
      const ps = people();
      return `<form class="panel tg-form" data-tg-form="expense"><div class="tg-scan"><button type="button" class="action primary" data-tg="scan">📷 影收據／上載收據（可多張）</button><input type="file" accept="image/*" id="tgReceipt" multiple hidden><p class="note">AI 在背景讀出店名、金額、日期及物品，可以關閉網頁，稍後回來確認。同一張收據分開影的相片會提示合併，也可以自己選擇合併。加入或捨棄後相片會刪除。</p></div><div id="tgDrafts" class="tg-drafts"></div><label>項目<input name="title" maxlength="80" required placeholder="例如：一蘭晚餐"></label><label>分類<select name="category"><option value="">未分類</option>${catOptions("")}</select></label><fieldset class="tg-lines-edit"><legend>物品（可留空）</legend><div id="tgItemRows">${itemRow()}</div><button type="button" class="smallbtn" data-tg="itemAdd">＋ 加物品</button></fieldset><div class="tg-row"><label>金額<input name="amount" type="number" inputmode="decimal" min="0.01" max="10000000" step="0.01" placeholder="留空＝物品合計"></label><label>貨幣<select name="currency">${curOptions(tripCurrencies()[0])}</select></label></div><div class="tg-row"><label>誰付款<select name="paidBy">${ps.map((p) => `<option value="${esc(p.id)}"${p.id === state.user.uid ? " selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label><label>日子<select name="day">${dayOptions(today())}</select></label></div><fieldset><legend>分給</legend>${ps.map((p) => `<label class="tg-check"><input type="checkbox" name="split" value="${esc(p.id)}" checked> ${esc(p.name)}</label>`).join("")}</fieldset><p class="note">旅伴第一次登入後，才會出現在名單中。</p><button type="submit" class="locate-button">記下開支</button></form>`;
    }
    return "";
  }
  function page() {
    const s = state.status;
    if (["idle", "loading", "checking"].includes(s))
      return { sig: s, shell: '<div class="empty"><h2>正在連接…</h2><p>第一次載入需要數秒。</p></div>' };
    if (s === "error")
      return {
        sig: s + state.error,
        shell: `<div class="empty"><h2>${esc(state.error || "發生錯誤")}</h2><button class="action primary" data-tg="retry">再試</button></div>`,
      };
    if (s === "signedOut")
      return {
        sig: s,
        shell: `<section class="panel tg-login"><h2>旅伴專用</h2><p>行程、地點、住宿、筆記和開支只限旅伴登入查看，不會公開在網站上。</p><form class="tg-form" data-tg-form="login"><label>帳號<input name="id" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="60" required></label><label>密碼<input name="password" type="password" autocomplete="current-password" required></label><button type="submit" class="locate-button">登入</button></form><div class="tg-or">或</div><button class="action tg-google" data-tg="login">用 Google 帳戶登入</button><p class="note">這部手機會記住登入狀態，之後離線也可以查看。</p></section>`,
      };
    if (s === "notrip")
      return {
        sig: s,
        shell: `<section class="panel tg-login"><h2>建立你的第一個旅程</h2><p>填好目的地和日期，之後可以加入行程、地點、住宿和旅伴。</p>${tripForm(null)}</section>`,
      };
    if (s === "denied")
      return {
        sig: s + state.user?.uid,
        shell: `<section class="panel tg-login"><h2>這個帳戶未加入任何旅程</h2><p>你已用 <b>${esc(state.user?.email)}</b> 登入，但未加入任何旅程。請旅程負責人把你加入旅伴名單，然後按再試。</p><div class="links"><button class="action primary" data-tg="retry">再試</button><button class="action" data-tg="logout">登出／換帳戶</button></div></section>`,
      };
    if (!started) return { sig: "trip", shell: '<div class="empty"><h2>正在載入旅程資料…</h2></div>' };
    const sig = [
      "ready",
      state.tab,
      state.day,
      state.user.uid,
      people()
        .map((p) => p.id + p.name)
        .join(),
    ].join("|");
    return {
      sig,
      shell: `<div class="tg-status" data-tg-live="status"></div><div class="chips" role="tablist">${Object.entries(tabs)
        .map(
          ([k, v]) =>
            `<button class="chip ${k === state.tab ? "active" : ""}" data-tg-tab="${k}" aria-pressed="${k === state.tab}">${v}</button>`,
        )
        .join("")}</div>${forms()}<div class="tg-list" data-tg-live="list"></div>`,
      live: { status: statusBar(), list: lists() },
    };
  }
  function daySlot(n) {
    if (state.status !== "ready") return { sig: "wait", shell: "" };
    const ns = state.notes.filter((x) => x.day === n);
    return {
      sig: "ready",
      shell: '<div data-tg-live="list"></div>',
      live: {
        list: `<div class="sectionhead"><h2>旅伴筆記</h2><a class="action" href="#together?tab=notes">＋ 加入筆記</a></div>${ns.length ? ns.map(noteItem).join("") : '<p class="note">這天還沒有旅伴筆記。</p>'}`,
      },
    };
  }
  function placeSlot(id) {
    if (state.status !== "ready") return { sig: "out", shell: "" };
    return {
      sig: "ready" + id,
      shell: `<section class="detail-section"><h3>旅伴筆記</h3><div data-tg-live="list"></div><form class="tg-form" data-tg-form="note" data-place-id="${esc(id)}"><textarea name="text" rows="2" maxlength="1000" required placeholder="寫下對這個地點的筆記"></textarea><button type="submit" class="action primary">加入筆記</button></form></section>`,
      live: {
        list:
          state.notes
            .filter((x) => x.placeId === id)
            .map(noteItem)
            .join("") || '<p class="note">還沒有筆記。</p>',
      },
    };
  }
  // ---- Trip data used by the trip page: places, day plans, hotels, flights, documents, favourites ----
  async function aiRoutes(data) {
    if (!navigator.onLine) throw new Error("offline");
    return (await (await callable("aiRoutes", 120000))(data)).data;
  }
  async function suggestRoutes(data) {
    if (!navigator.onLine) throw new Error("offline");
    return (await (await callable("suggestRoutes", 45000))(data)).data;
  }
  async function lookupPlace(url) {
    if (!navigator.onLine) throw new Error("offline");
    return (await (await callable("lookupPlace", 45000))({ url, country: state.meta?.country || "" })).data;
  }
  // Places: trips/{t}/places documents. A new one gets its id here so a plan stop can point at it straight away.
  function savePlace({ place, fields, cats, lat, lng, points = [], mapsUrl }) {
    const { fs, db } = fb,
      data = { fields, cats, lat, lng, points, mapsUrl, deleted: false };
    if (place) {
      update("places", place.overlayId, data);
      toast("已儲存");
    } else {
      const ref = fs.doc(tcol("places"));
      fs.setDoc(ref, {
        ...data,
        base: null,
        by: state.user.uid,
        byName: me().name,
        at: Date.now(),
        createdAt: fs.serverTimestamp(),
      }).catch(() => toast("未能儲存，請確認你仍在旅伴名單。"));
      toast(navigator.onLine ? "已加入" : "已加入，有網絡時會自動同步");
      return "u_" + ref.id;
    }
  }
  function deletePlace(place) {
    fb.fs.deleteDoc(tdoc("places", place.overlayId)).catch(() => toast("未能刪除，請再試。"));
  }
  // Day plans: planDays/{day} holds the stop list and title of that day; deleting it clears the day.
  const planMap = () => Object.fromEntries(state.planDays.map((d) => [Number(d.id), d]));
  function savePlanDay(day, stops) {
    fb.fs
      .setDoc(tdoc("planDays", String(day)), { stops, by: state.user.uid, byName: me().name, at: Date.now() }, { merge: true })
      .catch(() => toast("未能儲存行程，請再試。"));
  }
  function setDayLabel(day, label, stops) {
    fb.fs
      .setDoc(
        tdoc("planDays", String(day)),
        { stops, label, by: state.user.uid, byName: me().name, at: Date.now() },
        { merge: true },
      )
      .catch(() => toast("未能儲存，請再試。"));
  }
  // Hotels, flights, shopping and notes for the trip page (住宿, 機票, 資料簿).
  const tripLists = () => ({ hotels: state.hotels, flights: state.flights, shopping: state.shopping, notes: state.notes });
  function saveItem(name, id, data) {
    if (id) {
      update(name, id, data);
      toast("已儲存");
    } else add(name, data);
  }
  function removeItem(name, id) {
    const docs = (state[name] || []).find((x) => x.id === id)?.docs;
    fb.fs.deleteDoc(tdoc(name, id)).then(
      () => dropPhotos(docs?.map((d) => d.path)),
      () => toast("未能刪除，請再試。"),
    );
  }
  // Booking documents for a hotel or flight (e-tickets, confirmations, screenshots): Storage trips/{t}/docs/, readable only by
  // the trip's companions (storage.rules). Photos are shrunk to JPEG; PDFs are kept as they are (under 15 MB).
  const DOC_MAX = 6,
    docItem = (kind, id) => (state[kind] || []).find((x) => x.id === id);
  async function openDocs(kind, id) {
    const x = docItem(kind, id);
    if (!x) return;
    const docs = x.docs || [],
      title = kind === "hotels" ? x.name : `${x.flightNo} ${x.from || ""} → ${x.to || ""}`;
    $("#detailBody").innerHTML =
      `<div class="eyebrow" data-docs-for="${esc(kind)}:${esc(id)}">DOCUMENTS</div><h2 class="detailtitle">${esc(title)}</h2><p class="note">訂單確認、電子機票或截圖，只限這個旅程的旅伴登入查看。</p><div class="doc-list">${docs.length ? docs.map((d) => `<div class="doc-row" data-doc-path="${esc(d.path)}"><div class="doc-thumb">${d.type === "application/pdf" ? "PDF" : "…"}</div><div><b>${esc(d.name)}</b><small>${esc(d.byName || "")} · ${Math.max(1, Math.round(d.size / 1024))} KB</small></div><a class="action" data-doc-open hidden target="_blank" rel="noopener">打開</a><button type="button" class="smallbtn" data-doc-del="${esc(kind)}:${esc(id)}:${esc(d.path)}" aria-label="刪除 ${esc(d.name)}">刪除</button></div>`).join("") : '<div class="empty"><p>還沒有文件。</p></div>'}</div>${docs.length < DOC_MAX ? `<button type="button" class="action primary" data-doc-add>📎 上載文件（相片或 PDF）</button><input type="file" id="docInput" data-target="${esc(kind)}:${esc(id)}" accept="image/*,application/pdf" multiple hidden>` : `<p class="note">每項最多 ${DOC_MAX} 個文件。</p>`}`;
    if (!$("#detail").open) $("#detail").showModal();
    if (!docs.length) return;
    try {
      const { m, st } = await storage(),
        urls = [];
      $("#detail").addEventListener("close", () => urls.forEach(URL.revokeObjectURL), { once: true });
      await Promise.all(
        docs.map(async (d) => {
          const row = document.querySelector(`[data-doc-path="${CSS.escape(d.path)}"]`);
          try {
            const u = URL.createObjectURL(await m.getBlob(m.ref(st, d.path)));
            urls.push(u);
            if (!row) return;
            const a = row.querySelector("[data-doc-open]");
            a.href = u;
            a.hidden = false;
            if (d.type !== "application/pdf") row.querySelector(".doc-thumb").innerHTML = `<img src="${u}" alt="">`;
          } catch {
            if (row) row.querySelector(".doc-thumb").textContent = "✕";
          }
        }),
      );
    } catch (err) {
      console.error(err);
      toast(navigator.onLine ? "未能載入文件。" : "離線中，有網絡時才可查看文件。");
    }
  }
  async function uploadDocs(kind, id, files) {
    const x = docItem(kind, id);
    if (!x) return;
    const room = DOC_MAX - (x.docs?.length || 0);
    if (files.length > room) toast(`每項最多 ${DOC_MAX} 個文件，只會上載頭 ${room} 個。`);
    const added = [];
    toast("正在上載文件…");
    try {
      const { m, st } = await storage();
      for (const file of files.slice(0, room)) {
        const pdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
        if (pdf && file.size >= 15 * 1024 * 1024) {
          toast(`${file.name} 太大（上限 15 MB）`);
          continue;
        }
        const blob = pdf ? file : b64Blob(await shrink(file, 2400, 0.88)),
          type = pdf ? "application/pdf" : "image/jpeg";
        const path = `trips/${tripId}/docs/${kind}-${id}-${Date.now()}-${added.length}.${pdf ? "pdf" : "jpg"}`;
        await m.uploadBytes(m.ref(st, path), blob, { contentType: type });
        added.push({
          path,
          name: file.name.slice(0, 80),
          type,
          size: blob.size,
          by: state.user.uid,
          byName: me().name,
          at: Date.now(),
        });
      }
    } catch (err) {
      console.error(err);
      toast("有文件未能上載，請再試。");
    }
    if (!added.length) return;
    const fs = fb.fs;
    await fs
      .updateDoc(tdoc(kind, id), { docs: fs.arrayUnion ? fs.arrayUnion(...added) : [...(x.docs || []), ...added] })
      .catch(() => {
        toast("未能儲存文件，請再試。");
        dropPhotos(added.map((d) => d.path));
      });
    toast(`已上載 ${added.length} 個文件`);
  }
  async function deleteDocFile(kind, id, path) {
    const x = docItem(kind, id),
      d = x?.docs?.find((d) => d.path === path);
    if (!d || !(await UI.confirm(`刪除「${d.name}」？`, { text: "所有旅伴都會看不到這個文件。", danger: true, ok: "刪除" })))
      return;
    await fb.fs.updateDoc(tdoc(kind, id), { docs: x.docs.filter((v) => v.path !== path) }).then(
      () => dropPhotos([path]),
      () => toast("未能刪除，請再試。"),
    );
  }
  function resetPlanDay(day) {
    fb.fs.deleteDoc(tdoc("planDays", String(day))).then(
      () => toast("已清空這天"),
      () => toast("未能清空，請再試。"),
    );
  }
  // Favourites: members/{uid}.saved. The first time, seed with this device's stars.
  function syncFavorites() {
    const mine = state.members.find((m) => m.id === state.user?.uid);
    if (!mine || !started) return;
    if (Array.isArray(mine.saved)) {
      T().setSaved(mine.saved);
      return;
    }
    const seed = T().savedIds();
    saveFavorites(seed);
    T().setSaved(seed);
  }
  function saveFavorites(ids) {
    fb.fs
      .setDoc(tdoc("members", state.user.uid), { saved: ids.slice(0, 500) }, { merge: true })
      .catch(() => toast("未能同步收藏。"));
  }
  // ---- 購物 (shopping list): page, AI product photos, matching shops and geocoding ----
  // Product photos for the shopping list go through the same background jobs; the function adds the item itself.
  async function queueProducts(files) {
    if (files.length > 10) {
      toast("一次最多 10 張，已取頭 10 張。");
      files = files.slice(0, 10);
    }
    const { fs, db } = fb;
    let n = 0;
    for (const f of files) {
      try {
        let image = await shrink(f, 1000, 0.72);
        if (image.length > 380000) image = await shrink(f, 800, 0.65);
        fs.addDoc(tcol("receiptJobs"), {
          images: [image],
          kind: "product",
          file: String(f.name || "相片").slice(0, 120),
          status: "pending",
          by: state.user.uid,
          byName: me().name,
          at: Date.now(),
          createdAt: fs.serverTimestamp(),
        }).catch((e) => {
          toast("未能上載相片，請確認你仍在旅伴名單。");
          console.error(e);
        });
        n++;
      } catch (e) {
        toast(`${f.name || "相片"}：${scanError(e)}`);
        console.error(e);
      }
    }
    if (n) toast(`已加入 ${n} 張物品相片，AI 會在背景辨識並加入清單`);
  }
  function productJobsHtml() {
    const pj = jobs.filter((j) => j.kind === "product");
    if (!pj.length) return "";
    const busy = pj.filter((j) => j.status !== "failed").length;
    return `<div class="tg-drafts"><div class="tg-drafts-head"><b>${busy ? `AI 辨識中 ${busy} 張` : "未能辨識的相片"}</b></div>${pj
      .map((j) => {
        const st = jobState(j),
          fail = st === "fail",
          retry = canRetry(j);
        return `<article class="tg-item tg-draft" data-draft="${esc(j.id)}"><div class="tg-meta"><span class="badge">${fail ? "未能辨識" : STATUS[st]}</span><span>${esc(j.file)}</span></div>${fail ? `<p class="note">${esc(j.error || "未能辨識。")}</p>` : '<div class="tg-progress tg-progress-busy"><div></div></div>'}${fail || retry ? `<div class="links">${retry ? `<button type="button" class="smallbtn" data-draft-retry="${esc(j.id)}">重試</button>` : ""}<button type="button" class="smallbtn" data-draft-drop="${esc(j.id)}">捨棄</button></div>` : ""}</article>`;
      })
      .join("")}</div>`;
  }
  // Shopping list: item photos are stored inline (small JPEG) so they stay readable offline.
  let shopPhoto = null;
  const photoSrc = (b64) => `data:image/jpeg;base64,${b64}`;
  const shopPreview = () =>
    shopPhoto
      ? `<img src="${photoSrc(shopPhoto)}" alt="物品相片"><button type="button" class="smallbtn" data-tg="shopPhotoClear">移除相片</button>`
      : "";
  function shopForm(x) {
    const v = (k) => esc(x?.[k] ?? "");
    return `<form class="panel tg-form" data-tg-form="shop"><div class="shop-photo"><div id="shopPreview">${shopPreview()}</div><button type="button" class="action primary" data-tg="shopPhoto">📷 影相／上載圖片（AI 填寫）</button><input type="file" accept="image/*" id="shopPhotoInput" hidden><div class="tg-progress tg-progress-busy" id="shopFillBar" hidden><div></div></div><p class="note" id="shopFillInfo">加相片後，AI 會把物品資料填入下面的空白欄位。</p></div><label>物品<input name="name" maxlength="80" required placeholder="例如：明太子禮盒" value="${v("name")}"></label><div class="tg-row"><label>數量／規格<input name="qty" maxlength="30" placeholder="例如：2 盒、M 碼" value="${v("qty")}"></label><label>給誰／備註<input name="detail" maxlength="500" placeholder="例如：媽媽、要辣味" value="${v("detail")}"></label></div><label>購買地點／地址<input name="place" maxlength="500" placeholder="店名、地址，或貼上 Google 地圖連結" value="${v("place")}"></label><label>探索地點<select name="placeId"><option value="">自動（按購買地點名稱配對）</option><option value="-"${x?.placeId === "-" ? " selected" : ""}>不連結探索地點</option>${[...T().places]
      .sort((a, b) => a.v[0].localeCompare(b.v[0]) || a.v[1].localeCompare(b.v[1]))
      .map((p) => `<option value="${esc(p.id)}"${x?.placeId === p.id ? " selected" : ""}>${esc(p.v[1])}${p.v[0] ? ` · ${esc(p.v[0])}` : ""}</option>`)
      .join("")}</select></label><p class="note" id="shopPlaceInfo"></p><div class="tg-row"><label>價錢（可留空）<input name="price" type="number" inputmode="decimal" min="0" max="10000000" step="0.01" value="${x?.price ?? ""}"></label><label>貨幣<select name="currency">${curOptions(x?.currency || tripCurrencies()[0])}</select></label></div><div class="links"><button type="submit" class="locate-button">${x ? "儲存修改" : "加入購物清單"}</button>${x ? '<button type="button" class="action" data-tg="shopCancel">取消</button>' : ""}</div></form>`;
  }
  function shopItem(x) {
    const price = x.price != null ? `<b class="shop-price">${esc(S.format(S.toMinor(x.price, x.currency), x.currency))}</b>` : "";
    return `<article class="tg-item shop-item${x.bought ? " bought" : ""}">${x.photo ? `<img class="shop-thumb" src="${photoSrc(x.photo)}" alt="${esc(x.name)}" data-shop-zoom>` : ""}<div>${meta(x, x.ai ? '<span class="badge">AI 填寫</span>' : "")}<div class="tg-expense"><h3>${esc(x.name)}${x.qty ? ` <small>· ${esc(x.qty)}</small>` : ""}</h3>${price}</div>${x.detail ? `<p class="tg-text">${esc(x.detail)}</p>` : ""}${matchPlace(x) ? `<p class="shop-place">🏷 探索：<button type="button" class="buy-item" data-place="${esc(matchPlace(x).id)}">${esc(matchPlace(x).v[1])}</button></p>` : ""}${x.place ? `<p class="shop-place">📍 ${esc(x.place)} <a class="action" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(x.place)}" target="_blank" rel="noopener noreferrer">地圖 ↗</a></p>` : ""}${x.bought ? `<p class="note">✓ ${esc(x.boughtBy || "旅伴")} 已買 · ${esc(when(x.boughtAt))}</p>` : ""}<div class="links"><button class="action${x.bought ? "" : " primary"}" data-shop-toggle="${esc(x.id)}">${x.bought ? "↺ 改回未買" : "✓ 已買"}</button><button class="smallbtn" data-shop-edit="${esc(x.id)}">編輯</button>${del("shopping", x)}</div></div></article>`;
  }
  // Photo grid: one tile per item; tapping opens the item with a large photo in the detail dialog.
  function shopTile(x) {
    const price = x.price != null ? esc(S.format(S.toMinor(x.price, x.currency), x.currency)) : "";
    return `<button type="button" class="shop-tile${x.bought ? " bought" : ""}" data-shop-open="${esc(x.id)}">${x.photo ? `<img src="${photoSrc(x.photo)}" alt="" loading="lazy">` : '<span class="shop-tile-ph" aria-hidden="true">🛍</span>'}<span class="shop-tile-name">${x.bought ? "✓ " : ""}${esc(x.name)}</span>${price ? `<span class="shop-tile-price">${price}</span>` : ""}</button>`;
  }
  function openShopItem(id) {
    const x = state.shopping.find((i) => i.id === id);
    if (!x) return;
    $("#detailBody").innerHTML =
      `${x.photo ? `<img class="shop-detail-photo" src="${photoSrc(x.photo)}" alt="${esc(x.name)}">` : ""}${shopItem(x).replace(/<img class="shop-thumb"[^>]*>/, "")}`;
    if (!$("#detail").open) $("#detail").showModal();
  }
  function shopPage() {
    if (state.status !== "ready") return { sig: "wait", shell: '<div class="empty"><h2>正在連接…</h2></div>' };
    const edit = state.shopping.find((x) => x.id === state.shopEdit);
    if (state.shopEdit && !edit) {
      state.shopEdit = null;
      shopPhoto = null;
    }
    const todo = state.shopping.filter((x) => !x.bought),
      q = norm(state.shopSearch),
      match = (x) => !q || norm([x.name, x.qty, x.detail, x.place].join(" ")).includes(q);
    const shown = (
      state.shopFilter === "todo" ? todo : state.shopFilter === "done" ? state.shopping.filter((x) => x.bought) : state.shopping
    ).filter(match);
    const filters = [
      ["todo", "未買", todo.length],
      ["done", "已買", state.shopping.length - todo.length],
      ["all", "全部", state.shopping.length],
    ]
      .map(
        ([k, t, n]) =>
          `<button class="chip ${state.shopFilter === k ? "active" : ""}" data-shop-filter="${k}" aria-pressed="${state.shopFilter === k}">${t} ${n}</button>`,
      )
      .join("");
    const sorted = [...shown].sort((a, b) => a.bought - b.bought || (b.at || 0) - (a.at || 0));
    const list = shown.length
      ? state.shopView === "grid"
        ? `<div class="shop-grid">${sorted.map(shopTile).join("")}</div>`
        : sorted.map(shopItem).join("")
      : q
        ? `<div class="empty"><h2>找不到「${esc(state.shopSearch)}」</h2><p>試試其他字，或清除搜尋。</p></div>`
        : `<div class="empty"><h2>${state.shopFilter === "done" ? "還沒有已買的東西" : "清單是空的"}</h2><p>${state.shopFilter === "done" ? "買了之後按「✓ 已買」。" : "把想買的東西加進來，旅伴都看得到。"}</p></div>`;
    return {
      sig: ["shop", state.shopEdit || "", state.shopView, state.user.uid].join("|"),
      shell: `<div class="tg-status" data-tg-live="status"></div>${edit ? "" : '<div class="panel shop-ai"><b>✨ AI 認物品，自動加入清單</b><div class="links"><button type="button" class="locate-button" data-tg="shopAiCam">📷 影相</button><button type="button" class="locate-button" data-tg="shopAi">🖼 上載相片（可多張）</button></div><input type="file" accept="image/*" capture="environment" id="shopAiCam" hidden><input type="file" accept="image/*" id="shopAiInput" multiple hidden><p class="note">AI 會認出物品、規格，以及價錢牌上的價錢，自動加入清單，之後可以修改。可以關閉網頁，AI 會在背景完成。</p></div>'}<div data-tg-live="jobs"></div>${shopForm(edit)}<div class="searchrow shop-tools"><input id="shopSearch" class="search" type="search" placeholder="搜尋物品、地點、備註…" aria-label="搜尋購物清單" value="${esc(state.shopSearch)}"><div class="chips" role="group" aria-label="顯示方式"><button class="chip ${state.shopView === "list" ? "active" : ""}" data-shop-view="list" aria-pressed="${state.shopView === "list"}">☰ 列表</button><button class="chip ${state.shopView === "grid" ? "active" : ""}" data-shop-view="grid" aria-pressed="${state.shopView === "grid"}">▦ 相片</button></div></div><div class="chips" role="group" aria-label="篩選" data-tg-live="filters"></div><div class="tg-list" data-tg-live="list"></div>`,
      live: { status: statusBar(), jobs: productJobsHtml(), filters, list },
    };
  }
  // Match a 購買地點 to an explore shop: the whole name, or one distinctive word of it (島本, 唐十), compared without
  // spaces/brackets/punctuation and with 雞/鶏 treated alike; generic words (博多, 本店…) never match on their own.
  const norm = (t) =>
    String(t)
      .toLowerCase()
      .replace(/[雞鷄]/g, "鶏")
      .replace(/[\s（）()【】「」『』・･,，、.。:：\-－−&＆’']/g, "");
  const GENERIC = new Set([
    "博多",
    "天神",
    "福岡",
    "本店",
    "博多店",
    "天神店",
    "jr",
    "博多駅",
    "博多站",
    "由布院",
    "湯布院",
    "別府",
    "佐賀",
    "太宰府",
    "中洲",
    "大名",
    "店",
    "分店",
    "cafe",
    "coffee",
    "shop",
  ]);
  const nameWords = (n) =>
    String(n)
      .split(/[\s（）()【】「」『』・･,，、]+/)
      .map(norm)
      .filter((x) => x.length >= (/^[a-z0-9]+$/.test(x) ? 4 : 2) && !GENERIC.has(x));
  const placeFor = (text) => {
    const t = norm(text);
    if (!t) return null;
    const ps = T().places;
    return (
      ps.find((p) => norm(p.v[1]).length >= 2 && t.includes(norm(p.v[1]))) ||
      ps.find((p) => nameWords(p.v[1]).some((k) => t.includes(k)))
    );
  };
  // The explore place an item is bought at: the one chosen on the item ("-" = none), else matched from 購買地點.
  const matchPlace = (x) =>
    x.placeId === "-" ? null : (x.placeId && T().places.find((p) => p.id === x.placeId)) || (x.place ? placeFor(x.place) : null);
  // Set when 加入探索 turns a 購買地點 into an explore place: its items point at the new place.
  function linkShopping(ids, placeId) {
    for (const id of ids) if (state.shopping.some((x) => x.id === id)) update("shopping", id, { placeId });
  }
  // 附近 › 購物: spots where unbought list items can be bought. An explore shop named in 購買地點 uses its pin;
  // otherwise the item's own coordinates (geocoded from 購買地點). Items at the same spot share one card.
  const shopLabel = (t) =>
    String(t)
      .split(/\s*(?:日本、|日本,|〒)/)[0]
      .trim()
      .slice(0, 40) || String(t).slice(0, 40);
  // Shopping list items at a place: by its explore place (購買地點 naming that place), or by a stop's own name.
  let buyMemo = null;
  function shoppingFor() {
    const ps = T().places;
    if (buyMemo && buyMemo.list === state.shopping && buyMemo.n === ps.length) return buyMemo.map;
    const map = new Map();
    for (const x of state.shopping) {
      if (!x.place) continue;
      const p = matchPlace(x);
      if (p) (map.get(p.id) || map.set(p.id, []).get(p.id)).push({ id: x.id, name: x.name, bought: !!x.bought });
    }
    buyMemo = { list: state.shopping, n: ps.length, map };
    return map;
  }
  function shoppingAt({ placeId, title }) {
    if (placeId) {
      const m = shoppingFor().get(placeId);
      if (m) return m;
    }
    const t = norm(title || "");
    if (t.length < 2) return [];
    return state.shopping
      .filter((x) => x.place && norm(x.place).includes(t))
      .map((x) => ({ id: x.id, name: x.name, bought: !!x.bought }));
  }
  // Places to buy unbought items, for adding to the plan (coordinates not needed): explore place, else the 購買地點 text.
  function shoppingPlaces() {
    const spots = {};
    for (const x of state.shopping.filter((x) => !x.bought && x.place)) {
      const p = matchPlace(x),
        key = p ? "p:" + p.id : "t:" + norm(shopLabel(x.place));
      const spot = (spots[key] ??= {
        name: p ? p.v[1] : shopLabel(x.place),
        placeId: p ? p.id : null,
        address: p ? p.v[3] : x.place,
        ...(Number.isFinite(x.lat) && Number.isFinite(x.lng) ? { lat: x.lat, lng: x.lng } : {}),
        items: [],
        ids: [],
      });
      spot.items.push(x.name);
      spot.ids.push(x.id);
    }
    return Object.values(spots);
  }
  function shoppingSpots() {
    const spots = {},
      geo = window.TRIP_GEO?.places || {};
    for (const x of state.shopping.filter((x) => !x.bought && x.place)) {
      const p = matchPlace(x),
        pin = p && geo[p.id]?.[0];
      let key, spot;
      if (pin) {
        key = "p:" + p.id;
        spot = { name: p.v[1], lat: pin.lat, lng: pin.lng, placeId: p.id, address: p.v[3] };
      } else if (Number.isFinite(x.lat) && Number.isFinite(x.lng)) {
        key = `${x.lat.toFixed(4)},${x.lng.toFixed(4)}`;
        spot = { name: shopLabel(x.place), lat: x.lat, lng: x.lng, placeId: null, address: x.place };
      } else continue;
      (spots[key] ??= { ...spot, items: [] }).items.push(x.name);
    }
    return Object.values(spots);
  }
  // Geocode 購買地點 once per text (geoFor remembers which text the coordinates belong to); one at a time.
  let geocoding = false;
  async function geocodeShopping() {
    if (geocoding || !navigator.onLine || state.status !== "ready" || !started) return;
    const todo = state.shopping.filter((x) => x.place && x.geoFor !== x.place && !x.pending).slice(0, 10);
    if (!todo.length) return;
    geocoding = true;
    try {
      const call = await callable("lookupPlace", 45000);
      for (const x of todo) {
        try {
          const r = (await call({ query: x.place, country: state.meta?.country || "" })).data;
          await fb.fs.updateDoc(tdoc("shopping", x.id), {
            lat: Number.isFinite(r.lat) ? r.lat : null,
            lng: Number.isFinite(r.lng) ? r.lng : null,
            geoFor: x.place,
          });
        } catch (e) {
          if (String(e?.code || "").endsWith("not-found"))
            await fb.fs.updateDoc(tdoc("shopping", x.id), { lat: null, lng: null, geoFor: x.place }).catch(() => {});
          else {
            console.error("geocode", e);
            break;
          }
        }
      }
    } finally {
      geocoding = false;
    }
  }
  // A Google Maps link pasted into 購買地點 becomes the shop name and address.
  const MAPS_LINK = /^https:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|(www\.)?google\.[a-z.]+\/maps|maps\.google\.[a-z.]+)/i;
  async function placeFromMaps(input) {
    const url = input.value.trim().match(/https:\/\/\S+/)?.[0];
    if (!url || !MAPS_LINK.test(url) || input.dataset.looking) return;
    const hint = $("#shopPlaceInfo");
    input.disabled = true;
    input.dataset.looking = "1";
    if (hint) hint.textContent = "正在查詢 Google 地圖…";
    try {
      const r = await lookupPlace(url);
      input.value = [r.name, r.address].filter(Boolean).join(" ").slice(0, 200);
      if (hint) hint.textContent = "已由 Google 地圖填入。";
    } catch (e) {
      if (hint) hint.textContent = "未能讀取地圖連結，請手動輸入店名或地址。";
      console.error(e);
    } finally {
      input.disabled = false;
      delete input.dataset.looking;
    }
  }
  function renderShopping() {
    return `${header("SHOPPING LIST", "要買的，都記下來。", "相片、地點和價錢 · 旅伴共用，買了就打勾")}<div id="shopPage"></div>`;
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
  let fillJob = null;
  function fillStatus(text, busy) {
    const i = $("#shopFillInfo"),
      b = $("#shopFillBar");
    if (i) i.textContent = text;
    if (b) b.hidden = !busy;
  }
  function requestFill(image) {
    if (!navigator.onLine) return fillStatus("離線中，AI 未能辨識，請手動輸入。", false);
    const { fs, db } = fb,
      ref = fs.doc(tcol("receiptJobs"));
    fillJob = ref.id;
    fs.setDoc(ref, {
      images: [image],
      kind: "productFill",
      file: "購物表格相片",
      status: "pending",
      by: state.user.uid,
      byName: me().name,
      at: Date.now(),
      createdAt: fs.serverTimestamp(),
    }).catch((e) => {
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
              if (v != null && v !== "" && !String(el[n].value).trim()) el[n].value = v;
            };
          put("name", r.name);
          put("qty", r.qty);
          put("detail", r.detail);
          put("place", r.place);
          put("price", r.price);
          if (r.price != null && r.currency) el.currency.value = r.currency;
          fillStatus("AI 已填入空白欄位，請檢查。", false);
        }
      }
      fb.fs.deleteDoc(jobRef(j.id)).catch(() => {});
    }
  }
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
  // ---- 我的旅程 (trips): switch, create, copy, edit and invite companions ----
  // 我的旅程: switch trips, create one, edit the current trip, invite or remove companions (all through manageTrip).

  const currencyOptions = (sel) =>
    Object.entries(CURRENCY_NAMES)
      .map(([k, v]) => `<option value="${k}"${k === sel ? " selected" : ""}>${v} ${k}</option>`)
      .join("");
  function tripForm(t) {
    const v = (k) => esc(t?.[k] ?? "");
    return `<form class="tg-form" data-trip-form="${t ? "update" : "create"}"><label>旅程名稱<input name="name" required maxlength="60" placeholder="例如：2027 首爾" value="${v("name")}"></label><label>目的地<input name="destination" required maxlength="80" placeholder="例如：韓國首爾" value="${v("destination")}"></label><div class="tg-row"><label>開始日期<input name="startDate" type="date" required value="${v("startDate")}"></label><label>結束日期<input name="endDate" type="date" required value="${v("endDate")}"></label></div><div class="tg-row"><label>當地貨幣<select name="currency">${currencyOptions(t?.currency || "JPY")}</select></label><label>你們的貨幣<select name="homeCurrency">${currencyOptions(t?.homeCurrency || "HKD")}</select></label></div><button type="submit" class="locate-button">${t ? "儲存旅程資料" : "建立旅程"}</button><p class="note" data-trip-msg></p></form>`;
  }
  const myEmail = () => String(state.user?.email || "").toLowerCase();
  function memberLabel(email) {
    const id = email.endsWith("@" + ACCOUNT_DOMAIN) ? email.split("@")[0] : email,
      prof = state.members.find((m) => String(m.email || "").toLowerCase() === email);
    return prof?.name && prof.name !== id ? `${prof.name}（${id}）` : id;
  }
  function tripsPage() {
    const t = state.meta;
    if (!["ready", "notrip"].includes(state.status) || (t && !started))
      return { sig: "wait", shell: '<div class="empty"><h2>正在連接…</h2></div>' };
    const members = (t?.members || [])
      .map(
        (e) =>
          `<div class="pp-row"><div><b>${esc(memberLabel(e))}</b>${e === myEmail() ? "<small>你</small>" : ""}</div>${e !== myEmail() ? `<button class="smallbtn" data-trip-remove="${esc(e)}">移除</button>` : ""}</div>`,
      )
      .join("");
    const trips =
      (state.trips || [])
        .map(
          (x) =>
            `<div class="pp-row"><div><b>${esc(x.name)}</b><small>${esc(x.destination || "")} · ${esc(x.startDate || "")} → ${esc(x.endDate || "")}</small></div>${x.id === tripId ? '<span class="badge">目前</span>' : `<button class="action primary" data-trip-open="${esc(x.id)}">開啟</button>`}</div>`,
        )
        .join("") || '<p class="note">還沒有旅程。</p>';
    return {
      sig: ["trips", tripId || "", state.status].join("|"),
      shell: `${t ? `<section class="panel trip-panel"><div class="eyebrow">目前旅程</div><h2>${esc(t.name)}</h2><p class="note">${esc(t.destination || "")} · ${esc(t.startDate || "")} → ${esc(t.endDate || "")} · ${esc(CURRENCY_NAMES[t.currency] || t.currency || "")}</p><details><summary>✎ 修改旅程資料</summary>${tripForm(t)}</details>${copyForm(t)}</section><section class="panel trip-panel"><h3>旅伴</h3><div class="pp-list" data-tg-live="members"></div><details><summary>＋ 邀請旅伴</summary><form class="tg-form" data-trip-invite><div class="chips" role="radiogroup" aria-label="帳戶類型"><label class="tg-check"><input type="radio" name="kind" value="account" checked> 建立帳號 ID</label><label class="tg-check"><input type="radio" name="kind" value="google"> Google 帳戶</label></div><div class="tg-row"><label>帳號 ID 或 Gmail<input name="who" required maxlength="80" autocapitalize="none" spellcheck="false" placeholder="例如：amy 或 amy@gmail.com"></label><label>顯示名稱（帳號 ID 用）<input name="name" maxlength="40"></label></div><button type="submit" class="locate-button">邀請</button><p class="note" data-trip-msg></p></form></details></section>` : ""}<section class="panel trip-panel"><h3>我的旅程</h3><div class="pp-list" data-tg-live="trips"></div></section><section class="panel trip-panel"><details${t ? "" : " open"}><summary>＋ 建立新旅程</summary>${tripForm(null)}</details></section>`,
      live: { members, trips },
    };
  }
  // Copy the current trip as a new one (only you as companion): places, day plans (days that fit), checklist and shopping list.
  function copyForm(t) {
    return `<details><summary>⧉ 複製為新旅程</summary><form class="tg-form" data-trip-copy><label>新旅程名稱<input name="name" required maxlength="60" value="${esc((t.name + "（複本）").slice(0, 60))}"></label><div class="tg-row"><label>開始日期<input name="startDate" type="date" required value="${esc(t.startDate || "")}"></label><label>結束日期<input name="endDate" type="date" required value="${esc(t.endDate || "")}"></label></div><fieldset><legend>一併複製</legend>${[
      ["places", "探索地點"],
      ["planDays", "每日行程"],
      ["checklist", "清單（不包括已剔選）"],
      ["shopping", "購物清單（全部改為未買）"],
    ]
      .map(([k, v]) => `<label class="tg-check"><input type="checkbox" name="copy" value="${k}" checked> ${v}</label>`)
      .join(
        "",
      )}</fieldset><p class="note">新旅程只有你一位旅伴；筆記、開支、住宿、機票及收藏不會複製。</p><button type="submit" class="locate-button">建立複本</button><p class="note" data-trip-msg></p></form></details>`;
  }
  async function copyTrip(newId, what, days) {
    const { fs, db } = fb,
      u = state.user,
      stamp = () => ({ by: u.uid, byName: me().name, at: Date.now(), createdAt: fs.serverTimestamp() });
    const strip = ({ id, pending, by, byName, at, createdAt, ...d }) => d,
      col = (n) => fs.collection(db, "trips", newId, n),
      ref = (n, id) => fs.doc(db, "trips", newId, n, String(id));
    const jobs = [];
    if (what.includes("places"))
      for (const p of state.places) jobs.push(fs.setDoc(ref("places", p.id), { ...strip(p), ...stamp() }));
    if (what.includes("planDays"))
      for (const d of state.planDays)
        if (Number(d.id) <= days) {
          const { stops, label } = d;
          jobs.push(
            fs.setDoc(ref("planDays", d.id), {
              stops: stops || [],
              ...(label ? { label } : {}),
              by: u.uid,
              byName: me().name,
              at: Date.now(),
            }),
          );
        }
    if (what.includes("checklist"))
      for (const c of state.checklist)
        jobs.push(fs.addDoc(col("checklist"), { text: c.text, group: c.group, doneBy: [], ...stamp() }));
    if (what.includes("shopping"))
      for (const s of state.shopping)
        jobs.push(fs.addDoc(col("shopping"), { ...strip(s), bought: false, boughtBy: null, boughtAt: null, ...stamp() }));
    const r = await Promise.allSettled(jobs);
    return r.filter((x) => x.status === "rejected").length;
  }
  function renderTrips() {
    return `${header("MY TRIPS", "我的旅程", "切換旅程、建立新旅程及邀請旅伴")}<div id="tripsPage"></div>`;
  }
  async function tripAction(form, data, done) {
    const msg = form.querySelector("[data-trip-msg]"),
      btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    if (msg) msg.textContent = "處理中…";
    try {
      const r = (await (await callable("manageTrip", 45000))(data)).data;
      done(r);
    } catch (e) {
      if (msg)
        msg.textContent =
          fnError(e, "未能完成，請檢查網絡後再試。");
      console.error(e);
    } finally {
      btn.disabled = false;
    }
  }
  // ---- Event handlers for everything above ----
  document.addEventListener("submit", (e) => {
    const tf = e.target.closest("[data-trip-form]");
    if (tf) {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(tf));
      const create = tf.dataset.tripForm === "create";
      tripAction(tf, { ...v, action: create ? "create" : "update", trip: tripId }, (r) => {
        if (create) {
          lastTrip.set(r.id);
          location.hash = "home";
        }
        location.reload();
      });
      return;
    }
    const cp = e.target.closest("[data-trip-copy]");
    if (cp) {
      e.preventDefault();
      const v = new FormData(cp),
        t = state.meta,
        what = v.getAll("copy").map(String),
        start = String(v.get("startDate")),
        end = String(v.get("endDate"));
      if (end < start) return toast("結束日期要在開始日期之後。");
      const days = Math.round((Date.parse(end) - Date.parse(start)) / 864e5) + 1;
      tripAction(
        cp,
        {
          action: "create",
          name: String(v.get("name")).trim(),
          destination: t.destination || "",
          startDate: start,
          endDate: end,
          currency: t.currency || "JPY",
          homeCurrency: t.homeCurrency || "HKD",
        },
        async (r) => {
          cp.querySelector("[data-trip-msg]").textContent = "正在複製資料…";
          const failed = await copyTrip(r.id, what, days);
          if (failed)
            (await UI.confirm("部分資料未能複製", {
              text: `有 ${failed} 項未能複製，其餘已完成。`,
              ok: "開啟新旅程",
              cancel: "留在這裡",
            })) && switchTrip(r.id);
          else switchTrip(r.id);
        },
      );
      return;
    }
    const inv = e.target.closest("[data-trip-invite]");
    if (inv) {
      e.preventDefault();
      const v = new FormData(inv),
        who = String(v.get("who") || "").trim(),
        google = v.get("kind") === "google";
      tripAction(
        inv,
        google
          ? { action: "addMember", trip: tripId, kind: "google", email: who }
          : { action: "addMember", trip: tripId, kind: "account", id: who, name: String(v.get("name") || "").trim() },
        (r) => {
          if (!state.meta.members.includes(r.email)) state.meta.members.push(r.email);
          inv.reset();
          inv.querySelector("[data-trip-msg]").textContent = r.password
            ? `已建立帳號 ${r.email.split("@")[0]}，密碼：${r.password}（只會顯示一次，請私下交給對方）`
            : `已加入 ${r.email.endsWith("@" + ACCOUNT_DOMAIN) ? r.email.split("@")[0] : r.email}`;
          refresh();
        },
      );
      return;
    }
    const f = e.target.closest("[data-tg-form]");
    if (!f) return;
    if (f.dataset.tgForm === "login") {
      e.preventDefault();
      const v = new FormData(f);
      loginWithAccount(String(v.get("id")).trim(), String(v.get("password")));
      return;
    }
    if (state.status !== "ready") return;
    e.preventDefault();
    const v = new FormData(f),
      str = (k) => String(v.get(k) || "").trim(),
      day = Number(v.get("day")) || null;
    if (f.dataset.tgForm === "note") {
      const placeId = f.dataset.placeId || null,
        place = placeId && T().places.find((p) => p.id === placeId);
      if (!str("text")) return;
      add("notes", {
        text: str("text").slice(0, 1000),
        day: placeId ? null : day,
        placeId,
        placeName: place ? place.v[1] : null,
      });
    }
    if (f.dataset.tgForm === "check") {
      if (!str("text")) return;
      add("checklist", {
        text: str("text").slice(0, 60),
        group: CHECK_GROUPS[str("group")] ? str("group") : "other",
        doneBy: [],
      });
      f.elements.text.value = "";
      f.elements.text.focus();
      return;
    }
    if (f.dataset.tgForm === "expense") {
      const prices = v.getAll("itemAmount"),
        items = v
          .getAll("itemName")
          .map((n, i) => ({
            name: String(n).trim().slice(0, 40),
            amount: prices[i] === "" ? null : Math.round(Number(prices[i]) * 100) / 100,
          }))
          .filter((i) => i.name && (i.amount == null || (i.amount >= 0 && i.amount <= 1e7)))
          .slice(0, 30);
      const sum = items.reduce((t, i) => t + (i.amount || 0), 0),
        amount = v.get("amount") === "" ? sum : Number(v.get("amount")),
        split = v.getAll("split").map(String);
      if (!str("title") || !(amount > 0) || amount > 1e7) return toast("請輸入項目和金額（或物品金額）。");
      if (!split.length) return toast("請最少選一位分帳旅伴。");
      const exp = {
          title: str("title").slice(0, 80),
          amount: Math.round(amount * 100) / 100,
          currency: pickCur(String(v.get("currency"))),
          paidBy: str("paidBy"),
          split,
          day: day || today(),
          items,
          ...(CATS[str("category")] ? { category: str("category") } : {}),
        },
        dup = duplicateOf(exp);
      const go = () => {
        add("expenses", exp);
        f.reset();
        $("#tgItemRows").innerHTML = itemRow();
      };
      if (dup) UI.confirm("似乎已經記錄過", { text: dupText(dup), ok: "仍然加入" }).then((ok) => ok && go());
      else go();
      return;
    }
    if (f.dataset.tgForm === "shop") {
      const price = v.get("price") === "" ? null : Number(v.get("price"));
      if (!str("name")) return;
      if (price != null && !(price >= 0 && price <= 1e7)) return toast("價錢不正確。");
      const item = {
        name: str("name").slice(0, 80),
        qty: str("qty").slice(0, 30),
        detail: str("detail").slice(0, 500),
        place: str("place").slice(0, 200),
        placeId: str("placeId").slice(0, 40),
        price: price == null ? null : Math.round(price * 100) / 100,
        currency: pickCur(String(v.get("currency"))),
        photo: shopPhoto,
      };
      // A chosen explore place fills an empty 購買地點 with its name and address.
      const chosen = item.placeId && item.placeId !== "-" && T().places.find((p) => p.id === item.placeId);
      if (chosen && !item.place) item.place = `${chosen.v[1]} ${chosen.v[3]}`.trim().slice(0, 200);
      if (state.shopEdit) {
        update("shopping", state.shopEdit, { ...item, ai: false });
        toast("已儲存");
      } else add("shopping", { ...item, bought: false, boughtBy: null, boughtAt: null });
      state.shopEdit = null;
      shopPhoto = null;
      $("#shopPage").dataset.sig = "";
      refresh();
      return;
    }
    f.reset();
  });
  document.addEventListener("click", (e) => {
    const el = e.target.closest("button");
    if (!el) return;
    const d = el.dataset;
    if (d.tg === "login") login();
    if (d.tg === "logout" && fb) logout();
    if (d.tg === "scan") $("#tgReceipt")?.click();
    if (d.draftDrop) {
      const id = d.draftDrop;
      UI.confirm("捨棄這張收據？", { danger: true, ok: "捨棄" }).then((ok) => {
        if (!ok) return;
        const j = jobs.find((x) => x.id === id);
        fb.fs.deleteDoc(jobRef(id)).then(
          () => dropPhotos(j?.photos),
          () => toast("未能刪除，請再試。"),
        );
        delete localEdits[id];
      });
    }
    if (d.tg === "mergeDrafts") mergeDrafts(d.keys.split(","));
    if (d.draftRetry)
      fb.fs
        .updateDoc(jobRef(d.draftRetry), { status: "pending", retries: fb.fs.increment(1) })
        .catch(() => toast("未能重試，請再試。"));
    if (d.draftAdd) {
      const x = drafts().find((i) => i.key === d.draftAdd);
      if (x)
        addDraft(x, true).then((ok) => {
          if (ok) renderDrafts();
        });
    }
    if (d.tg === "draftsAddAll")
      (async () => {
        const all = drafts(),
          ok = all.filter((x) => x.status === "done" && !draftDup(x, all));
        let n = 0;
        for (const x of ok)
          if (await addDraft(x, false)) n++;
          else break;
        renderDrafts();
        const left = drafts().filter((x) => x.status === "done").length;
        if (n) toast(`已加入 ${n} 筆${left ? `，尚有 ${left} 筆待確認` : ""}`);
      })();
    if (d.receipts) showReceipts(d.receipts);
    if (d.fxSet) setRate(d.fxSet);
    if (d.tg === "checkSuggest") addSuggestions();
    if (d.docs) {
      const [k, i] = d.docs.split(":");
      openDocs(k, i);
    }
    if (d.docAdd) $("#docInput")?.click();
    if (d.docDel) {
      const [k, i, ...rest] = d.docDel.split(":");
      deleteDocFile(k, i, rest.join(":"));
    }
    if (d.settle) {
      state.settleMode = d.settle;
      refresh();
    }
    if (d.expCat) {
      const x = state.expenses.find((i) => i.id === d.expCat);
      if (x)
        UI.choose("開支分類", CATS, x.category || "food").then((v) => {
          if (v && CATS[v] && v !== x.category) update("expenses", x.id, { category: v });
        });
    }
    if (d.tg === "itemAdd") {
      $("#tgItemRows").insertAdjacentHTML("beforeend", itemRow());
      $("#tgItemRows").lastElementChild.querySelector("input").focus();
    }
    if (d.tg === "itemDel") {
      const rows = $("#tgItemRows");
      el.closest(".tg-line-row").remove();
      if (!rows.children.length) rows.innerHTML = itemRow();
    }
    if (d.tg === "retry") {
      if (fb && state.user) {
        state.status = "checking";
        refresh();
        chooseTrip();
      } else load().catch(() => {});
    }
    if (d.tgTab) {
      state.tab = d.tgTab;
      refresh();
    }
    if (d.tripOpen) switchTrip(d.tripOpen);
    if (d.tripRemove) {
      const em = d.tripRemove;
      UI.confirm(`把 ${em} 移出這個旅程？`, { danger: true, ok: "移出" }).then(
        (ok) =>
          ok &&
          callable("manageTrip", 45000)
            .then((f) => f({ action: "removeMember", trip: tripId, email: em }))
            .then(
              () => {
                state.meta.members = state.meta.members.filter((x) => x !== em);
                refresh();
                toast("已移除");
              },
              (e) => toast(e?.message?.replace(/\s*\[\d+\]$/, "") || "未能移除。"),
            ),
      );
    }
    if (d.tgDel) {
      const [name, id] = d.tgDel.split(":");
      remove(name, id);
    }
    if (d.tg === "shopPhoto") $("#shopPhotoInput")?.click();
    if (d.tg === "shopAi") $("#shopAiInput")?.click();
    if (d.tg === "shopAiCam") $("#shopAiCam")?.click();
    if (d.tg === "shopPhotoClear") {
      shopPhoto = null;
      $("#shopPreview").innerHTML = "";
    }
    if (d.tg === "shopCancel") {
      state.shopEdit = null;
      shopPhoto = null;
      refresh();
    }
    if (d.shopFilter) {
      state.shopFilter = d.shopFilter;
      refresh();
    }
    if (d.shopView) {
      state.shopView = d.shopView;
      const sp = $("#shopPage");
      if (sp) sp.dataset.sig = "";
      refresh();
    }
    if (d.shopOpen) openShopItem(d.shopOpen);
    if (d.shopEdit) {
      if ($("#detail").open) $("#detail").close();
      const x = state.shopping.find((i) => i.id === d.shopEdit);
      if (x) {
        state.shopEdit = x.id;
        shopPhoto = x.photo || null;
        refresh();
        $("#shopPage")?.scrollIntoView({ behavior: "smooth" });
      }
    }
    if (d.shopToggle) {
      const x = state.shopping.find((i) => i.id === d.shopToggle);
      if (x)
        update(
          "shopping",
          x.id,
          x.bought
            ? { bought: false, boughtBy: null, boughtAt: null }
            : { bought: true, boughtBy: me().name, boughtAt: Date.now() },
        );
    }
    if (
      (d.shopToggle || d.tgDel?.startsWith("shopping:")) &&
      $("#detail").open &&
      $("#detailBody .shop-detail-photo, #detailBody .shop-item")
    )
      $("#detail").close();
  });
  document.addEventListener("change", (e) => {
    if (e.target.id === "tgReceipt" && e.target.files.length) {
      if (state.status === "ready") queueReceipts([...e.target.files]);
      e.target.value = "";
    }
    if (e.target.id === "shopPhotoInput" && e.target.files[0]) {
      pickShopPhoto(e.target.files[0]);
      e.target.value = "";
    }
    if ((e.target.id === "shopAiInput" || e.target.id === "shopAiCam") && e.target.files.length) {
      if (state.status === "ready") queueProducts([...e.target.files]);
      e.target.value = "";
    }
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
  document.addEventListener("click", (e) => {
    const img = e.target.closest("[data-shop-zoom]");
    if (img) img.classList.toggle("zoom");
  });
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
  document.addEventListener("click", (e) => {
    if (e.target.closest("#tripsBtn")) location.hash = "trips";
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
  // ---- Start ----
  load().catch(() => {});
  return Object.freeze({
    render,
    renderShopping,
    renderTrips,
    refresh,
    shoppingSpots,
    shoppingPlaces,
    shoppingFor,
    shoppingAt,
    linkShopping,
    lists: tripLists,
    openShopItem,
    saveItem,
    removeItem,
    setDayLabel,
    lookupPlace,
    suggestRoutes,
    aiRoutes,
    savePlace,
    deletePlace,
    savePlanDay,
    resetPlanDay,
    saveFavorites,
  });
})();

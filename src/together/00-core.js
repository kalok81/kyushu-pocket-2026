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
    noteKind: "note",
    noteFilter: "all",
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
    shopCat: "all",
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

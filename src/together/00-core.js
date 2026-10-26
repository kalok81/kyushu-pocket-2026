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
    expSearch: "",
    shopView: "list",
    shopEdit: null,
    noteEdit: null,
    fx: null,
    liveFx: null,
    settleMode: null,
  };
  const Kit = window.Kit,
    { icon } = Kit;
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
      : // the function's own (Chinese) message; a bare SDK code such as "internal" means the server could not be reached
        String(e?.code || "").startsWith("functions/") && e.message && !/^[a-z-]+$/.test(e.message)
        ? e.message.replace(/\s*\[\d+\]$/, "")
        : `${fallback}（伺服器未能處理請求）`;
  const toast = (s) => window.UI.toast(s);
  const header = (title, sub = "", aside = "") => Kit.pageHead(title, { sub, aside });
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
  // Delete with undo: the item disappears at once and is deleted when the undo bar closes without 復原.
  const hiding = new Set();
  async function remove(name, id) {
    const x = state[name]?.find((i) => i.id === id);
    if (!x) return;
    const key = `${name}:${id}`;
    hiding.add(key);
    state[name] = state[name].filter((i) => i.id !== id);
    if (name === "shopping" || name === "notes") T().shoppingChanged?.();
    refresh();
    const undo = await Kit.snack(`已刪除「${String(x.title || x.name || x.text || "").split("\n")[0].slice(0, 20)}」`, { action: "復原" });
    hiding.delete(key);
    if (undo) {
      state[name] = [...state[name], x].sort((a, b) => (b.at || 0) - (a.at || 0));
      if (name === "shopping" || name === "notes") T().shoppingChanged?.();
      refresh();
      return;
    }
    fb.fs.deleteDoc(tdoc(name, id)).then(
      () => dropPhotos(name === "expenses" ? x.receipts : null),
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
  // Traditional Chinese name from the translateNames function, shown under the original while it still matches it.
  const zhName = (x, text) => (x.zh && String(x.zhFor || "").split("\n")[0] === text ? x.zh : ""),
    zhLine = (z) => (z ? `<span class="zh-name">${esc(z)}</span>` : "");
  // Top row of every list item: badges and author on the left, the item's "⋯" menu on the right.
  const itemTop = (x, extra, items) => `<div class="item-top">${meta(x, extra)}${Kit.menu(items)}</div>`;
  // Menu entry that deletes an item (with undo).
  const del = (name, x) => ({ label: "刪除", icon: "trash", danger: true, attrs: { "data-tg-del": `${name}:${x.id}` } });

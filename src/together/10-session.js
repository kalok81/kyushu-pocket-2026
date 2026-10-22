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
        handleNoteFillJobs();
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

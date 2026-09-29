// Le Tre Celle — standalone version.
// Connects the app to the shop's own Firebase project: sign-in with the shop account,
// the shared database (works offline and syncs later), and saving files on the phone.
// The app itself talks to `claude.use("db")`; this file provides the same small API on top of Firestore.

const FIREBASE_VERSION = "10.12.2";
const FB = "https://www.gstatic.com/firebasejs/" + FIREBASE_VERSION + "/";

const CONFIG = {
  apiKey: "AIzaSyCW0NYdGQ690JGS7wS_FA_HbN_-pdYl81s",
  authDomain: "le-tre-celle.firebaseapp.com",
  projectId: "le-tre-celle",
  storageBucket: "le-tre-celle.firebasestorage.app",
  messagingSenderId: "1050733897533",
  appId: "1:1050733897533:web:8a36f10797ba632aaa8754"
};

const $ = (id) => document.getElementById(id);
const gate = $("ltcGate");

function showGate(state, msg) {
  gate.hidden = false;
  gate.dataset.state = state;
  if (msg != null) $("ltcGateMsg").textContent = msg;
  document.documentElement.classList.toggle("ltc-locked", true);
}
function hideGate() {
  gate.hidden = true;
  document.documentElement.classList.remove("ltc-locked");
}

// ---------- saving a file on the phone (backup copy) ----------
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const downloads = {
  async save({ filename, data }) {
    if (!filename || data == null) throw { code: "bad_request", message: "missing file" };
    const blob = data instanceof Blob ? data : new Blob([data], { type: "application/json" });
    if (isIOS && navigator.canShare) {
      const file = new File([blob], filename, { type: "application/json" });
      if (navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: filename });
          return { status: "saved" };
        } catch (e) {
          if (e && e.name === "AbortError") throw { code: "declined", message: "cancelled" };
          // not allowed (the tap was too long ago): fall back to a normal download
        }
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.rel = "noopener";
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 5000);
    return { status: "saved" };
  }
};
window.__ltcProvide("downloads", downloads);

// ---------- database adapter ----------
function makeDb(fs, F, onDenied) {
  // A first answer that comes only from this phone's memory and is empty is not trusted:
  // on a phone that has never opened the app it would look like "no data at all".
  // It is used only if the server does not answer within a few seconds (no internet).
  const WAIT_SERVER_MS = 6000;

  function wrapDoc(s) {
    const exists = s.exists();
    const data = exists ? s.data() : undefined;
    return { id: s.id, exists, data: () => data, metadata: { hasPendingWrites: s.metadata.hasPendingWrites, fromCache: s.metadata.fromCache } };
  }
  function wrapQuery(s, sortField, sortDir) {
    let docs = s.docs.map(wrapDoc);
    if (sortField) {
      docs.sort((a, b) => {
        const av = a.data()[sortField], bv = b.data()[sortField];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;            // missing field goes last
        if (bv == null) return -1;
        if (av < bv) return sortDir === "desc" ? 1 : -1;
        if (av > bv) return sortDir === "desc" ? -1 : 1;
        return 0;
      });
    }
    return {
      docs, size: docs.length, empty: docs.length === 0,
      docChanges: () => s.docChanges().map((c) => ({ type: c.type, doc: wrapDoc(c.doc), oldIndex: c.oldIndex, newIndex: c.newIndex })),
      metadata: { hasPendingWrites: s.metadata.hasPendingWrites, fromCache: s.metadata.fromCache }
    };
  }
  function errOf(e) {
    const code = (e && e.code) || "unavailable";
    if (code === "permission-denied") onDenied();
    const map = { "permission-denied": "invalid_argument", "invalid-argument": "invalid_argument", "not-found": "invalid_argument", "resource-exhausted": "resource_exhausted", "unavailable": "unavailable" };
    return { code: map[code] || "unavailable", message: (e && e.message) || String(e) };
  }
  // Nested objects merge field by field (like the app expects); arrays and values replace.
  function flatten(obj, prefix, out) {
    Object.keys(obj).forEach((k) => {
      const v = obj[k];
      const path = prefix.concat(k);
      if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) {
        if (Object.keys(v).length) flatten(v, path, out);
      } else {
        out.push(new F.FieldPath(...path), v === undefined ? null : v);
      }
    });
    return out;
  }
  function guarded(first, next, isEmpty) {
    // returns a snapshot handler that holds back an empty, memory-only first answer
    let delivered = false, held = null, timer = null;
    return (snap) => {
      if (!delivered && snap.metadata.fromCache && isEmpty(snap)) {
        held = snap;
        if (!timer) timer = setTimeout(() => { if (!delivered && held) { delivered = true; next(held); } }, WAIT_SERVER_MS);
        return;
      }
      delivered = true; held = null; clearTimeout(timer);
      next(snap);
    };
  }

  function docRef(path) {
    const ref = F.doc(fs, path);
    return {
      id: ref.id, path,
      get: () => F.getDoc(ref).then(wrapDoc).catch((e) => { throw errOf(e); }),
      set: (data) => F.setDoc(ref, data).catch((e) => { throw errOf(e); }),
      update: (data) => {
        const args = flatten(data || {}, [], []);
        if (!args.length) return Promise.resolve();
        return F.updateDoc(ref, ...args).catch((e) => { throw errOf(e); });
      },
      delete: () => F.deleteDoc(ref).catch((e) => { throw errOf(e); }),
      onSnapshot: (next, error) => {
        const h = guarded(true, (s) => next(wrapDoc(s)), (s) => !s.exists());
        return F.onSnapshot(ref, { includeMetadataChanges: true }, h, (e) => { if (error) error(errOf(e)); });
      },
      collection: (sub) => collRef(path + "/" + sub)
    };
  }

  function collRef(path, opts) {
    opts = opts || {};
    const base = F.collection(fs, path);
    function build() {
      // Server-side order only with a limit (dates, newest first); otherwise sort here, so documents
      // without the field are not left out.
      const cons = [];
      if (opts.orderBy && opts.limit) cons.push(F.orderBy(opts.orderBy, opts.dir || "asc"));
      if (opts.limit) cons.push(F.limit(opts.limit));
      (opts.where || []).forEach((w) => cons.push(F.where(w[0], w[1], w[2])));
      return cons.length ? F.query(base, ...cons) : base;
    }
    const localSort = opts.orderBy && !opts.limit ? opts.orderBy : null;
    return {
      path,
      doc: (id) => docRef(id ? path + "/" + id : F.doc(base).path),
      add: (data) => F.addDoc(base, data).then((r) => docRef(r.path)).catch((e) => { throw errOf(e); }),
      orderBy: (field, dir) => collRef(path, Object.assign({}, opts, { orderBy: field, dir: dir || "asc" })),
      limit: (n) => collRef(path, Object.assign({}, opts, { limit: n })),
      where: (f, op, v) => collRef(path, Object.assign({}, opts, { where: (opts.where || []).concat([[f, op, v]]) })),
      get: () => F.getDocs(build()).then((s) => wrapQuery(s, localSort, opts.dir)).catch((e) => { throw errOf(e); }),
      onSnapshot: (next, error) => {
        // Metadata changes are needed only to learn that the server confirmed an empty list;
        // after the first answer, only real changes are passed on (fewer redraws).
        let first = true;
        const h = guarded(false, (s) => { first = false; next(wrapQuery(s, localSort, opts.dir)); }, (s) => s.empty);
        return F.onSnapshot(build(), { includeMetadataChanges: true }, (s) => {
          if (!first && s.docChanges().length === 0) return;
          h(s);
        }, (e) => { if (error) error(errOf(e)); });
      }
    };
  }

  return { doc: docRef, collection: collRef };
}

// ---------- start ----------
async function start() {
  showGate("loading", "Apro Le Tre Celle…");
  let appMod, authMod, F;
  try {
    [appMod, authMod, F] = await Promise.all([
      import(FB + "firebase-app.js"),
      import(FB + "firebase-auth.js"),
      import(FB + "firebase-firestore.js")
    ]);
  } catch (e) {
    showGate("error", "Non riesco ad aprire l'app: serve internet la prima volta. Controlla la connessione e riprova.");
    return;
  }
  const app = appMod.initializeApp(CONFIG);
  const auth = authMod.getAuth(app);
  let fs;
  try {
    fs = F.initializeFirestore(app, {
      ignoreUndefinedProperties: true,
      localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() })
    });
  } catch (e) {
    fs = F.initializeFirestore(app, { ignoreUndefinedProperties: true });
  }

  let deniedShown = false;
  const db = makeDb(fs, F, () => {
    if (deniedShown) return;
    deniedShown = true;
    const b = $("ltcBanner");
    b.textContent = "L'archivio non accetta questo account: controlla le regole di Firestore (email del negozio).";
    b.hidden = false;
  });

  let provided = false;
  authMod.onAuthStateChanged(auth, (user) => {
    if (user) {
      hideGate();
      addAccountBox(user, () => authMod.signOut(auth).then(() => location.reload()));
      if (!provided) {
        provided = true;
        window.__ltcProvide("db", db);
        welcomeIfEmpty(db);
      }
    } else {
      showGate("login", "");
      setTimeout(() => { const e = $("ltcEmail"); if (e && !e.value) e.focus(); }, 50);
    }
  });

  const form = $("ltcLogin");
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const email = $("ltcEmail").value.trim();
    const pass = $("ltcPass").value;
    const btn = $("ltcGo");
    if (!email || !pass) { $("ltcErr").textContent = "Scrivi email e password."; return; }
    btn.disabled = true; btn.textContent = "Entro…"; $("ltcErr").textContent = "";
    try {
      await authMod.signInWithEmailAndPassword(auth, email, pass);
      try { localStorage.setItem("ltc_last_email", email); } catch (_) {}
    } catch (e) {
      const c = (e && e.code) || "";
      let msg = "Non riesco a entrare (" + c.replace("auth/", "") + ").";
      if (/invalid-credential|wrong-password|user-not-found|invalid-email|invalid-login/.test(c)) msg = "Email o password sbagliate.";
      else if (/too-many-requests/.test(c)) msg = "Troppi tentativi: aspetta qualche minuto e riprova.";
      else if (/network-request-failed/.test(c)) msg = "Niente internet: per entrare la prima volta serve la connessione.";
      else if (/user-disabled/.test(c)) msg = "Questo account è stato disattivato.";
      $("ltcErr").textContent = msg;
    } finally {
      btn.disabled = false; btn.textContent = "Entra";
    }
  });
  try { const last = localStorage.getItem("ltc_last_email"); if (last) $("ltcEmail").value = last; } catch (_) {}
}

function addAccountBox(user, logout) {
  if (document.getElementById("ltcAccount")) return;
  const body = document.querySelector("#productsModal .modal-body");
  if (!body) return;
  const box = document.createElement("div");
  box.id = "ltcAccount";
  box.className = "ltc-account";
  box.innerHTML = '<div class="modal-section-title">Accesso</div>' +
    '<p class="danger-text">Questo telefono è collegato come <b></b>. Tutti i telefoni del negozio vedono e salvano gli stessi dati.</p>' +
    '<button class="btn-ghost btn-block" id="ltcLogout">Esci da questo telefono</button>';
  box.querySelector("b").textContent = user.email || "negozio";
  body.appendChild(box);
  let armed = false, t = null;
  box.querySelector("#ltcLogout").addEventListener("click", (e) => {
    const b = e.currentTarget;
    if (!armed) { armed = true; b.textContent = "Tocca di nuovo per uscire"; clearTimeout(t); t = setTimeout(() => { armed = false; b.textContent = "Esci da questo telefono"; }, 4000); return; }
    logout();
  });
}

// First time on the new website: explain how to bring over the data from the version inside Claude.
async function welcomeIfEmpty(db) {
  try {
    const s = await db.collection("products").limit(1).get();
    if (!s.empty || s.metadata.fromCache) return;
    const w = $("ltcWelcome");
    w.hidden = false;
    $("ltcWelcomeOpen").addEventListener("click", () => { w.hidden = true; const b = document.getElementById("openProducts"); if (b) b.click(); setTimeout(() => { const r = document.querySelector(".backup-zone"); if (r) r.scrollIntoView({ behavior: "smooth", block: "start" }); }, 250); });
    $("ltcWelcomeClose").addEventListener("click", () => { w.hidden = true; });
  } catch (_) {}
}

// ---------- works offline and updates itself ----------
if ("serviceWorker" in navigator && window.isSecureContext && !/^file:/.test(location.protocol)) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

start();

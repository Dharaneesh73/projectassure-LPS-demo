/* ============================================
   firebase.js — Project Assure
   Firebase Firestore integration layer.

   CLEAN STRUCTURE (matches your previous project):

   Firestore Collections:
   ┌─────────────────────────────────────────┐
   │  users/                                 │
   │    {userId}/                            │
   │      email:     "ashwin@gmail.com"      │
   │      name:      "Ashwin"                │
   │      plan:      "pro"                   │
   │      role:      "user"                  │
   │      createdAt: "2026-05-09"            │
   │      projects:  [...]                   │
   │                                         │
   │  sessions/                              │
   │    {userId}  → current session          │
   │                                         │
   │  projects/                              │
   │    {projectId} → full project data      │
   └─────────────────────────────────────────┘

   PASSWORDS: never stored in Firestore (localStorage only)
   FREE TIER: 1GB · 50k reads/day · 20k writes/day
============================================ */

/* ── Initialize Firebase ── */
(function initFirebase() {
  const firebaseConfig = {
    apiKey:            "AIzaSyBAjtKC_BPjXI3O1B0lVMDg-d1yD9tsoJo",
    authDomain:        "projectassure-lps.firebaseapp.com",
    projectId:         "projectassure-lps",
    storageBucket:     "projectassure-lps.firebasestorage.app",
    messagingSenderId: "309088480019",
    appId:             "1:309088480019:web:eddb104710a71164c288e6"
  };

  Promise.all([
    import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js")
  ]).then(function(modules) {
    var app = modules[0].initializeApp(firebaseConfig);
    var db  = modules[1].getFirestore(app);
    window._firebaseApp   = app;
    window._firebaseDB    = db;
    window._firebaseMod   = modules[1];
    window._firebaseReady = true;
    console.log('[Firebase] ✓ Connected to projectassure-lps');
    // Trigger hydration now that DB is ready
    if (window.STORE && window.STORE.hydrateFromCloud) {
      window.STORE.hydrateFromCloud();
    }
  }).catch(function(e) {
    console.warn('[Firebase] Failed to initialize — localStorage only.', e.message);
  });
})();

/* ── Internal helpers ── */
function _db()  { return window._firebaseDB  || null; }
function _mod() { return window._firebaseMod || null; }

// Write / merge a single Firestore document
async function _fbSet(col, docId, data) {
  try {
    if (!_db() || !_mod()) throw new Error('DB not ready');
    const { doc, setDoc } = _mod();
    await setDoc(doc(_db(), col, docId), data, { merge: true });
    return true;
  } catch(e) { console.warn('[Firebase] set error:', e.message); return false; }
}

// Read a single Firestore document
async function _fbGet(col, docId) {
  try {
    if (!_db() || !_mod()) throw new Error('DB not ready');
    const { doc, getDoc } = _mod();
    const snap = await getDoc(doc(_db(), col, docId));
    return snap.exists() ? snap.data() : null;
  } catch(e) { console.warn('[Firebase] get error:', e.message); return null; }
}

// Delete a single Firestore document
async function _fbDel(col, docId) {
  try {
    if (!_db() || !_mod()) throw new Error('DB not ready');
    const { doc, deleteDoc } = _mod();
    await deleteDoc(doc(_db(), col, docId));
    return true;
  } catch(e) { console.warn('[Firebase] delete error:', e.message); return false; }
}

// Get all documents in a collection
async function _fbGetAll(col) {
  try {
    if (!_db() || !_mod()) throw new Error('DB not ready');
    const { collection, getDocs } = _mod();
    const snap = await getDocs(collection(_db(), col));
    const results = {};
    snap.forEach(d => { results[d.id] = d.data(); });
    return results;
  } catch(e) { console.warn('[Firebase] getAll error:', e.message); return {}; }
}

/* ── Cloud DB: structured write helpers ────────────────────────────────
   These write to clean, individual Firestore documents
   instead of one big JSON blob.
─────────────────────────────────────────────────────────────────────── */
const DB = {

  // Save a user as an individual Firestore document (no password)
  async saveUser(user) {
    if (!user || !user.id) return;
    const safeUser = {
      id:        user.id,
      email:     user.email     || '',
      plan:      user.plan      || 'free',
      opsUsed:   user.opsUsed   || 0,
      opsReset:  user.opsReset  || '',
      projects:  user.projects  || [],
      createdAt: user.createdAt || new Date().toISOString().slice(0,10),
      updatedAt: new Date().toISOString()
      // NOTE: password is intentionally excluded from Firestore
    };
    await _fbSet('users', user.id, safeUser);
  },

  // Save all users (called when users array changes)
  async saveAllUsers(users) {
    if (!Array.isArray(users)) return;
    for (const user of users) {
      await this.saveUser(user);
    }
  },

  // Save session (only userId + email, not full user object)
  async saveSession(user) {
    if (!user || !user.id) return;
    await _fbSet('sessions', 'current', {
      userId:    user.id,
      email:     user.email || '',
      plan:      user.plan  || 'free',
      savedAt:   new Date().toISOString()
    });
  },

  // Clear session on logout
  async clearSession() {
    await _fbDel('sessions', 'current');
  },

  // Save a project as its own document
  async saveProject(projectId, projectData) {
    if (!projectId || !projectData) return;
    await _fbSet('projects', projectId, {
      ...projectData,
      updatedAt: new Date().toISOString()
    });
  },

  // Load all users from Firestore into localStorage
  async loadUsers() {
    const usersMap = await _fbGetAll('users');
    const ids = Object.keys(usersMap);
    if (ids.length === 0) return null;

    // Merge cloud users with local users (local has passwords, cloud has fresh data)
    const localUsers = JSON.parse(localStorage.getItem('pa_users') || '[]');
    const merged = ids.map(id => {
      const cloudUser = usersMap[id];
      const localUser = localUsers.find(u => u.id === id) || {};
      return { ...cloudUser, password: localUser.password || '' }; // restore password from local
    });
    return merged;
  },

  // Load all projects from Firestore
  async loadProjects() {
    return await _fbGetAll('projects');
  }
};

window.DB = DB; // expose for debugging

/* ── STORE — unified data API used by all of app.js ────────────────────
   Keeps the same .get() / .set() / .del() interface so app.js
   needs zero changes. Internally routes to clean Firestore structure.
─────────────────────────────────────────────────────────────────────── */
const STORE = {

  // Synchronous read — always from localStorage (instant)
  get(k) {
    try { return JSON.parse(localStorage.getItem('pa_' + k)); }
    catch { return null; }
  },

  // Write to localStorage immediately, then route to correct Firestore collection
  set(k, v) {
    try {
      localStorage.setItem('pa_' + k, JSON.stringify(v));
      this._syncToCloud(k, v);  // non-blocking
      return true;
    } catch(e) {
      console.warn('[STORE] set failed:', k, e.message);
      return false;
    }
  },

  del(k) {
    try { localStorage.removeItem('pa_' + k); } catch {}
    // Route delete to correct collection
    if (k === 'session') DB.clearSession().catch(() => {});
  },

  // Smart routing: writes go to the right Firestore collection
  _syncToCloud(k, v) {
    if (!_db()) return; // Firebase still loading — skip silently

    if (k === 'users' && Array.isArray(v)) {
      // Save each user as a separate document
      DB.saveAllUsers(v).catch(e => console.warn('[Firebase] users sync failed:', e.message));

    } else if (k === 'session' && v && v.id) {
      // Save session separately
      DB.saveSession(v).catch(e => console.warn('[Firebase] session sync failed:', e.message));

    } else if (k.startsWith('proj_') && v) {
      // Save project data under projects/{projectId}
      const projectId = k.replace('proj_', '');
      DB.saveProject(projectId, v).catch(e => console.warn('[Firebase] project sync failed:', e.message));

    } else {
      // Fallback: store other keys in pa_store (settings, misc)
      _fbSet('pa_store', k, {
        value:     JSON.stringify(v),
        updatedAt: new Date().toISOString()
      }).catch(e => console.warn('[Firebase] misc sync failed:', e.message));
    }
  },

  // Pull cloud data into localStorage on startup
  async hydrateFromCloud() {
    try {
      if (!_db() || !_mod()) {
        console.log('[Firebase] Not ready yet — skipping hydration');
        return;
      }

      let synced = 0;

      // 1. Load users from clean users/ collection
      const cloudUsers = await DB.loadUsers();
      if (cloudUsers && cloudUsers.length > 0) {
        const localUsers = localStorage.getItem('pa_users');
        if (!localUsers) {
          localStorage.setItem('pa_users', JSON.stringify(cloudUsers));
          synced += cloudUsers.length;
          console.log('[Firebase] Loaded ' + cloudUsers.length + ' users from cloud');
        }
      }

      // 2. Load projects from projects/ collection
      const cloudProjects = await DB.loadProjects();
      const projectIds = Object.keys(cloudProjects);
      for (const pid of projectIds) {
        const key = 'pa_proj_' + pid;
        if (!localStorage.getItem(key)) {
          localStorage.setItem(key, JSON.stringify(cloudProjects[pid]));
          synced++;
        }
      }

      // 3. Load misc from pa_store/ (settings etc)
      const { collection, getDocs } = _mod();
      const snap = await getDocs(collection(_db(), 'pa_store'));
      snap.forEach(docSnap => {
        const k   = docSnap.id;
        const d   = docSnap.data();
        const key = 'pa_' + k;
        if (d && d.value && !localStorage.getItem(key)) {
          localStorage.setItem(key, d.value);
          synced++;
        }
      });

      console.log('[Firebase] ✓ Hydration complete — ' + synced + ' records synced from cloud');
    } catch(e) {
      console.warn('[Firebase] Hydration failed:', e.message);
    }
  }
};

window.STORE = STORE;

/* ── Load app.js after STORE is defined ── */
(function loadApp() {
  var s = document.createElement('script');
  s.src = 'app.js';
  s.onerror = function() {
    console.error('[Loader] Failed to load app.js — make sure all 3 files are in the same folder.');
  };
  document.body.appendChild(s);
})();

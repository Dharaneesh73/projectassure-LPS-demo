/* ============================================
   firebase.js — Project Assure
   Firebase Firestore integration layer.

   HOW IT WORKS:
   • The STORE object is the single data API used
     by the entire app (app.js never calls
     localStorage directly — it always goes through STORE).
   • On every STORE.set() call, data is saved to
     localStorage instantly (so the UI never waits),
     then mirrored to Firestore in the background.
   • On startup, STORE.hydrateFromCloud() pulls any
     cloud data into localStorage so the user gets
     their data on any device / browser.
   • If Firebase is not configured or offline, the
     app falls back silently to localStorage only.

   FIRESTORE COLLECTIONS:
     pa_store/{key}   →  { value: JSON string, updatedAt: ISO date }

   FREE TIER LIMITS (Spark plan — no billing needed):
     1 GB storage · 50k reads/day · 20k writes/day
============================================ */

// ── Internal: get the Firestore DB instance (set by index.html after Firebase loads)
function _db(){ return window._firebaseDB || null; }

// ── Write a document to Firestore
async function _fbSet(col, docId, data){
  try{
    if(!_db()) throw new Error('DB not ready');
    const { doc, setDoc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    await setDoc(doc(_db(), col, docId), data, { merge: true });
    return true;
  }catch(e){ console.warn('[Firebase] set error:', e.message); return false; }
}

// ── Read a document from Firestore
async function _fbGet(col, docId){
  try{
    if(!_db()) throw new Error('DB not ready');
    const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    const snap = await getDoc(doc(_db(), col, docId));
    return snap.exists() ? snap.data() : null;
  }catch(e){ console.warn('[Firebase] get error:', e.message); return null; }
}

// ── Delete a document from Firestore
async function _fbDel(col, docId){
  try{
    if(!_db()) throw new Error('DB not ready');
    const { doc, deleteDoc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    await deleteDoc(doc(_db(), col, docId));
    return true;
  }catch(e){ console.warn('[Firebase] delete error:', e.message); return false; }
}

/* ── STORE ──────────────────────────────────────────────────────────────
   Unified storage API. Used by AUTH, PROJECTS, and all app state.
   Drop-in replacement for the original localStorage-only STORE.

   Sync  (instant)  → localStorage
   Async (background) → Firestore cloud
─────────────────────────────────────────────────────────────────────── */
const STORE = {

  // Read from localStorage (synchronous — used everywhere in app.js)
  get(k){
    try{ return JSON.parse(localStorage.getItem('pa_' + k)); }
    catch{ return null; }
  },

  // Write to localStorage immediately, then sync to cloud in background
  set(k, v){
    try{
      localStorage.setItem('pa_' + k, JSON.stringify(v));
      this._syncToCloud(k, v);
      return true;
    }catch(e){
      console.warn('[STORE] set failed:', k, e.message);
      if(e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED'){
        console.warn('[STORE] localStorage quota exceeded — cloud sync only');
      }
      return false;
    }
  },

  // Delete from both localStorage and Firestore
  del(k){
    try{ localStorage.removeItem('pa_' + k); }catch{}
    _fbDel('pa_store', k).catch(() => {});
  },

  // Background cloud write — wraps value in a Firestore-safe object
  _syncToCloud(k, v){
    if(!_db()) return; // Firebase not ready yet — skip silently
    _fbSet('pa_store', k, {
      value: JSON.stringify(v),
      updatedAt: new Date().toISOString()
    }).catch(e => console.warn('[Firebase] background sync failed:', e.message));
  },

  // Pull all cloud data into localStorage on startup.
  // Called from app.js after the app boots (2 s delay so Firebase has time to init).
  async hydrateFromCloud(){
    try{
      if(!_db()){
        console.log('[Firebase] DB not ready — using localStorage only');
        return;
      }
      // Fetch every document in pa_store and populate localStorage if missing locally
      const { collection, getDocs } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
      const snap = await getDocs(collection(_db(), 'pa_store'));
      let synced = 0;
      snap.forEach(docSnap => {
        const k   = docSnap.id;
        const d   = docSnap.data();
        const key = 'pa_' + k;
        if(d && d.value && !localStorage.getItem(key)){
          localStorage.setItem(key, d.value);
          synced++;
        }
      });
      console.log('[Firebase] Hydration complete ✓ (' + synced + ' keys synced)');
    }catch(e){
      console.warn('[Firebase] Hydration failed:', e.message);
    }
  }
};

// Make STORE globally accessible (app.js references it as a global)
window.STORE = STORE;

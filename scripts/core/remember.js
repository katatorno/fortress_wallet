// scripts/core/remember.js
//
// The only place that touches the browser's storage. It keeps one thing, and only
// when asked in "Data & privacy": a link to the wallet file (not its content; the
// browser tells no path) in IndexedDB. It also lists and removes what earlier
// versions left behind. Settings live in the wallet file; no cookies.

const Remember = (() => {
  const DB = "fortress-files", STORE = "files", KEY = "wallet";
  // left behind by earlier versions: nothing writes these any more
  const OLD_PREFIXES = ["fw.", "fortress:"], OLD_DB = "fortress-wallet";

  // ------------------------------------------------------------ the file

  /** Whether a database is there, asked without creating it. */
  async function _has(name) {
    try { return !!(await indexedDB.databases?.())?.some(d => d.name === name); }
    catch { return false; }
  }

  function _run(mode, fn) {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open(DB, 1);
      open.onupgradeneeded = () => open.result.createObjectStore(STORE);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => { db.close(); resolve(req.result); };
        tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
      };
    });
  }

  function _drop(name) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error("Close the other tabs of this app and try again"));
    });
  }

  /** The remembered file's handle, or null. */
  async function file() {
    try { return (await _has(DB)) ? (await _run("readonly", s => s.get(KEY))) || null : null; }
    catch { return null; }
  }
  const keepFile = (handle) => _run("readwrite", s => s.put(handle, KEY));
  /** Removes the whole database, so that nothing of it is left. */
  const forgetFile = () => _drop(DB);

  // ------------------------------------------------------------ what is there

  const _ours = (key) => OLD_PREFIXES.some(p => key.startsWith(p));

  /** Every entry of a storage; none when the browser blocks it. */
  function _entries(where, storage) {
    try {
      const s = storage();
      return Array.from({ length: s.length }, (_, i) => s.key(i))
        .map(key => ({ where, key, value: s.getItem(key) }));
    }
    catch { return []; }
  }

  /** Everything this app has in the browser, and the names of what others left under this address. */
  async function inventory() {
    const local = _entries("localStorage", () => localStorage);
    const handle = await file();
    return {
      local: local.filter(e => _ours(e.key)),
      session: _entries("sessionStorage", () => sessionStorage).filter(e => _ours(e.key)),
      others: local.filter(e => !_ours(e.key)).map(e => e.key),
      file: handle,
      oldDb: await _has(OLD_DB),
    };
  }

  /** Removes everything of this app, today's and earlier versions'; others' entries stay. */
  async function clearAll() {
    const { local, session } = await inventory();
    for(const e of local) localStorage.removeItem(e.key);
    for(const e of session) sessionStorage.removeItem(e.key);
    for(const name of [DB, OLD_DB]) if(await _has(name)) await _drop(name);
  }

  return { file, keepFile, forgetFile, inventory, clearAll };
})();

// scripts/core/store.js
//
// The open wallet: its data, where it came from and whether it is saved.
// Sources: "example" (built-in demo data) and "local" (a file on this device).
// Every change is saved back automatically where the browser lets a page write
// into the file (Chrome / Edge on a computer); otherwise the app asks you to
// download the updated file.
//
// Each change raises a counter, and the file holds the counter of its last save:
// whatever changed while a save was running is still unsaved. Saves run one after
// another. Before writing, the file's stamp is compared with the one read or
// written last: a file changed by something else (a tool, another tab) is not
// overwritten but reported as a conflict, which you resolve.
//
// Nothing of the wallet is kept in the browser: it lives in this page's memory
// and in your file. What may be remembered between visits is in remember.js.

const Store = (() => {
  const AUTOSAVE_MS = 800;

  let data = null;
  let source = { kind: "example", name: "" };
  let handle = null;          // local file handle (File System Access API)
  let stamp = null;           // the file as it was read or written last
  let status = "saved";       // saved | dirty | saving | conflict | error
  let error = null;
  let timer = null;
  let rev = 0, savedRev = 0;  // the count of changes; the count the file holds
  let queue = Promise.resolve();
  const subs = new Set();

  // ------------------------------------------------------------ state

  const canSaveInPlace = () => source.kind === "local" && !!handle;
  /** Whether leaving now would lose changes. */
  const unsaved = () => source.kind !== "example" && rev !== savedRev;
  const get = () => data;
  const state = () => ({ data, source, status, error, canSaveInPlace: canSaveInPlace(), unsaved: unsaved() });
  function onChange(fn) { subs.add(fn); return () => subs.delete(fn); }
  const emit = () => { for(const fn of subs) fn(state()); };

  function _setStatus(next, err = null) {
    status = next;
    error = err;
    emit();
  }

  function _schedule() {
    clearTimeout(timer);
    timer = canSaveInPlace() && status !== "conflict" ? setTimeout(() => save(), AUTOSAVE_MS) : null;
  }

  function _open(newData, newSource, newHandle = null, newStamp = null) {
    clearTimeout(timer);
    data = newData;
    source = newSource;
    handle = newHandle;
    stamp = newStamp;
    rev = savedRev = 0;
    _setStatus("saved");
  }

  // ------------------------------------------------------------ open

  async function openExample(lang) {
    const res = await fetch("data/wallet.example.json", { cache: "no-cache" });
    const d = Core.parse(await res.text());
    if(lang) d.settings.language = lang;
    _open(d, { kind: "example", name: "" });
  }

  const _openFile = (f) => _open(Core.parse(f.text), { kind: "local", name: f.name }, f.handle, f.stamp || null);

  async function openLocal() {
    const f = await LocalFile.open();
    if(!f) return false;
    _openFile(f);
    return true;
  }

  /** Opens a remembered file; false when the browser does not let us in (see `LocalFile.reopen`). */
  async function openRemembered(known, ask = false) {
    const f = await LocalFile.reopen(known, ask);
    if(!f) return false;
    _openFile(f);
    return true;
  }

  /** Reads the open file again from the disk, dropping the changes made here. */
  async function reloadFromDisk() {
    if(!handle) return false;
    return openRemembered(handle, true);
  }

  /** The open file's handle, where the browser gave one. */
  const fileHandle = () => handle;

  // ------------------------------------------------------------ save

  /** Call after every change of the data. */
  function changed() {
    rev += 1;
    if(status !== "conflict") status = "dirty";
    emit();
    _schedule();
  }

  /**
   * Saves into the file the wallet came from, after any save still running.
   * @param {{force?: boolean}} [opts]  force: write even over a file changed elsewhere
   * @returns {Promise<boolean>} saved
   */
  function save(opts = {}) {
    clearTimeout(timer);
    const run = queue.then(() => _save(opts));
    queue = run.catch(() => {});
    return run;
  }

  async function _save({ force = false } = {}) {
    if(!canSaveInPlace()) { if(unsaved()) _setStatus("dirty"); return false; }
    if(!unsaved() && status === "saved") return true;
    if(status === "conflict" && !force) return false;
    const at = rev, text = Core.serialize(data), h = handle;
    try {
      _setStatus("saving");
      if(!(await LocalFile.permit(h, "write"))) {
        _setStatus("error", new Error("No permission to write the file"));
        return false;
      }
      if(!force && stamp && !LocalFile.sameStamp(await LocalFile.stamp(h), stamp)) {
        if(h === handle) _setStatus("conflict");
        return false;
      }
      const written = await LocalFile.write(h, text);
      if(h !== handle) return false; // another file was opened meanwhile
      if(!written) { _setStatus("error", new Error("No permission to write the file")); return false; }
      stamp = written;
      savedRev = at;
      _setStatus(rev === at ? "saved" : "dirty");
      if(rev !== at) _schedule();
      return true;
    }
    catch(e) {
      if(h === handle) _setStatus("error", e);
      return false;
    }
  }

  /** Downloads the wallet as a file (the way to save on phones and for the example). */
  function download() {
    LocalFile.download(Core.serialize(data), source.name || "fortress-wallet.json");
    if(!canSaveInPlace()) {
      savedRev = rev;
      _setStatus("saved");
    }
  }

  /** "Save as" a new local file. */
  async function saveAsLocal() {
    clearTimeout(timer);
    const at = rev;
    const res = await LocalFile.saveAs(Core.serialize(data), source.name || "fortress-wallet.json");
    if(!res) return false;
    if(res.handle) {
      source = { kind: "local", name: res.name };
      handle = res.handle;
      stamp = res.stamp || null;
    }
    if(res.handle || !canSaveInPlace()) savedRev = at;
    _setStatus(rev === savedRev ? "saved" : "dirty");
    if(rev !== savedRev) _schedule();
    return true;
  }

  return {
    get, state, onChange, unsaved,
    openExample, openLocal, openRemembered, reloadFromDisk, fileHandle,
    changed, save, download, saveAsLocal,
  };
})();

// scripts/core/store.js
//
// The open wallet: its data, where it came from and whether it is saved.
// Sources: "example" (built-in demo data), "local" (a file on this device),
// "drive" (a file on Google Drive). Every change is saved back automatically
// where that is possible (a local file opened in Chrome/Edge, or Drive);
// otherwise the app asks you to download the updated file.
//
// The app keeps nothing in the browser: no cookies, no storage, no database.
// Everything lives in this page's memory and in your file.

const Store = (() => {
  const AUTOSAVE_MS = 800;

  let data = null;
  let source = { kind: "example", name: "" };
  let handle = null;          // local file handle (File System Access API)
  let driveVersion = null;    // version of the Drive file we last read or wrote
  let status = "saved";       // saved | dirty | saving | error | auth | conflict
  let error = null;
  let timer = null;
  const subs = new Set();

  // ------------------------------------------------------------ state

  const canSaveInPlace = () => (source.kind === "local" && !!handle) || source.kind === "drive";
  const get = () => data;
  const state = () => ({ data, source, status, error, canSaveInPlace: canSaveInPlace() });
  function onChange(fn) { subs.add(fn); return () => subs.delete(fn); }
  const emit = () => { for(const fn of subs) fn(state()); };

  function _setStatus(next, err = null) {
    status = next;
    error = err;
    emit();
  }

  function _open(newData, newSource, opts = {}) {
    clearTimeout(timer);
    data = newData;
    source = newSource;
    handle = opts.handle || null;
    driveVersion = opts.version ?? null;
    _setStatus("saved");
  }

  // ------------------------------------------------------------ open

  async function openExample(lang) {
    const res = await fetch("data/wallet.example.json", { cache: "no-cache" });
    const d = Core.parse(await res.text());
    if(lang) d.settings.language = lang;
    _open(d, { kind: "example", name: "" });
  }

  async function openLocal() {
    const f = await LocalFile.open();
    if(!f) return false;
    _open(Core.parse(f.text), { kind: "local", name: f.name }, { handle: f.handle });
    return true;
  }

  async function openDrive(fileId) {
    const { meta, text } = await GDrive.read(fileId);
    _open(Core.parse(text), { kind: "drive", name: meta.name, fileId: meta.id }, { version: meta.version });
  }

  async function pickDrive() {
    const picked = await GDrive.pick();
    if(!picked) return false;
    await openDrive(picked.id);
    return true;
  }

  /** Puts the current wallet on Drive as a new file and keeps working on it there. */
  async function createOnDrive(name = "fortress-wallet.json") {
    const meta = await GDrive.create(name, Core.serialize(data));
    source = { kind: "drive", name: meta.name, fileId: meta.id };
    handle = null;
    driveVersion = meta.version;
    _setStatus("saved");
  }

  // ------------------------------------------------------------ save

  /** Call after every change of the data. */
  function changed() {
    status = "dirty";
    emit();
    clearTimeout(timer);
    if(canSaveInPlace()) timer = setTimeout(() => save(), AUTOSAVE_MS);
  }

  /**
   * Saves where the wallet came from. `force` overwrites a Drive file changed elsewhere.
   * @returns {Promise<boolean>} saved
   */
  async function save({ force = false } = {}) {
    clearTimeout(timer);
    const text = Core.serialize(data);
    try {
      if(source.kind === "local" && handle) {
        _setStatus("saving");
        if(!(await LocalFile.write(handle, text))) { _setStatus("error", new Error("No permission to write the file")); return false; }
      }
      else if(source.kind === "drive") {
        if(!GDrive.connected()) { _setStatus("auth"); return false; }
        _setStatus("saving");
        const meta = await GDrive.update(source.fileId, text, force ? null : driveVersion);
        driveVersion = meta.version;
      }
      else {
        _setStatus("dirty");
        return false;
      }
      _setStatus("saved");
      return true;
    }
    catch(e) {
      if(e.auth) _setStatus("auth", e);
      else if(e.conflict) _setStatus("conflict", e);
      else _setStatus("error", e);
      return false;
    }
  }

  /** Downloads the wallet as a file (the way to save on phones and for the example). */
  function download() {
    LocalFile.download(Core.serialize(data), source.name || "fortress-wallet.json");
    if(!canSaveInPlace()) _setStatus("saved");
  }

  /** "Save as" a new local file. */
  async function saveAsLocal() {
    const res = await LocalFile.saveAs(Core.serialize(data), source.name || "fortress-wallet.json");
    if(!res) return false;
    if(res.handle) {
      source = { kind: "local", name: res.name };
      handle = res.handle;
      driveVersion = null;
    }
    _setStatus("saved");
    return true;
  }

  /** Whether leaving the page would lose changes. */
  const unsaved = () => status !== "saved";

  return {
    get, state, onChange,
    openExample, openLocal, openDrive, pickDrive, createOnDrive,
    changed, save, download, saveAsLocal, unsaved,
  };
})();

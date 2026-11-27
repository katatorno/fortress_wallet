// scripts/core/store.js
//
// The open wallet: its data, where it came from and whether it is saved.
// Sources: "example" (built-in demo data) and "local" (a file on this device).
// Every change is saved back automatically where the browser lets a page write
// into the file (Chrome / Edge on a computer); otherwise the app asks you to
// download the updated file.
//
// The app keeps nothing in the browser: no cookies, no storage, no database.
// Everything lives in this page's memory and in your file.

const Store = (() => {
  const AUTOSAVE_MS = 800;

  let data = null;
  let source = { kind: "example", name: "" };
  let handle = null;          // local file handle (File System Access API)
  let status = "saved";       // saved | dirty | saving | error
  let error = null;
  let timer = null;
  const subs = new Set();

  // ------------------------------------------------------------ state

  const canSaveInPlace = () => source.kind === "local" && !!handle;
  const get = () => data;
  const state = () => ({ data, source, status, error, canSaveInPlace: canSaveInPlace() });
  function onChange(fn) { subs.add(fn); return () => subs.delete(fn); }
  const emit = () => { for(const fn of subs) fn(state()); };

  function _setStatus(next, err = null) {
    status = next;
    error = err;
    emit();
  }

  function _open(newData, newSource, newHandle = null) {
    clearTimeout(timer);
    data = newData;
    source = newSource;
    handle = newHandle;
    _setStatus("saved");
  }

  // ------------------------------------------------------------ open

  async function openExample(lang) {
    const res = await fetch("data/wallet.example.json", { cache: "no-cache" });
    const d = Core.parse(await res.text());
    if(lang) d.settings.language = lang;
    _open(d, { kind: "example", name: "" });
  }

  const _openFile = (f) => _open(Core.parse(f.text), { kind: "local", name: f.name }, f.handle);

  async function openLocal() {
    const f = await LocalFile.open();
    if(!f) return false;
    _openFile(f);
    return true;
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
   * Saves into the file the wallet came from.
   * @returns {Promise<boolean>} saved
   */
  async function save() {
    clearTimeout(timer);
    if(!canSaveInPlace()) { _setStatus("dirty"); return false; }
    const text = Core.serialize(data);
    try {
      _setStatus("saving");
      if(!(await LocalFile.write(handle, text))) { _setStatus("error", new Error("No permission to write the file")); return false; }
      _setStatus("saved");
      return true;
    }
    catch(e) {
      _setStatus("error", e);
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
    }
    _setStatus("saved");
    return true;
  }

  /** Whether leaving the page would lose changes. */
  const unsaved = () => status !== "saved";

  return {
    get, state, onChange,
    openExample, openLocal,
    changed, save, download, saveAsLocal, unsaved,
  };
})();

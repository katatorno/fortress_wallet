// scripts/core/files.js
//
// Local wallet files. Where the browser has the File System Access API
// (Chrome / Edge on a computer) a file is opened once and saved back in place,
// and its handle is kept in IndexedDB so it can be reopened after a restart.
// Elsewhere (phones, Firefox, Safari) a file is read from a picker and saved
// by downloading a new copy.

const LocalFile = (() => {
  const TYPES = [{ description: "Fortress Wallet", accept: { "application/json": [".json"] } }];
  const canWrite = () => typeof window !== "undefined" && "showOpenFilePicker" in window;

  // ------------------------------------------------------------ IndexedDB (one store, few keys)

  function _db() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open("fortress-wallet", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("kv");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function _kv(mode, fn) {
    const db = await _db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("kv", mode);
      const req = fn(tx.objectStore("kv"));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
    });
  }
  const remember = (handle) => _kv("readwrite", s => s.put(handle, "lastHandle")).catch(() => {});
  const forget = () => _kv("readwrite", s => s.delete("lastHandle")).catch(() => {});
  const lastHandle = () => _kv("readonly", s => s.get("lastHandle")).catch(() => null);

  // ------------------------------------------------------------ open

  /** @returns {Promise<{name:string, text:string, handle:FileSystemFileHandle|null}|null>} null when cancelled */
  async function open() {
    if(canWrite()) {
      let handle;
      try { [handle] = await window.showOpenFilePicker({ types: TYPES, multiple: false }); }
      catch(e) { if(e.name === "AbortError") return null; throw e; }
      const file = await handle.getFile();
      remember(handle);
      return { name: file.name, text: await file.text(), handle };
    }
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json,application/json";
      input.addEventListener("change", async () => {
        const file = input.files[0];
        resolve(file ? { name: file.name, text: await file.text(), handle: null } : null);
      });
      input.addEventListener("cancel", () => resolve(null));
      input.click();
    });
  }

  /** Reopens the file of the last session (asks the browser for permission once). */
  async function reopen() {
    const handle = await lastHandle();
    if(!handle) return null;
    if(!(await _permit(handle, "read"))) return null;
    const file = await handle.getFile();
    return { name: file.name, text: await file.text(), handle };
  }

  async function _permit(handle, mode) {
    const opts = { mode: mode === "write" ? "readwrite" : "read" };
    if((await handle.queryPermission?.(opts)) === "granted") return true;
    return (await handle.requestPermission?.(opts)) === "granted";
  }

  // ------------------------------------------------------------ save

  /** Writes back in place; false when the browser refused. */
  async function write(handle, text) {
    if(!(await _permit(handle, "write"))) return false;
    const w = await handle.createWritable();
    await w.write(text);
    await w.close();
    return true;
  }

  /** "Save as": a new file chosen by the user, or a download where that is not possible. */
  async function saveAs(text, suggestedName = "fortress-wallet.json") {
    if("showSaveFilePicker" in window) {
      let handle;
      try { handle = await window.showSaveFilePicker({ suggestedName, types: TYPES }); }
      catch(e) { if(e.name === "AbortError") return null; throw e; }
      await write(handle, text);
      remember(handle);
      return { name: handle.name, handle };
    }
    download(text, suggestedName);
    return { name: suggestedName, handle: null };
  }

  function download(text, name = "fortress-wallet.json") {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return { canWrite, open, reopen, write, saveAs, download, forget, lastHandle };
})();

// scripts/core/files.js
//
// Local wallet files. Where the browser has the File System Access API
// (Chrome / Edge on a computer) a file is opened once and saved back in place,
// and its handle can be opened again later (see remember.js). Elsewhere (phones,
// Firefox, Safari) a file is read from a picker and saved by downloading a new copy.
//
// Every file read comes with its stamp (time of the last change and size), so the
// store can tell whether something else changed the file before it writes.

const LocalFile = (() => {
  const TYPES = [{ description: "Fortress Wallet", accept: { "application/json": [".json"] } }];
  const canWrite = () => typeof window !== "undefined" && "showOpenFilePicker" in window;

  /** What tells one version of a file from another. */
  const stampOf = (file) => ({ modified: file.lastModified, size: file.size });
  const sameStamp = (a, b) => !!a && !!b && a.modified === b.modified && a.size === b.size;

  /** A file's name, text and stamp, read through its handle. */
  async function _read(handle) {
    const file = await handle.getFile();
    return { name: file.name, text: await file.text(), handle, stamp: stampOf(file) };
  }

  // ------------------------------------------------------------ open

  /** @returns {Promise<{name:string, text:string, handle:FileSystemFileHandle|null, stamp:object|null}|null>} null when cancelled */
  async function open() {
    if(canWrite()) {
      let handle;
      try { [handle] = await window.showOpenFilePicker({ types: TYPES, multiple: false }); }
      catch(e) { if(e.name === "AbortError") return null; throw e; }
      return _read(handle);
    }
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json,application/json";
      input.addEventListener("change", async () => {
        const file = input.files[0];
        resolve(file ? { name: file.name, text: await file.text(), handle: null, stamp: null } : null);
      });
      input.addEventListener("cancel", () => resolve(null));
      input.click();
    });
  }

  /**
   * Whether the page may use the file: asked of the browser, which may show its
   * question (only right after a click).
   * @param {"read"|"write"} mode
   */
  async function permit(handle, mode = "write") {
    const opts = { mode: mode === "write" ? "readwrite" : "read" };
    if((await handle.queryPermission?.(opts)) === "granted") return true;
    return (await handle.requestPermission?.(opts)) === "granted";
  }

  /** @returns {Promise<"granted"|"prompt"|"denied">} what the browser allows for a known file */
  async function permission(handle) {
    try { return (await handle.queryPermission?.({ mode: "readwrite" })) || "prompt"; }
    catch { return "prompt"; }
  }

  /**
   * Reads a file known by its handle. Without `ask` only when access is already
   * granted; with it the browser may ask, which needs a click.
   * @returns {Promise<{name:string, text:string, handle:FileSystemFileHandle, stamp:object}|null>} null without access
   */
  async function reopen(handle, ask = false) {
    const allowed = ask ? await permit(handle, "write") : (await permission(handle)) === "granted";
    if(!allowed) return null;
    return _read(handle);
  }

  /** The stamp of the file as it is on the disk now. */
  async function stamp(handle) {
    return stampOf(await handle.getFile());
  }

  // ------------------------------------------------------------ save

  /**
   * Writes back in place. The browser writes into a copy and puts it in the file's
   * place on close, so a broken write leaves the file as it was.
   * @returns {Promise<object|null>} the file's new stamp; null when the browser refused
   */
  async function write(handle, text) {
    if(!(await permit(handle, "write"))) return null;
    const w = await handle.createWritable();
    await w.write(text);
    await w.close();
    return stamp(handle);
  }

  /** "Save as": a new file chosen by the user, or a download where that is not possible. */
  async function saveAs(text, suggestedName = "fortress-wallet.json") {
    if("showSaveFilePicker" in window) {
      let handle;
      try { handle = await window.showSaveFilePicker({ suggestedName, types: TYPES }); }
      catch(e) { if(e.name === "AbortError") return null; throw e; }
      const stamped = await write(handle, text);
      return { name: handle.name, handle, stamp: stamped };
    }
    download(text, suggestedName);
    return { name: suggestedName, handle: null, stamp: null };
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

  return { canWrite, sameStamp, open, permit, permission, reopen, stamp, write, saveAs, download };
})();

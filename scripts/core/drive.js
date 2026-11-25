// scripts/core/drive.js
//
// Google Drive with the narrowest permission Google offers: `drive.file`.
// The app sees only the files it created itself, or that you picked for it
// in the Google Picker – nothing else on your Drive.
//
// Everything runs in the browser: the access token comes from Google Identity
// Services (a one-hour token, kept in memory only), the file goes straight between
// the browser and Google's API. No server of yours ever sees it.

const GDrive = (() => {
  const SCOPE = "https://www.googleapis.com/auth/drive.file";
  const API = "https://www.googleapis.com/drive/v3/files";
  const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
  const FIELDS = "id,name,version,modifiedTime,size";
  const MIME = "application/json";

  let cfg = { clientId: "", apiKey: "", appId: "" };
  let token = null;
  let expires = 0;
  let tokenClient = null;
  let ready = null;

  class AuthError extends Error { constructor(msg = "Not connected to Google Drive") { super(msg); this.auth = true; } }
  class ConflictError extends Error {
    constructor(remote) { super("The file was changed elsewhere"); this.conflict = true; this.remote = remote; }
  }

  // a placeholder left unfilled (no app.ini entry) counts as empty
  const clean = (v) => (typeof v === "string" && !v.includes("{{") ? v.trim() : "");

  function configure({ clientId, apiKey, appId } = {}) {
    cfg = { clientId: clean(clientId), apiKey: clean(apiKey), appId: clean(appId) };
  }
  const available = () => !!cfg.clientId;
  const canPick = () => !!(cfg.clientId && cfg.apiKey && cfg.appId);
  const connected = () => !!token && Date.now() < expires;

  /**
   * Loads Google's sign-in script ahead of time, so a later click can open
   * the sign-in popup at once (a popup opened after a wait gets blocked).
   */
  function preload() {
    if(!available()) return Promise.resolve(false);
    ready ??= UI.script("https://accounts.google.com/gsi/client").then(() => {
      tokenClient = google.accounts.oauth2.initTokenClient({ client_id: cfg.clientId, scope: SCOPE, callback: () => {} });
      return true;
    });
    return ready;
  }

  /**
   * Gets an access token; call it straight from a click.
   * The first time Google asks for consent; later it's a popup that closes by itself.
   */
  function connect() {
    return new Promise((resolve, reject) => {
      if(!tokenClient) { reject(new Error("Google sign-in is still loading – try again in a second")); return; }
      tokenClient.callback = (resp) => {
        if(resp.error) { reject(new Error(resp.error_description || resp.error)); return; }
        if(!google.accounts.oauth2.hasGrantedAllScopes(resp, SCOPE)) {
          reject(new Error("Google Drive access was not granted"));
          return;
        }
        token = resp.access_token;
        expires = Date.now() + (Number(resp.expires_in || 3600) - 60) * 1000;
        resolve();
      };
      tokenClient.error_callback = (err) => reject(new Error(err?.message || err?.type || "Sign-in was cancelled"));
      tokenClient.requestAccessToken({ prompt: "" });
    });
  }

  /** Forgets the token and tells Google to revoke it. */
  function disconnect() {
    if(token && typeof google !== "undefined") google.accounts.oauth2.revoke(token, () => {});
    token = null;
    expires = 0;
  }

  async function _api(url, opts = {}) {
    if(!connected()) throw new AuthError();
    const res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` } });
    if(res.status === 401) { token = null; throw new AuthError("Google sign-in expired"); }
    if(!res.ok) {
      let detail = "";
      try { detail = (await res.json())?.error?.message || ""; } catch(e) { /* not JSON */ }
      throw new Error(`Google Drive: ${res.status} ${detail}`.trim());
    }
    return res;
  }

  /** Wallet files this app can see (only its own and picked ones), newest first. */
  async function list() {
    const q = encodeURIComponent(`trashed = false and mimeType = '${MIME}'`);
    const res = await _api(`${API}?q=${q}&orderBy=modifiedTime desc&pageSize=50&fields=files(${FIELDS})&spaces=drive`);
    return (await res.json()).files || [];
  }

  async function meta(id) {
    return (await _api(`${API}/${encodeURIComponent(id)}?fields=${FIELDS}`)).json();
  }

  /** @returns {Promise<{meta:object, text:string}>} */
  async function read(id) {
    const info = await meta(id);
    const text = await (await _api(`${API}/${encodeURIComponent(id)}?alt=media`)).text();
    return { meta: info, text };
  }

  /** Creates a new file owned by the app. */
  async function create(name, text) {
    const boundary = "fw" + Math.random().toString(16).slice(2);
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify({ name, mimeType: MIME }) +
      `\r\n--${boundary}\r\nContent-Type: ${MIME}\r\n\r\n` + text + `\r\n--${boundary}--`;
    const res = await _api(`${UPLOAD}?uploadType=multipart&fields=${FIELDS}`, {
      method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body,
    });
    return res.json();
  }

  /**
   * Replaces the file's content. With `expectVersion` it first checks that nobody
   * changed the file since we read it (another device), and refuses if so.
   */
  async function update(id, text, expectVersion = null) {
    if(expectVersion != null) {
      const remote = await meta(id);
      if(String(remote.version) !== String(expectVersion)) throw new ConflictError(remote);
    }
    const res = await _api(`${UPLOAD}/${encodeURIComponent(id)}?uploadType=media&fields=${FIELDS}`, {
      method: "PATCH", headers: { "Content-Type": MIME }, body: text,
    });
    return res.json();
  }

  /**
   * Google Picker: choose any JSON file on your Drive (for example one you uploaded
   * by hand); picking it is what grants the app access to that one file.
   * Needs `google_api_key` and `google_app_id` in app.ini.
   * @returns {Promise<{id:string, name:string}|null>}
   */
  async function pick() {
    if(!canPick()) throw new Error("Google Picker is not configured (google_api_key, google_app_id)");
    await UI.script("https://apis.google.com/js/api.js");
    await new Promise((resolve) => gapi.load("picker", resolve));
    return new Promise((resolve) => {
      const view = new google.picker.DocsView(google.picker.ViewId.DOCS).setMimeTypes(MIME).setMode(google.picker.DocsViewMode.LIST);
      const picker = new google.picker.PickerBuilder()
        .addView(view)
        .setOAuthToken(token)
        .setDeveloperKey(cfg.apiKey)
        .setAppId(cfg.appId)
        .setCallback((d) => {
          if(d.action === google.picker.Action.PICKED) resolve({ id: d.docs[0].id, name: d.docs[0].name });
          else if(d.action === google.picker.Action.CANCEL) resolve(null);
        })
        .build();
      picker.setVisible(true);
    });
  }

  return {
    AuthError, ConflictError,
    configure, available, canPick, connected, preload, connect, disconnect,
    list, meta, read, create, update, pick,
  };
})();

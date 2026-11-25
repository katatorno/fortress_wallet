// app.jsx
//
// Start-up: load the texts, set up Google Drive (if configured), open the wallet
// kept on this device (if you allowed that) or the example data, then draw the app.

async function boot() {
  document.body.replaceChildren(<div class="boot"><Spinner /></div>);
  try {
    await I18N.load("locales/translations.toml");
  }
  catch(e) {
    document.body.replaceChildren(<pre class="boot-error">{e.message}</pre>);
    return;
  }

  // the theme choice stays on this device
  Theme.remember({
    get: (k) => { try { return localStorage.getItem("fw." + k); } catch(e) { return null; } },
    set: (k, v) => { try { localStorage.setItem("fw." + k, v); } catch(e) { /* private mode */ } },
  });

  GDrive.configure({ clientId: CONFIG.googleClientId, apiKey: CONFIG.googleApiKey, appId: CONFIG.googleAppId });
  GDrive.preload().catch((e) => console.warn("Google sign-in not available:", e.message));

  try {
    if(!Store.openCached()) {
      let lang = Store.preferredLanguage();
      if(!(lang in I18N.languages())) lang = I18N.DEFAULT;
      await Store.openExample(lang);
    }
  }
  catch(e) {
    document.body.replaceChildren(<pre class="boot-error">{e.message}</pre>);
    return;
  }

  // leaving with unsaved changes asks first
  window.addEventListener("beforeunload", (e) => {
    const st = Store.state();
    if(st.status !== "saved" && st.source.kind !== "example") {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  mountApp();
}

boot();

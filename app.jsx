// app.jsx
//
// Start-up: load the texts, open the remembered wallet file or the example data,
// then draw the app. Language and theme come from the open wallet; for the
// example they follow the browser and the system.

async function boot() {
  document.body.replaceChildren(<div class="boot"><Spinner /></div>);
  try {
    await I18N.load("locales/translations.toml");
  }
  catch(e) {
    document.body.replaceChildren(<pre class="boot-error">{e.message}</pre>);
    return;
  }

  let lang = (navigator.language || I18N.DEFAULT).slice(0, 2);
  if(!(lang in I18N.languages())) lang = I18N.DEFAULT;
  let problem = null;
  try {
    // the remembered file opens by itself when the browser already lets us in
    const known = await Remember.file();
    let opened = false;
    if(known) {
      try { opened = await Store.openRemembered(known); }
      catch(e) { problem = { name: known.name, error: e.message }; }
    }
    if(!opened) await Store.openExample(lang);
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
  if(problem) Alert.err(I18N.t(lang, "err_remembered", problem));
}

boot();

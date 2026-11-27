// app.jsx
//
// Start-up: load the texts, open the example
// data, then draw the app. Nothing is read from or kept in the browser: the theme
// follows the system until you switch it, the language follows the browser.

async function boot() {
  document.body.replaceChildren(<div class="boot"><Spinner /></div>);
  try {
    await I18N.load("locales/translations.toml");
  }
  catch(e) {
    document.body.replaceChildren(<pre class="boot-error">{e.message}</pre>);
    return;
  }

  try {
    let lang = (navigator.language || I18N.DEFAULT).slice(0, 2);
    if(!(lang in I18N.languages())) lang = I18N.DEFAULT;
    await Store.openExample(lang);
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

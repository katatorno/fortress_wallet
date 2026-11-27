// scripts/App.jsx
//
// The shell: a rail of views on the left, the file status and actions on top,
// the view in the middle and net worth in the footer. Views are plain functions
// of the app context; after every change the current one is drawn again.

let _appUnsub = null;
let _appRoot = null;        // the app standing on the page
let _appView = "dashboard"; // the open view, kept over a rebuild

/**
 * Builds the whole app again (after opening another wallet, changing language or a
 * refused change). Only the app is replaced: the messages and tooltips, which the
 * kit adds to the page once and goes on using, stay on it.
 */
function mountApp() {
  _appUnsub?.();
  const root = <App />;
  if(_appRoot) _appRoot.replaceWith(root);
  else document.body.replaceChildren(root);
  _appRoot = root;
}

const App = () => {
  const data = Store.get();
  const L = Core.lang(data);
  document.documentElement.lang = L;
  Theme.set(data.settings.theme);
  const T = (key, vars) => I18N.t(L, key, vars);
  const money = (x, dec = 0) => I18N.money(L, x, dec);

  const sourceText = (st) => st.source.kind === "example" ? T("source_example")
    : T("source_local", { name: st.source.name });

  const app = { data, L, T, money, commit, refresh, reload: mountApp, sourceText };

  // ---------------------------------------------------------- views
  const recBadge = <Badge color="wrn" size="sm" pos="top-right" hidden></Badge>;
  const views = [
    { key: "dashboard", icon: "dashboard", title: T("tab_dashboard"), render: DashboardView },
    { key: "market", icon: "candlestick_chart", title: T("tab_market"), render: MarketView },
    { key: "other", icon: "diamond", title: T("tab_other"), render: OtherAssetsView },
    { key: "cash", icon: "account_balance_wallet", title: T("tab_cash"), render: CashView },
    { key: "transactions", icon: "receipt_long", title: T("tab_transactions"), render: TransactionsView },
    { key: "calculator", icon: "calculate", title: T("tab_calculator"), render: CalculatorView },
    { key: "mortgage", icon: "home", title: T("tab_mortgage"), render: MortgageView },
    { key: "recommendations", icon: "lightbulb", title: T("tab_recommendations"), render: RecommendationsView, badge: recBadge },
    { key: "settings", icon: "settings", title: T("tab_settings"), render: SettingsView },
    { key: "privacy", icon: "shield", title: T("tab_privacy"), render: PrivacyView },
  ];
  let current = _appView;
  for(const v of views) v.nav = <SidebarBtn icon={v.icon} title={v.title} badge={v.badge} onClick={() => show(v.key)} />;

  const heading = <h2 class="view-title"></h2>;
  const banner = <div class="banner-slot"></div>;
  const viewSlot = <div class="view"></div>;
  const content = <Content>{heading}{banner}{viewSlot}</Content>;

  function show(key) {
    current = key;
    _appView = key;
    for(const v of views) v.nav.active = v.key === key;
    refresh();
    content.scrollTop = 0;
  }

  function refresh() {
    const v = views.find(x => x.key === current);
    heading.textContent = v.title;
    try { viewSlot.replaceChildren(v.render(app)); }
    catch(e) {
      console.error(e);
      viewSlot.replaceChildren(<Note level="err" title={T("err_view")}>{e.message}</Note>);
    }
    footerWorth.textContent = `${T("net_worth")}: ${money(Core.summary(data).net_worth)}`;
    const warns = Core.recommendations(data).filter(r => r.level === "warn").length;
    recBadge.text = warns;
    recBadge.hidden = !warns;
  }

  /**
   * Hands a change to `Store.changed`. A refused one is undone there: here it is
   * named, and the app built again around the wallet put back.
   * @returns {boolean} accepted
   */
  function accept() {
    const found = Store.changed();
    if(!found.length) return true;
    Store.get().settings.theme = Theme.choice(); // a theme click that asked for no save stays
    mountApp();
    Alert.err(T("err_change_refused", { problems: Core.problemList(found) }));
    return false;
  }

  /** After a change: snapshot and save (where possible), message, redraw. */
  function commit(msg, opts = {}) {
    if(!accept()) return;
    if(msg) Alert.ok(msg);
    if(opts.rebuild) mountApp();
    else refresh();
  }

  // ---------------------------------------------------------- file status
  const statusBadge = <Badge variant="tint" icon="description" class="status-badge" onClick={() => openFileDialog(app)}></Badge>;
  const saveBtn = <Button variant="primary" icon="save" hidden onClick={() => saveNow()}>{T("btn_save_now")}</Button>;

  async function saveNow() {
    const st = Store.state();
    if(!st.canSaveInPlace) { openFileDialog(app); return; }
    if(await Store.save()) Alert.ok(T("flash_saved"));
  }

  /** Downloads the wallet and says that a cancelled download saved nothing. */
  function downloadNow() {
    Store.download();
    Alert.ok(T("flash_downloaded"));
  }

  // the file changed on the disk since it was read: read it again, or write over it
  async function reloadFromDisk() {
    if(!(await Alert.ask("wrn", T("ask_reload_disk")))) return;
    try {
      if(await Store.reloadFromDisk()) { Alert.ok(T("flash_reloaded")); mountApp(); }
      else Alert.err(T("err_remembered_denied", { name: Store.state().source.name }));
    }
    catch(e) { Alert.err(e.message); }
  }
  async function overwrite() {
    if(!(await Alert.ask("wrn", T("ask_overwrite")))) return;
    if(await Store.save({ force: true })) Alert.ok(T("flash_saved"));
  }

  // a click is what lets the browser ask for access to the remembered file
  async function openRemembered(handle) {
    try {
      if(await Store.openRemembered(handle, true)) mountApp();
      else Alert.err(T("err_remembered_denied", { name: handle.name }));
    }
    catch(e) { Alert.err(T("err_remembered", { name: handle.name, error: e.message })); }
  }

  function bannerFor(st) {
    const btn = (icon, label, fn, variant) => <Button size="sm" variant={variant} icon={icon} onClick={fn}>{label}</Button>;
    if(st.status === "conflict") {
      return <Note level="err" title={T("banner_conflict", { name: st.source.name })}>
        <row gap="sm">
          {btn("refresh", T("btn_reload_disk"), () => reloadFromDisk(), "primary")}
          {btn("save", T("btn_overwrite"), () => overwrite())}
          {btn("save_as", T("btn_save_as"), () => openFileDialog(app))}
        </row>
      </Note>;
    }
    if(st.status === "error") {
      return <Note level="err" title={T("banner_error", { error: st.error?.message || "" })}>
        {btn("refresh", T("btn_retry"), () => saveNow())}
      </Note>;
    }
    if(st.source.kind === "example") {
      const choose = btn("folder_open", T("btn_file"), () => openFileDialog(app), "primary");
      const actions = <row gap="sm">{choose}</row>;
      Remember.file().then((handle) => {
        if(!handle) return;
        choose.classList.remove("btn-primary"); // one suggested action at a time
        actions.prepend(btn("history", T("btn_open_remembered", { name: handle.name }), () => openRemembered(handle), "primary"));
      });
      return <Note level="info" title={T("banner_example")}>{actions}</Note>;
    }
    if(st.status === "dirty" && !st.canSaveInPlace) {
      return <Note level="warn" title={T("banner_download_needed")}>
        <row gap="sm">
          {btn("download", T("btn_download_copy"), () => downloadNow(), "primary")}
          {btn("folder", T("btn_file"), () => openFileDialog(app))}
        </row>
      </Note>;
    }
    return null;
  }

  function updateStatus(st) {
    const color = { saved: "ok", dirty: "wrn", saving: "inf", conflict: "err", error: "err" }[st.status];
    statusBadge.color = color;
    statusBadge.text = `${sourceText(st)} · ${T("status_" + st.status)}`;
    statusBadge.title = T("btn_file");
    saveBtn.hidden = !st.unsaved || st.status === "saving" || st.status === "conflict";
    footerSource.textContent = sourceText(st);
    const b = bannerFor(st);
    banner.replaceChildren(...(b ? [b] : []));
  }

  // ---------------------------------------------------------- language
  const langs = I18N.languages();
  const langSelect = (
    <Select size="sm" value={L} title="Language · Język · Idioma" onChange={(v) => {
      data.settings.language = v;
      commit(null, { rebuild: true });
    }}>{options(Object.entries(langs))}</Select>
  );

  // ---------------------------------------------------------- theme
  // the choice is kept in the wallet file; a theme click alone never asks for a download
  function chooseTheme() {
    Theme.toggle();
    data.settings.theme = Theme.choice();
    if(Store.state().canSaveInPlace) accept();
  }
  // the icon names what is showing, the tooltip what a click brings
  const themeBtn = <IconBtn icon="light_mode" title={T("theme_dark")} onClick={() => chooseTheme()} />;
  function showTheme() {
    const dark = Theme.isDark();
    themeBtn.icon = dark ? "dark_mode" : "light_mode";
    themeBtn.title = dark ? T("theme_light") : T("theme_dark");
  }

  const footerWorth = <span></span>;
  const footerSource = <span></span>;
  const shell = (
    <Shell
      sidebar={<Sidebar>{views.map(v => v.nav)}</Sidebar>}
      topbar={
        <Topbar>
          <TopbarLogo img="fortress.svg" alt="">Fortress Wallet</TopbarLogo>
          <spacer />
          {statusBadge}
          {saveBtn}
          <Button icon="folder_open" onClick={() => openFileDialog(app)}>{T("btn_file")}</Button>
          <inline fold gap="xs">{langSelect}{themeBtn}</inline>
        </Topbar>
      }
      footer={<Footer left={<inline><Icon name="savings" size="sm" />{footerWorth}</inline>}
        center={<inline><Icon name="description" size="sm" />{footerSource}</inline>}
        right={<span tone="meta">
          <span class="foot-name">Fortress Wallet {CONFIG.version.includes("{{") ? "" : CONFIG.version} · </span>
          Built with <a href="https://tonkajsx.com" target="_blank" rel="noopener noreferrer">TonkaJSX</a>
        </span>} />}>
      {content}
    </Shell>
  );

  const offStore = Store.onChange(updateStatus);
  const offTheme = Theme.onChange(showTheme);
  _appUnsub = () => { offStore(); offTheme(); };
  showTheme();
  show(current);
  updateStatus(Store.state());
  return shell;
};

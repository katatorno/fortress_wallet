// scripts/App.jsx
//
// The shell: a rail of views on the left, the file status and actions on top,
// the view in the middle and net worth in the footer. Views are plain functions
// of the app context; after every change the current one is drawn again.

let _appUnsub = null;
let _appView = "dashboard"; // the open view, kept over a rebuild

/** Builds the whole app again (after opening another wallet or changing language). */
function mountApp() {
  _appUnsub?.();
  document.body.replaceChildren(<App />);
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

  /** After a change: snapshot, save (where possible), message, redraw. */
  function commit(msg, opts = {}) {
    Core.upsertSnapshot(data);
    Store.changed();
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

  function bannerFor(st) {
    const btn = (icon, label, fn, variant) => <Button size="sm" variant={variant} icon={icon} onClick={fn}>{label}</Button>;
    if(st.status === "error") {
      return <Note level="err" title={T("banner_error", { error: st.error?.message || "" })}>
        {btn("refresh", T("btn_retry"), () => saveNow())}
      </Note>;
    }
    if(st.source.kind === "example") {
      return <Note level="info" title={T("banner_example")}>
        <row gap="sm">
          {btn("folder_open", T("btn_file"), () => openFileDialog(app), "primary")}
        </row>
      </Note>;
    }
    if(st.status === "dirty" && !st.canSaveInPlace) {
      return <Note level="warn" title={T("banner_download_needed")}>
        <row gap="sm">
          {btn("download", T("btn_download_copy"), () => Store.download(), "primary")}
          {btn("folder", T("btn_file"), () => openFileDialog(app))}
        </row>
      </Note>;
    }
    return null;
  }

  function updateStatus(st) {
    const color = { saved: "ok", dirty: "wrn", saving: "inf", error: "err" }[st.status];
    statusBadge.color = color;
    statusBadge.text = `${sourceText(st)} · ${T("status_" + st.status)}`;
    statusBadge.title = T("btn_file");
    saveBtn.hidden = st.status === "saved" || st.status === "saving" || st.source.kind === "example";
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
    if(Store.state().canSaveInPlace) Store.changed();
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
        right={<span tone="meta">Fortress Wallet {CONFIG.version.includes("{{") ? "" : CONFIG.version}</span>} />}>
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

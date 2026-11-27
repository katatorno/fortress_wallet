// scripts/Privacy.jsx
//
// "Data & privacy": how the app works in plain words, remembering the wallet file,
// everything the browser holds right now with a button that removes it, what to be
// aware of and whom the page talks to. Written for the page as served by a server.

/** A ruled table of texts; the cells may be elements. */
const _factTable = (head, rows) => (
  <div class="table facts">
    <table>
      <thead><tr>{head.map(h => <th>{h}</th>)}</tr></thead>
      <tbody>{rows.map(cells => <tr>{cells.map(c => <td>{c}</td>)}</tr>)}</tbody>
    </table>
  </div>
);

const _list = (items, ordered) => {
  const lines = items.map(text => <li>{text}</li>);
  return ordered ? <ol class="facts-list">{lines}</ol> : <ul class="facts-list">{lines}</ul>;
};

/** A stored text as it is; a long one is cut, with its full length named. */
const _raw = (T, value) => (
  <code class="stored-value">
    {value.length > 300 ? `${value.slice(0, 300)}… ${T("privacy_cut", { count: value.length })}` : value}
  </code>
);

/** The servers this page has fetched something from since it was opened. */
const _contacted = () => [...new Set([location.host,
  ...performance.getEntriesByType("resource").map(e => new URL(e.name).host)])].filter(Boolean);

const PrivacyView = (app) => {
  const { T } = app;
  const live = <stack gap="md"><Spinner /></stack>;

  /** Runs a change of what is stored, says how it went and shows the new state. */
  async function change(fn, message) {
    try {
      await fn();
      Alert.ok(message);
    }
    catch(e) { Alert.err(T("err_storage", { error: e.message })); }
    app.refresh();
  }

  // ---------------------------------------------------------- the remembered file
  async function filePanel(known) {
    const open = Store.fileHandle();
    const same = !!(known && open && await known.isSameEntry(open));
    let state = T("privacy_file_none");
    if(known) {
      state = (await LocalFile.permission(known)) === "granted"
        ? T("privacy_file_granted", { name: known.name }) : T("privacy_file_asks", { name: known.name });
    }
    const keep = (
      <Button variant="primary" icon="bookmark_add" disabled={!open || same}
        onClick={() => change(() => Remember.keepFile(open), T("flash_file_kept", { name: open.name }))}>
        {open && !same ? T("privacy_file_keep_named", { name: open.name }) : T("privacy_file_keep")}
      </Button>
    );
    return (
      <Panel title={T("privacy_file_title")} icon="draft">
        <stack gap="sm">
          <small tone="note">{T("privacy_file_path")}</small>
          {LocalFile.canWrite()
            ? [
              <strong>{state}</strong>,
              <row gap="sm">
                {keep}
                {known ? <Button icon="bookmark_remove"
                  onClick={() => change(() => Remember.forgetFile(), T("flash_file_forgotten"))}>{T("privacy_file_forget")}</Button> : null}
              </row>,
              !open ? <small tone="note">{T("privacy_file_open_first")}</small> : null,
              <sep />,
              _list([T("privacy_file_step_1"), T("privacy_file_step_2"), T("privacy_file_step_3"), T("privacy_file_step_4")], true),
              <small tone="note">{T("privacy_file_revoke")}</small>,
            ]
            : <Note level="info">{T("privacy_file_unsupported")}</Note>}
        </stack>
      </Panel>
    );
  }

  // ---------------------------------------------------------- what is there now
  function storedPanel(inv) {
    const about = (key) => key === "fw.cache" ? T("privacy_what_old_copy") : T("privacy_what_old");
    const rows = [
      ...[...inv.local, ...inv.session].map(e => [e.where, e.key, about(e.key), _raw(T, e.value)]),
      ...(inv.file ? [["IndexedDB", "fortress-files", T("privacy_what_file"),
        _raw(T, T("privacy_file_value", { name: inv.file.name }))]] : []),
      ...(inv.oldDb ? [["IndexedDB", "fortress-wallet", T("privacy_what_old_db"), "–"]] : []),
    ];
    return (
      <Panel title={T("privacy_stored_title")} icon="database">
        <stack gap="sm">
          <small tone="note">{T("privacy_stored_address", { address: location.origin })}</small>
          {rows.length
            ? _factTable([T("privacy_col_where"), T("privacy_col_name"), T("privacy_col_what"), T("privacy_col_value")], rows)
            : <Note level="ok">{T("privacy_stored_nothing")}</Note>}
          {inv.others.length
            ? <small tone="note">{T("privacy_stored_others", { names: inv.others.join(", ") })}</small> : null}
          <row><Button variant="danger" icon="delete_forever" disabled={!rows.length} onClick={async () => {
            if(!(await Alert.ask("wrn", T("ask_clear_browser")))) return;
            change(() => Remember.clearAll(), T("flash_browser_cleared"));
          }}>{T("privacy_clear")}</Button></row>
          <small tone="note">{T("privacy_clear_help")}</small>
        </stack>
      </Panel>
    );
  }

  (async () => {
    const inv = await Remember.inventory();
    live.replaceChildren(await filePanel(inv.file), storedPanel(inv));
  })().catch(e => live.replaceChildren(<Note level="err">{T("err_storage", { error: e.message })}</Note>));

  // ---------------------------------------------------------- facts
  const how = (
    <Panel title={T("privacy_how_title")} icon="lightbulb">
      {_list([T("privacy_how_1"), T("privacy_how_2"), T("privacy_how_3"), T("privacy_how_4"), T("privacy_how_5")], true)}
    </Panel>
  );

  const beware = (
    <Panel title={T("privacy_beware_title")} icon="warning">
      {_list([T("privacy_beware_plain"), T("privacy_beware_server"), T("privacy_beware_permission"),
        T("privacy_beware_origin", { address: location.origin }),
        T("privacy_beware_cookies"), T("privacy_beware_lost")])}
    </Panel>
  );

  const talks = (
    <Panel title={T("privacy_net_title")} icon="public">
      <stack gap="sm">
        {_factTable([T("privacy_col_who"), T("privacy_col_when"), T("privacy_col_gets")], [
          [location.host, T("privacy_net_when_open"), T("privacy_net_server")],
          ["api.frankfurter.dev", T("privacy_net_when_fx"), T("privacy_net_fx")],
        ])}
        <strong>{T("privacy_net_now", { hosts: _contacted().join(", ") })}</strong>
        <small tone="note">{T("privacy_net_note")}</small>
      </stack>
    </Panel>
  );

  return <stack gap="md">{how}{live}{beware}{talks}</stack>;
};

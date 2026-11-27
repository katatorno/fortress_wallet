// scripts/FileDialog.jsx
//
// The "File" dialog: open or save a wallet file on this device, or go back to the
// example data.

function openFileDialog(app) {
  const { T } = app;
  const body = <stack gap="md"></stack>;
  const modal = <Modal title={T("file_title")} size="lg" once>{body}</Modal>;

  // opening another wallet would drop unsaved changes: ask first
  async function guarded(fn) {
    if(Store.unsaved() && !(await Alert.ask("wrn", T("ask_discard")))) return;
    try {
      if(await fn() !== false) { modal.close(); app.reload(); }
    }
    catch(e) { Alert.err(e.message); }
  }

  function localPanel() {
    return (
      <Panel title={T("file_local_title")} icon="folder">
        <stack gap="sm">
          <small tone="note">{T(LocalFile.canWrite() ? "file_local_help_write" : "file_local_help_download")}</small>
          <row gap="sm">
            <Button icon="folder_open" onClick={() => guarded(() => Store.openLocal())}>{T("btn_open_local")}</Button>
            <Button icon="save_as" onClick={async () => {
              try { if(await Store.saveAsLocal()) { Alert.ok(T("flash_saved")); render(); } }
              catch(e) { Alert.err(e.message); }
            }}>{T("btn_save_as")}</Button>
            <Button icon="download" onClick={() => { Store.download(); Alert.ok(T("flash_downloaded")); render(); }}>{T("btn_download_copy")}</Button>
          </row>
        </stack>
      </Panel>
    );
  }

  function render() {
    const st = Store.state();
    body.replaceChildren(
      <Note level={st.status === "saved" ? "ok" : "warn"} title={app.sourceText(st)}>{T("status_" + st.status)}</Note>,
      localPanel(),
      <row><Button variant="ghost" icon="science" onClick={() => guarded(() => Store.openExample(app.L))}>{T("btn_load_example")}</Button></row>,
    );
  }

  render();
  modal.open();
}

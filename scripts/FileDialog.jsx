// scripts/FileDialog.jsx
//
// The "File" dialog: open or save a wallet file on this device, open, create or
// pick a file on Google Drive, or go back to the example data.

function openFileDialog(app) {
  const { T } = app;
  const body = <stack gap="md"></stack>;
  const modal = <Modal title={T("file_title")} size="lg" once>{body}</Modal>;

  // opening another wallet would drop unsaved changes: ask first
  async function guarded(fn) {
    const st = Store.state();
    if(st.status !== "saved" && st.source.kind !== "example") {
      if(!(await Alert.ask("wrn", T("ask_discard")))) return;
    }
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
            <Button icon="download" onClick={() => { Store.download(); render(); }}>{T("btn_download_copy")}</Button>
          </row>
        </stack>
      </Panel>
    );
  }

  function drivePanel() {
    if(!GDrive.available()) {
      return (
        <Panel title={T("file_drive_title")} icon="add_to_drive">
          <Note level="info">{T("drive_not_configured")}</Note>
        </Panel>
      );
    }
    if(!GDrive.connected()) {
      return (
        <Panel title={T("file_drive_title")} icon="add_to_drive">
          <stack gap="sm">
            <small tone="note">{T("drive_help")}</small>
            <row><Button variant="primary" icon="login" onClick={async () => {
              try { await GDrive.connect(); render(); }
              catch(e) { Alert.err(T("err_drive", { error: e.message })); }
            }}>{T("btn_drive_connect")}</Button></row>
          </stack>
        </Panel>
      );
    }
    const list = <stack gap="xs"><Spinner /></stack>;
    GDrive.list().then(files => {
      const cur = Store.state().source;
      list.replaceChildren(...(files.length ? files.map(f => (
        <Panel inline icon="description" selected={cur.kind === "drive" && cur.fileId === f.id}
          actions={<Button size="sm" icon="open_in_new" onClick={() => guarded(() => Store.openDrive(f.id))}>{T("btn_open")}</Button>}>
          <stack gap="no">
            <strong>{f.name}</strong>
            <small tone="meta">{T("drive_modified", { date: (f.modifiedTime || "").slice(0, 16).replace("T", " ") })}</small>
          </stack>
        </Panel>
      )) : [<Empty icon="cloud_off" description={T("drive_no_files")} />]));
    }).catch(e => list.replaceChildren(<Note level="err">{T("err_drive", { error: e.message })}</Note>));

    const name = <Input value={Store.state().source.name || "fortress-wallet.json"} />;
    return (
      <Panel title={T("file_drive_title")} icon="add_to_drive"
        actions={<Button size="sm" variant="ghost" icon="logout" onClick={() => { GDrive.disconnect(); render(); }}>{T("btn_drive_disconnect")}</Button>}>
        <stack gap="sm">
          <strong>{T("drive_files_title")}</strong>
          {list}
          <sep />
          <strong>{T("drive_save_new_title")}</strong>
          <row gap="sm" align="center">
            {name}
            <Button icon="cloud_upload" onClick={async () => {
              const n = name.value.trim() || "fortress-wallet.json";
              try {
                await Store.createOnDrive(n.endsWith(".json") ? n : n + ".json");
                Alert.ok(T("flash_saved_drive"));
                modal.close();
                app.reload();
              }
              catch(e) { Alert.err(T("err_drive", { error: e.message })); }
            }}>{T("btn_save_to_drive")}</Button>
          </row>
          {GDrive.canPick() ? (
            <row><Button variant="ghost" icon="drive_file_move" onClick={() => guarded(() => Store.pickDrive())}>{T("btn_drive_pick")}</Button></row>
          ) : null}
          <small tone="note">{T("drive_privacy")}</small>
        </stack>
      </Panel>
    );
  }

  function render() {
    const st = Store.state();
    body.replaceChildren(
      <Note level={st.status === "saved" ? "ok" : "warn"} title={app.sourceText(st)}>{T("status_" + st.status)}</Note>,
      localPanel(),
      drivePanel(),
      <row><Button variant="ghost" icon="science" onClick={() => guarded(() => Store.openExample(app.L))}>{T("btn_load_example")}</Button></row>,
    );
  }

  render();
  modal.open();
}

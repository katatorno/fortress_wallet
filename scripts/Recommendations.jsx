// scripts/Recommendations.jsx
//
// Automatic hints (warnings first) and your own strategy notes in Markdown.

const RecommendationsView = (app) => {
  const { data, T } = app;
  const order = { warn: 0, info: 1, ok: 2 };
  const recs = Core.recommendations(data).sort((a, b) => order[a.level] - order[b.level]);
  const notes = <Textarea value={data.strategy_notes || ""} auto minRows={8} maxRows={30} />;
  const preview = <Markdown text={data.strategy_notes || ""} />;
  return (
    <stack gap="md">
      {recs.map(r => <Note level={r.level} title={r.title}>{r.text}</Note>)}
      <Panel title={T("strategy_title")} icon="flag">
        <stack gap="sm">
          {preview}
          <Expander title={T("strategy_notes")} icon="edit">
            <stack gap="sm">
              {notes}
              <row><Button variant="primary" icon="save" onClick={() => {
                data.strategy_notes = notes.value;
                app.commit(T("flash_strategy_saved"));
              }}>{T("btn_save")}</Button></row>
            </stack>
          </Expander>
        </stack>
      </Panel>
    </stack>
  );
};

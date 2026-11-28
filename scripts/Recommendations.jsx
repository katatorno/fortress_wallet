// scripts/Recommendations.jsx
//
// Automatic hints, as `Advice` orders them, and your own strategy notes in Markdown.
// The notes come from the file, so their links and pictures go through `Links`.

const RecommendationsView = (app) => {
  const { data, T } = app;
  const recs = Advice.recommendations(data);
  const notes = <Textarea value={data.strategy_notes || ""} auto minRows={8} maxRows={30} />;
  const preview = Links.defuse(<Markdown text={data.strategy_notes || ""} image={(src) => Links.isSafe(src) ? src : ""} />);
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

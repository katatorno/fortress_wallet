// .tests/store.test.cjs
//
// Saving the open wallet (scripts/core/store.js): the autosave, a change made
// while a save runs, saves one after another, a refused permission, a file changed
// on the disk by something else, downloads and the example. The disk, the browser's
// permission and the timers are stood in for.
// Run: tonka test fortress_wallet   (or: node .tests/store.test.cjs)

const { readFileSync } = require("node:fs");
const path = require("node:path");
const { APP, loadCore } = require("../tools/wallet.cjs");

const EXAMPLE = readFileSync(path.join(APP, "data", "wallet.example.json"), "utf8");

let pass = 0, fail = 0;
function ok(name, cond, detail = "") {
  if(cond) pass++; else fail++;
  console.log(`  ${cond ? "ok  " : "FAIL"} ${name}${cond ? "" : "\n       " + detail}`);
}

/** A disk holding one file, a browser that may refuse, and timers run by hand. */
function world({ withHandle = true } = {}) {
  const file = { text: EXAMPLE, modified: 1 };
  const stampNow = () => ({ modified: file.modified, size: file.text.length });
  const handle = withHandle ? { name: "w.json" } : null;
  const w = { file, writes: [], downloads: [], permitted: true, hold: null, timers: new Map() };
  let id = 0;
  const LocalFile = {
    sameStamp: (a, b) => !!a && !!b && a.modified === b.modified && a.size === b.size,
    open: async () => ({ name: "w.json", text: file.text, handle, stamp: handle ? stampNow() : null }),
    reopen: async () => ({ name: "w.json", text: file.text, handle, stamp: stampNow() }),
    permit: async () => w.permitted,
    stamp: async () => stampNow(),
    write: async (h, text) => {
      const held = w.hold;
      w.hold = null; // only the next write waits
      if(held) await held;
      if(!w.permitted) return null;
      w.writes.push(text);
      file.text = text;
      file.modified += 1;
      return stampNow();
    },
    download: (text) => w.downloads.push(text),
  };
  const globals = {
    LocalFile,
    setTimeout: (fn) => { w.timers.set(++id, fn); return id; },
    clearTimeout: (t) => w.timers.delete(t),
    fetch: async () => ({ text: async () => EXAMPLE }),
  };
  const { run } = loadCore(["store.js"], globals);
  w.Store = run("Store");
  /** Runs the timers due, as the time passing would, and waits for what they started. */
  w.tick = async () => {
    const due = [...w.timers.values()];
    w.timers.clear();
    await Promise.all(due.map(fn => fn()));
  };
  /** Holds the next write, and that one only, until `release()`. */
  w.holdWrites = () => { let release; w.hold = new Promise(r => { release = r; }); return () => release(); };
  return w;
}
const notes = (text) => JSON.parse(text).strategy_notes;
const change = (w, note) => { w.Store.get().strategy_notes = note; w.Store.changed(); };

(async () => {
  // ---------------------------------------------------------- the autosave
  {
    const w = world();
    await w.Store.openLocal();
    ok("an opened file is saved", w.Store.state().status === "saved" && !w.Store.unsaved());
    change(w, "one");
    ok("a change is unsaved and a save is due", w.Store.state().status === "dirty" && w.Store.unsaved() && w.timers.size === 1);
    await w.tick();
    ok("the autosave writes the change", w.writes.length === 1 && notes(w.file.text) === "one");
    ok("then everything is saved", w.Store.state().status === "saved" && !w.Store.unsaved());
  }

  // ---------------------------------------------------------- a change while saving
  {
    const w = world();
    await w.Store.openLocal();
    change(w, "one");
    const release = w.holdWrites();
    const saving = w.tick();
    await new Promise(r => setImmediate(r));
    ok("the save is running", w.Store.state().status === "saving");
    change(w, "two");
    release();
    await saving;
    ok("a change made during the save stays unsaved", w.Store.unsaved() && w.Store.state().status === "dirty",
      JSON.stringify(w.Store.state().status));
    ok("the file holds what was there when the save began", notes(w.file.text) === "one");
    ok("another save is due", w.timers.size === 1);
    await w.tick();
    ok("which writes the later change", notes(w.file.text) === "two" && !w.Store.unsaved());
  }

  // ---------------------------------------------------------- saves one after another
  {
    const w = world();
    await w.Store.openLocal();
    const release = w.holdWrites();
    change(w, "one");
    const first = w.Store.save();
    await new Promise(r => setImmediate(r)); // the first save has begun and waits on the disk
    change(w, "two");
    const second = w.Store.save();
    await new Promise(r => setImmediate(r)); // time enough for a second save running beside the first to write
    release();
    await Promise.all([first, second]);
    ok("saves never overtake each other", w.writes.map(notes).join() === "one,two" && notes(w.file.text) === "two",
      w.writes.map(notes).join());
  }

  // ---------------------------------------------------------- no permission
  {
    const w = world();
    await w.Store.openLocal();
    w.permitted = false;
    change(w, "one");
    await w.tick();
    ok("a refused permission is an error, not a save", w.Store.state().status === "error" && w.Store.unsaved() && !w.writes.length);
  }

  // ---------------------------------------------------------- changed elsewhere
  {
    const w = world();
    await w.Store.openLocal();
    w.file.text = EXAMPLE.replace('"strategy_notes": "', '"strategy_notes": "tool ');
    w.file.modified += 1;
    change(w, "mine");
    await w.tick();
    ok("a file changed elsewhere is not written over", w.Store.state().status === "conflict" && !w.writes.length
      && notes(w.file.text).startsWith("tool "));
    change(w, "mine again");
    ok("a further change keeps the conflict and saves nothing", w.Store.state().status === "conflict" && !w.timers.size);
    ok("leaving would lose the changes", w.Store.unsaved());
    ok("writing this version is a choice", await w.Store.save({ force: true }) && notes(w.file.text) === "mine again"
      && w.Store.state().status === "saved");
  }
  {
    const w = world();
    await w.Store.openLocal();
    w.file.text = EXAMPLE.replace('"strategy_notes": "', '"strategy_notes": "tool ');
    w.file.modified += 1;
    change(w, "mine");
    await w.tick();
    await w.Store.reloadFromDisk();
    ok("reading the file again takes what is on the disk", notes(JSON.stringify(w.Store.get())).startsWith("tool ")
      && w.Store.state().status === "saved" && !w.Store.unsaved());
  }

  // ---------------------------------------------------------- download and the example
  {
    const w = world({ withHandle: false });
    await w.Store.openLocal();
    change(w, "one");
    ok("without writing in place nothing is scheduled", w.Store.state().status === "dirty" && !w.timers.size);
    w.Store.download();
    ok("a download carries the changes and counts as saved", w.downloads.length === 1 && notes(w.downloads[0]) === "one"
      && !w.Store.unsaved());
  }
  {
    const w = world();
    await w.Store.openExample("pl");
    change(w, "one");
    ok("changes to the example never hold the page", !w.Store.unsaved() && !w.timers.size);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log(e); process.exit(1); });

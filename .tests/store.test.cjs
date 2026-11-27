// .tests/store.test.cjs
//
// Saving the open wallet (scripts/core/store.js): the autosave, a change made
// while a save runs, saves one after another, a refused permission, a file changed
// on the disk by something else, downloads, the example, changes refused as the
// wallet would not open with them, and one change of every place in a wallet: what
// is accepted opens again. The disk, the browser's permission and the timers are
// stood in for.
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
  const { ctx, run, ...modules } = loadCore(["store.js"], globals);
  Object.assign(w, modules); // by name, from the context the store runs in
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
const change = (w, note) => { w.Store.get().strategy_notes = note; return w.Store.changed(); };

/** An instrument added as the form of Instruments.jsx adds one, and what `changed` answers. */
function addInstrument(w, fields) {
  const { Base, Buckets, Dates, Store, WalletFile } = w;
  const data = Store.get();
  const bucket = Object.keys(data.buckets)[0];
  const asset = WalletFile.normalize({ assets: [{
    id: Base.newId(), name: "New", ticker: "", category: data.buckets[bucket].category, bucket,
    currency: "EUR", opening_quantity: 0, price: 0, unit: "pcs", price_updated: Dates.today(), ...fields,
  }] }).assets[0];
  data.assets.push(asset);
  Buckets.rebalance(data, bucket);
  return Store.changed();
}
/** The message of opening a file with this text, "" when it opens. */
const refusal = (w, text) => { try { w.WalletFile.parse(text); return ""; } catch(e) { return e.message; } };

// the wallet's maps, by their paths: the rest of its objects are records
const MAPS = /^(categories|buckets|settings\.fx|prices(\.[^.]+)?|fx_history(\.[^.]+)?)$/;
/** The places in a wallet, as paths: every key of a record, the first element of a list or map. */
function places(value, at = []) {
  if(!value || typeof value !== "object") return [];
  const keys = Object.keys(value);
  const taken = Array.isArray(value) || MAPS.test(at.join(".")) ? keys.slice(0, 1) : keys;
  return taken.flatMap(k => [[...at, k], ...places(value[k], [...at, k])]);
}

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

  // ---------------------------------------------------------- a change the wallet would not open with
  {
    const w = world();
    await w.Store.openLocal();
    const before = w.WalletFile.serialize(w.Store.get());
    const at = w.Store.get().assets.length;
    const found = addInstrument(w, { price: -5 });
    ok("a negative price is refused, naming where", found.length === 1 && found[0].startsWith(`assets[${at}].price:`),
      JSON.stringify(found));
    ok("the wallet is as it was before the change", w.WalletFile.serialize(w.Store.get()) === before);
    ok("the status stays and no save is due", w.Store.state().status === "saved" && !w.Store.unsaved() && !w.timers.size);
    await w.tick();
    ok("nothing reaches the file", !w.writes.length && w.file.text === EXAMPLE);
    ok("after a refusal a good change is accepted", change(w, "one").length === 0);
    await w.tick();
    ok("and is saved as usual", w.writes.length === 1 && notes(w.file.text) === "one" && !w.Store.unsaved()
      && JSON.parse(w.file.text).assets.length === at, w.writes.length);
    ok("an accepted change takes the day's snapshot", JSON.parse(w.file.text).history.some(h => h.date === w.Dates.today()));
  }
  {
    const w = world();
    await w.Store.openLocal();
    change(w, "one");
    const before = w.WalletFile.serialize(w.Store.get());
    addInstrument(w, { price: -5 });
    ok("a refusal keeps the change accepted before it", w.WalletFile.serialize(w.Store.get()) === before);
    ok("which is still unsaved, its save still due", w.Store.state().status === "dirty" && w.Store.unsaved() && w.timers.size === 1);
    await w.tick();
    ok("and is saved without the refused one", w.writes.length === 1 && w.file.text === before, w.writes.length);
  }
  {
    const w = world();
    await w.Store.openExample("en");
    const before = w.WalletFile.serialize(w.Store.get());
    ok("the example is held to the same check", addInstrument(w, { price: -5 }).length === 1
      && w.WalletFile.serialize(w.Store.get()) === before);
    const found = addInstrument(w, { currency: "GBP" });
    ok("a change only the sums cannot take is refused too", found.length === 1 && found[0].includes("GBP")
      && w.WalletFile.serialize(w.Store.get()) === before, JSON.stringify(found));
    const huge = addInstrument(w, { price: 1e308, opening_quantity: 10 });
    ok("so is one whose numbers add up to no number", huge.some(p => /^history\[\d+\]\.net_worth:/.test(p))
      && w.WalletFile.serialize(w.Store.get()) === before, JSON.stringify(huge));
    ok("which leaves nothing that stops the next change", change(w, "one").length === 0);
  }

  // ---------------------------------------------------------- a change that throws
  {
    const w = world();
    await w.Store.openLocal();
    const before = w.WalletFile.serialize(w.Store.get());
    // what throws in each step: the check, the snapshot, the writing of the text
    const cases = [
      ["the check", (d) => Object.defineProperty(d, "strategy_notes", { get() { throw null; }, enumerable: true })],
      ["the snapshot", (d) => { d.history.constructor = 7; }],
      ["the writing of the text", (d) => { d.house.extra = 1n; }],
    ];
    for(const [step, break_] of cases) {
      break_(w.Store.get());
      let found, threw = "";
      try { found = w.Store.changed(); } catch(e) { threw = String(e); }
      ok(`what ${step} throws refuses the change, with its message`, !threw && found.length === 1 && !!found[0],
        threw || JSON.stringify(found));
      ok(`after ${step} threw the wallet is as it was, nothing to save`, w.WalletFile.serialize(w.Store.get()) === before
        && w.Store.state().status === "saved" && !w.timers.size);
    }
    ok("and the next good change is accepted", change(w, "one").length === 0);
    const off = w.Store.onChange(() => { throw new Error("a listener broke"); });
    const log = console.error;
    console.error = () => {}; // what the store says about the listener
    let threw = "";
    try { change(w, "two"); await w.tick(); } catch(e) { threw = e.message; }
    finally { console.error = log; off(); }
    ok("a listener that throws takes neither the change nor its save down", !threw && notes(w.file.text) === "two", threw);
  }

  // ---------------------------------------------------------- one change of every place
  {
    const w = world();
    await w.Store.openLocal();
    // an element in every list and map the example leaves empty
    const live = w.Store.get();
    const [asset] = live.assets, [account] = live.cash;
    w.Transactions.add(live, asset.id, "buy", 1, 10);
    w.Cash.add(live, account.id, 10);
    live.mortgage.events.push(w.Mortgage.nextPaymentEvent(live.mortgage));
    w.WalletHistory.addPrice(live, asset.id, "2026-01-02", null, 10);
    live.fx_history["2026-01-02"] = { USD: 1.1 };
    w.Store.changed();
    await w.tick();
    const start = w.file.text;
    const at = places(JSON.parse(start));
    const empty = at.filter(p => { const v = p.reduce((o, k) => o[k], JSON.parse(start));
      return v && typeof v === "object" && !Object.keys(v).length; });
    ok("every list and map has an element to change", !empty.length, empty.map(p => p.join(".")).join(", "));

    const values = [["a number", () => 7], ["NaN", () => NaN], ["Infinity", () => Infinity], ["text", () => "x"],
      ["null", () => null], ["{}", () => ({})], ["[]", () => []], ["removed", null]];
    const broken = [], kept = [];
    let accepted = 0, refused = 0;
    for(const place of at) {
      for(const [name, value] of values) {
        w.file.text = start;
        await w.Store.reloadFromDisk();
        const parent = place.slice(0, -1).reduce((o, k) => o[k], w.Store.get());
        if(value) parent[place.at(-1)] = value();
        else delete parent[place.at(-1)]; // in a list this leaves a hole
        const writes = w.writes.length;
        const found = w.Store.changed();
        await w.tick();
        const what = `${place.join(".")} = ${name}`;
        if(found.length) {
          refused += 1;
          if(w.writes.length !== writes || w.WalletFile.serialize(w.Store.get()) !== start) kept.push(what);
        }
        else {
          accepted += 1;
          const why = w.writes.length === writes + 1 ? refusal(w, w.file.text) : "nothing written";
          if(why) broken.push(`${what}: ${why}`);
        }
      }
    }
    ok("several hundred changes, some accepted and some refused", accepted + refused >= 300 && accepted > 0 && refused > 0,
      `${accepted} accepted, ${refused} refused`);
    ok("what an accepted change saves opens again", !broken.length, `${broken.length}: ${broken.slice(0, 8).join("\n       ")}`);
    ok("a refused change leaves the wallet as it was", !kept.length, `${kept.length}: ${kept.slice(0, 8).join(", ")}`);
  }

  // ---------------------------------------------------------- the check itself
  {
    const w = world();
    const data = w.WalletFile.parse(EXAMPLE);
    ok("the example has nothing to refuse", w.WalletFile.check(data).length === 0);
    data.assets[0].price = -5;
    const found = w.WalletFile.check(data);
    const message = refusal(w, w.WalletFile.serialize(data));
    ok("the check names the place that opening such a file names", found.length === 1
      && found[0].startsWith("assets[0].price:") && message.includes(found[0]), `${JSON.stringify(found)} | ${message}`);
    data.assets[0].price = 1;
    data.assets[0].currency = "GBP";
    const sums = w.WalletFile.check(data);
    ok("and gives the same reason when only the sums fail", sums.length === 1
      && sums[0] === refusal(w, w.WalletFile.serialize(data)), JSON.stringify(sums));
    const many = Array.from({ length: 12 }, (_, i) => `place${i}`);
    ok("a long list of places is cut after ten", w.WalletFile.problemList(many) === `${many.slice(0, 10).join("; ")} … (+2)`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log(e); process.exit(1); });

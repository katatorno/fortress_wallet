// .tests/remember.test.cjs
//
// What the app keeps in the browser: nothing until asked, only a link to the file,
// and "remove everything" clears older versions leftovers, not other apps entries.
// The storage of the browser is stood in for.
// Run: tonka test fortress_wallet   (or: node .tests/remember.test.cjs)

const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const code = readFileSync(path.join(__dirname, "..", "scripts", "core", "remember.js"), "utf8");

function storage(start = {}) {
  const map = new Map(Object.entries(start));
  return {
    map,
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

/** Just enough of IndexedDB: databases of one key-value store, answering later. */
function database(start = {}) {
  const dbs = new Map(Object.entries(start));
  const later = (fn) => setImmediate(fn);
  return {
    dbs,
    databases: async () => [...dbs.keys()].map(name => ({ name })),
    open(name) {
      const req = {};
      later(() => {
        const isNew = !dbs.has(name);
        if(isNew) dbs.set(name, new Map());
        const data = dbs.get(name);
        req.result = {
          createObjectStore: () => {}, close: () => {},
          transaction: () => {
            const tx = { objectStore: () => ({
              get: (k) => ({ result: data.get(k) }),
              put: (v, k) => { data.set(k, v); return {}; },
            }) };
            later(() => tx.oncomplete());
            return tx;
          },
        };
        if(isNew) req.onupgradeneeded?.();
        req.onsuccess();
      });
      return req;
    },
    deleteDatabase(name) {
      const req = {};
      later(() => { dbs.delete(name); req.onsuccess(); });
      return req;
    },
  };
}

function load(local = storage(), session = storage(), idb = database()) {
  const ctx = vm.createContext({ localStorage: local, sessionStorage: session, indexedDB: idb });
  vm.runInContext(code, ctx);
  return { R: vm.runInContext("Remember", ctx), local, session, idb };
}

let pass = 0, fail = 0;
function ok(name, cond, detail = "") {
  if(cond) pass++; else fail++;
  console.log(`  ${cond ? "ok  " : "FAIL"} ${name}${cond ? "" : "\n       " + detail}`);
}
const json = JSON.stringify;

(async () => {
  // ---------------------------------------------------------- off by default
  {
    const { R, local, session, idb } = load();
    ok("asking for the file creates no database", await R.file() === null && !idb.dbs.size);
    const inv = await R.inventory();
    ok("nothing is stored, and looking creates nothing", !inv.local.length && !inv.session.length && !inv.file
      && !inv.oldDb && !local.map.size && !session.map.size && !idb.dbs.size, json(inv));
  }

  // ---------------------------------------------------------- the file
  {
    const { R, local, idb } = load();
    const handle = { name: "my-wallet.json" };
    await R.keepFile(handle);
    ok("the file's link is kept and read back", await R.file() === handle && idb.dbs.size === 1);
    ok("nothing but the link is stored", !local.map.size && idb.dbs.get("fortress-files").size === 1);
    await R.forgetFile();
    ok("forgetting removes the database", await R.file() === null && !idb.dbs.size);
  }

  // ---------------------------------------------------------- removing everything
  {
    const local = storage({ "fw.cache": "{}", "fortress:settings": "{}", "other:key": "1", "fortresses": "2" });
    const session = storage({ "fw.view": "market", "theirs": "3" });
    const idb = database({ "fortress-wallet": new Map(), "their-db": new Map() });
    const { R } = load(local, session, idb);
    await R.keepFile({ name: "a.json" });
    const inv = await R.inventory();
    ok("older versions' leftovers are listed",
      inv.oldDb && inv.local.map(e => e.key).sort().join() === "fortress:settings,fw.cache"
      && inv.session.map(e => e.key).join() === "fw.view", json(inv));
    ok("others' entries are only named", inv.others.sort().join() === "fortresses,other:key", json(inv.others));
    await R.clearAll();
    ok("remove everything removes ours", [...local.map.keys()].sort().join() === "fortresses,other:key"
      && [...session.map.keys()].join() === "theirs", json([[...local.map.keys()], [...session.map.keys()]]));
    ok("and our databases, not others'", [...idb.dbs.keys()].join() === "their-db", json([...idb.dbs.keys()]));
  }

  // ---------------------------------------------------------- blocked storage
  {
    const blocked = { get length() { throw new Error("blocked"); } };
    const { R } = load(storage(), blocked, { databases: async () => { throw new Error("blocked"); } });
    const inv = await R.inventory();
    ok("a browser that blocks storage gives an empty list", !inv.session.length && !inv.file && !inv.oldDb);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log(e); process.exit(1); });

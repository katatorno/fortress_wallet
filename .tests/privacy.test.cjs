// .tests/privacy.test.cjs
//
// The app keeps nothing in the browser: no cookies, no storage, no database, no
// service worker. The kit (scripts/ui) is a copy that stores only what it is told
// to, so the app must never hand it a store.
// Run: tonka test fortress_wallet   (or: node .tests/privacy.test.cjs)

const { readFileSync, readdirSync } = require("node:fs");
const path = require("node:path");

const APP = path.join(__dirname, "..");
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? (e.name === "ui" ? [] : walk(path.join(dir, e.name))) : [path.join(dir, e.name)]);
}
const files = [...walk(path.join(APP, "scripts")).filter(f => /\.jsx?$/.test(f)),
  path.join(APP, "app.jsx"), path.join(APP, "app.html")];

const FORBIDDEN = {
  "cookies": /document\s*\.\s*cookie|cookieStore/,
  "localStorage": /localStorage/,
  "sessionStorage": /sessionStorage/,
  "IndexedDB": /indexedDB/,
  "the cache of the browser": /\bcaches\s*\./,
  "a service worker": /serviceWorker/,
  "a store for the theme or the library": /Theme\s*\.\s*remember|createCache/,
  "requests that send cookies": /credentials\s*:\s*["']include["']|withCredentials/,
};

let pass = 0, fail = 0;
function ok(name, cond, detail = "") {
  if(cond) pass++; else fail++;
  console.log(`  ${cond ? "ok  " : "FAIL"} ${name}${cond ? "" : "\n       " + detail}`);
}

ok("the sources are found", files.length > 10);
for(const [what, pattern] of Object.entries(FORBIDDEN)) {
  const found = files.filter(f => pattern.test(readFileSync(f, "utf8"))).map(f => path.relative(APP, f));
  ok(`no use of ${what}`, !found.length, found.join(", "));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

// .tests/privacy.test.cjs
//
// No cookies and no service worker. The browser's storage is touched in one place
// only, scripts/core/remember.js, which remembers nothing but a link to the wallet
// file when asked (see remember.test.cjs), and removes what older versions left.
// The page may send requests to its own server and the exchange rate service only.
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

const KEEPER = path.join("scripts", "core", "remember.js");
const FORBIDDEN = {
  "cookies": /document\s*\.\s*cookie|cookieStore|\bCookie\s*\.\s*(set|get|remove)/,
  "the cache of the browser": /\bcaches\s*\./,
  "a service worker": /serviceWorker/,
  "requests that send cookies": /credentials\s*:\s*["']include["']|withCredentials/,
  "writing into the browser's storage": /\.setItem\s*\(/,
  "a store for the theme or the library": /Theme\s*\.\s*remember|createCache|createStore/,
  "other ways to send data": /sendBeacon|WebSocket|EventSource|XMLHttpRequest|RTCPeerConnection/,
};
// allowed in the keeper, nowhere else
const KEEPER_ONLY = {
  "localStorage": /localStorage/,
  "sessionStorage": /sessionStorage/,
  "IndexedDB": /indexedDB/,
};

let pass = 0, fail = 0;
function ok(name, cond, detail = "") {
  if(cond) pass++; else fail++;
  console.log(`  ${cond ? "ok  " : "FAIL"} ${name}${cond ? "" : "\n       " + detail}`);
}

ok("the sources are found", files.length > 10);
const using = (pattern) => files.filter(f => pattern.test(readFileSync(f, "utf8"))).map(f => path.relative(APP, f));
for(const [what, pattern] of Object.entries(FORBIDDEN)) {
  const found = using(pattern);
  ok(`no use of ${what}`, !found.length, found.join(", "));
}
for(const [what, pattern] of Object.entries(KEEPER_ONLY)) {
  const found = using(pattern).filter(f => f !== KEEPER);
  ok(`${what} only in ${KEEPER}`, !found.length, found.join(", "));
}

// every address the sources name: the exchange rate service, and two that are no
// request: a namespace, and the footer's link, followed only on a click
const ALLOWED = ["https://api.frankfurter.dev", "http://www.w3.org", "https://tonkajsx.com"];
const SERVED = ["https://unpkg.com", "https://lib.tonkajsx.com", "https://font.tonkajsx.com"]; // named by the policy
const addresses = files.flatMap(f => [...readFileSync(f, "utf8").matchAll(/(?:https?|wss?):\/\/[a-z0-9.-]+/gi)]
  .map(m => m[0]).filter(a => !ALLOWED.includes(a) && !(f.endsWith("app.html") && SERVED.includes(a)))
  .map(a => `${path.relative(APP, f)}: ${a}`));
ok("no other address in the sources", !addresses.length, addresses.join(", "));

// the policy the browser enforces
const html = readFileSync(path.join(APP, "app.html"), "utf8");
const policy = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1] || "";
const rule = Object.fromEntries(policy.split(";").map(p => p.trim().split(/\s+/)).map(([name, ...v]) => [name, v.join(" ")]));
ok("the page has a content security policy", !!policy);
ok("nothing is allowed unless named", rule["default-src"] === "'none'" && !/\*|unsafe-eval/.test(policy), policy);
ok("data may be requested from this server and the rate service only",
  rule["connect-src"] === "'self' https://api.frankfurter.dev", rule["connect-src"]);
ok("no forms and no outside pictures", rule["form-action"] === "'none'" && !/http/.test(rule["img-src"]), policy);
// a "//host" address follows the page onto plain http, which the policy refuses
ok("outside scripts come over https", !/(src|href)="\/\//.test(html));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

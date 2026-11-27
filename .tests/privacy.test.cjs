// .tests/privacy.test.cjs
//
// A lint of the sources, the app's and the UI kit's copy alike: no cookies, no
// service worker, the browser's storage touched in scripts/core/remember.js only
// (see remember.test.cjs), no HTML written from text in the app's own files, and
// no address but the ones the policy names. It reads the text, comments left out:
// a name or an address put together while the page runs is beyond it. What the
// browser enforces is the page's Content Security Policy, checked at the end.
// Run: tonka test fortress_wallet   (or: node .tests/privacy.test.cjs)

const { readFileSync, readdirSync } = require("node:fs");
const path = require("node:path");

const APP = path.join(__dirname, "..");
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const rel = (f) => path.relative(APP, f).split(path.sep).join("/");

const scripts = [...walk(path.join(APP, "scripts")).filter(f => /\.jsx?$/.test(f)), path.join(APP, "app.jsx")];
const kit = (f) => rel(f).startsWith("scripts/ui/");
const own = scripts.filter(f => !kit(f));
const styles = walk(path.join(APP, "styles")).filter(f => f.endsWith(".css"));

/** A file's text without its comments; a "//" right after a letter or a colon (an address) stays. */
function code(f) {
  return readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").map(line => line.replace(/(^|\s)\/\/.*$/, "$1")).join("\n");
}

const KEEPER = "scripts/core/remember.js";
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
// text turned into HTML: the kit paints code this way, the app never does
const AS_HTML = /\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|document\s*\.\s*write/;

let pass = 0, fail = 0;
function ok(name, cond, detail = "") {
  if(cond) pass++; else fail++;
  console.log(`  ${cond ? "ok  " : "FAIL"} ${name}${cond ? "" : "\n       " + detail}`);
}

ok("the sources are found", own.length > 10 && scripts.length > own.length && styles.length > 5);
const using = (files, pattern) => files.filter(f => pattern.test(code(f))).map(rel);
for(const [what, pattern] of Object.entries(FORBIDDEN)) {
  const found = using(scripts, pattern);
  ok(`no use of ${what}`, !found.length, found.join(", "));
}
for(const [what, pattern] of Object.entries(KEEPER_ONLY)) {
  const found = using(scripts, pattern).filter(f => f !== KEEPER);
  ok(`${what} only in ${KEEPER}`, !found.length, found.join(", "));
}
ok("the app writes no HTML from text", !using(own, AS_HTML).length, using(own, AS_HTML).join(", "));

// every address the sources name: the exchange rate service, and two that are no
// request: a namespace, and the footer's link, followed only on a click
const ALLOWED = ["https://api.frankfurter.dev", "http://www.w3.org", "https://tonkajsx.com"];
const SERVED = ["https://unpkg.com", "https://lib.tonkajsx.com", "https://font.tonkajsx.com"]; // named by the policy
const FONTS = ["https://font.tonkajsx.com"];
const ADDRESS = /(?:https?|wss?):\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi;
const addresses = (files, allowed) => files.flatMap(f => [...code(f).matchAll(ADDRESS)]
  .map(m => m[0]).filter(a => !allowed.includes(a)).map(a => `${rel(f)}: ${a}`));
ok("no other address in the scripts", !addresses(scripts, ALLOWED).length, addresses(scripts, ALLOWED).join(", "));
ok("no address in the styles but the font server", !addresses(styles, FONTS).length, addresses(styles, FONTS).join(", "));

// the policy the browser enforces
const html = readFileSync(path.join(APP, "app.html"), "utf8");
const policy = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1] || "";
const rule = Object.fromEntries(policy.split(";").map(p => p.trim().split(/\s+/)).map(([name, ...v]) => [name, v]));
const hosts = (name) => (rule[name] || []).filter(v => !v.startsWith("'") && !/^(data|blob):$/.test(v));
ok("the page has a content security policy", !!policy);
ok("nothing is allowed unless named", rule["default-src"]?.join(" ") === "'none'" && !/\*|unsafe-eval/.test(policy), policy);
ok("data may be requested from this server and the rate service only",
  rule["connect-src"]?.join(" ") === "'self' https://api.frankfurter.dev", rule["connect-src"]?.join(" "));
ok("scripts come from this page and the named servers only",
  hosts("script-src").every(h => SERVED.includes(h)) && !(rule["script-src"] || []).some(v => /^(data|blob|http):/.test(v)),
  rule["script-src"]?.join(" "));
ok("fonts come from this page and the font server only", hosts("font-src").every(h => FONTS.includes(h)), rule["font-src"]?.join(" "));
ok("no forms, no base address and no outside pictures", rule["form-action"]?.join(" ") === "'none'"
  && rule["base-uri"]?.join(" ") === "'none'" && !hosts("img-src").length, policy);
// a "//host" address follows the page onto plain http, which the policy refuses
ok("outside scripts come over https", !/(src|href)="\/\//.test(html) && !/(src|href)="http:/.test(html));
const outside = [...html.matchAll(/<script\b[^>]*\bsrc="(https:[^"]+)"/g)].map(m => m[1]);
ok("outside scripts are named by the policy", outside.every(u => SERVED.includes(new URL(u).origin)), outside.join(", "));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

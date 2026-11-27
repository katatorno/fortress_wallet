// .tests/links.test.cjs
//
// Links in text from the wallet file (scripts/core/links.js): web, mail and this
// page's own addresses stay; anything else, `javascript:` first, loses its address.
// Run: tonka test fortress_wallet   (or: node .tests/links.test.cjs)

const { loadScripts } = require("../tools/wallet.cjs");
const Links = loadScripts(["links.js"]).run("Links");

let pass = 0, fail = 0;
function ok(name, cond, detail = "") {
  if(cond) pass++; else fail++;
  console.log(`  ${cond ? "ok  " : "FAIL"} ${name}${cond ? "" : "\n       " + detail}`);
}

const kept = ["https://example.com/a?b=c", "http://example.com", "mailto:me@example.com", "notes.md", "#top",
  "/data/x.json", "//example.com/x", "java%73cript:alert(1)"];
const refused = ["javascript:alert(1)", "JavaScript:location='//x'", " javascript:x", "java\tscript:x", "java\nscript:x",
  "\u0001javascript:x", "data:text/html,<b>x</b>", "vbscript:x", "blob:https://example.com/x", "file:///c:/x"];
const wrong = (list, want) => list.filter(h => Links.isSafe(h) !== want).map(h => JSON.stringify(h));
ok("web, mail and this page's addresses are kept", !wrong(kept, true).length, wrong(kept, true).join(", "));
ok("any other scheme is refused, however written", !wrong(refused, false).length, wrong(refused, false).join(", "));
ok("nothing at all is no harm", Links.isSafe("") && Links.isSafe(null));

// defuse on a stand-in for a rendered note: links as the DOM gives them
const link = (href) => {
  const a = { href, getAttribute: () => a.href, removeAttribute: () => { a.href = null; } };
  return a;
};
const links = [link("https://example.com"), link("javascript:alert(1)")];
Links.defuse({ querySelectorAll: () => links });
ok("a rendered note keeps its web link and loses the script", links[0].href === "https://example.com" && links[1].href === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

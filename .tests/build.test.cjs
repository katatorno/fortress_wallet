// .tests/build.test.cjs
//
// The built page (`tonka build fortress_wallet -i -f`), when there is one: it keeps
// the content security policy and fetches no code, style or font from elsewhere.
// Without a built index.html there is nothing to check and the suite passes;
// build first to check it. What only a browser shows is in README → Manual checks.
// Run: tonka test fortress_wallet   (or: node .tests/build.test.cjs)

const { readFileSync, existsSync } = require("node:fs");
const path = require("node:path");

const FILE = path.join(__dirname, "..", "index.html");
let pass = 0, fail = 0;
function ok(name, cond, detail = "") {
  if(cond) pass++; else fail++;
  console.log(`  ${cond ? "ok  " : "FAIL"} ${name}${cond ? "" : "\n       " + detail}`);
}

if(!existsSync(FILE)) console.log("  (skipped) no built index.html: run `tonka build fortress_wallet -i -f` to check it");
else {
  const html = readFileSync(FILE, "utf8");
  const policy = html.match(/http-equiv=["']?Content-Security-Policy["']?\s+content=["']([^"']+)["']/i)?.[1] || "";
  const rule = Object.fromEntries(policy.split(";").map(p => p.trim().split(/\s+/)).map(([name, ...v]) => [name, v.join(" ")]));
  ok("the built page keeps the policy", rule["default-src"] === "'none'"
    && rule["connect-src"] === "'self' https://api.frankfurter.dev" && rule["base-uri"] === "'none'", policy);
  const outside = [
    ...[...html.matchAll(/<script\b[^>]*\bsrc=["']?([^"'\s>]+)/gi)].map(m => m[1]),
    ...[...html.matchAll(/<link\b[^>]*\bhref=["']?([^"'\s>]+)/gi)].map(m => m[1]).filter(h => !/\.svg$/.test(h)),
    ...[...html.matchAll(/url\(\s*["']?((?:https?:)?\/\/[^"')]+)/gi)].map(m => m[1]),
  ].filter(u => /^(https?:)?\/\//i.test(u));
  ok("no code, style or font is fetched from elsewhere", !outside.length, outside.join(", "));
  ok("JSX is compiled: no Babel in the page", !/babel/i.test(html.match(/<head[\s\S]*?<\/head>/i)?.[0] || "")
    && !/type=["']?text\/babel/i.test(html));
  const spare = (rule["script-src"] || "").split(" ").filter(v => /^https:/.test(v));
  if(spare.length) console.log(`  (info) the built policy still allows scripts from ${spare.join(", ")}: send the header from README → Security`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

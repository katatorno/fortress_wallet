// .tests/tools.test.cjs
//
// The tools in tools/: the .xlsx reader on a small export made here (and on broken
// and oversized ones), the copy kept before a wallet is written, the names git
// keeps out, the price cache's file names and the currencies of the markets.
// Run: tonka test fortress_wallet   (or: node .tests/tools.test.cjs)

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { spawnSync } = require("node:child_process");
const { APP, WalletFile, save, backupName } = require("../tools/wallet.cjs");
const { readXlsx, unzip } = require("../tools/xlsx.cjs");
const { cachePath } = require("../tools/fetch-prices.cjs");
const { currencyOf } = require("../tools/import-xtb.cjs");

let pass = 0, fail = 0;
function ok(name, cond, detail = "") {
  if(cond) pass++; else fail++;
  console.log(`  ${cond ? "ok  " : "FAIL"} ${name}${cond ? "" : "\n       " + detail}`);
}
const throws = (fn, pattern) => { try { fn(); return false; } catch(e) { return pattern.test(e.message); } };

/** A zip of the given files, each deflated; `claim` overrides the unpacked size the directory states. */
function zip(entries, claim = {}) {
  const parts = [], central = [];
  let offset = 0;
  for(const [name, content] of Object.entries(entries)) {
    const data = Buffer.from(content), packed = zlib.deflateRawSync(data), n = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26);
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0); head.writeUInt16LE(8, 10); head.writeUInt32LE(packed.length, 20);
    head.writeUInt32LE(claim[name] ?? data.length, 24); head.writeUInt16LE(n.length, 28); head.writeUInt32LE(offset, 42);
    parts.push(local, n, packed);
    central.push(head, n);
    offset += 30 + n.length + packed.length;
  }
  const dir = Buffer.concat(central), end = Buffer.alloc(22), count = Object.keys(entries).length;
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10);
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, dir, end]);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fortress-tools-"));
const put = (name, content) => { const f = path.join(tmp, name); fs.writeFileSync(f, content); return f; };

try {
  // -------------------------------------------------------------- the .xlsx reader
  const BOOK = {
    "xl/workbook.xml": '<workbook><sheets><sheet name="Cash Operations" sheetId="1" r:id="rId1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    "xl/sharedStrings.xml": "<sst><si><t>Deposit</t></si></sst>",
    "xl/worksheets/sheet1.xml": '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>12.5</v></c>'
      + '<c r="C1" t="inlineStr"><is><t>a &amp; b</t></is></c></row></sheetData></worksheet>',
  };
  const rows = readXlsx(put("export.xlsx", zip(BOOK)))["Cash Operations"];
  ok("a sheet is read: shared text, numbers, text in the cell", rows?.[0]?.A === "Deposit" && rows[0].B === "12.5" && rows[0].C === "a & b",
    JSON.stringify(rows));

  const big = Buffer.alloc(2 * 1024 * 1024);
  const small = { entries: 10, bytes: 1024 * 1024 };
  ok("a part within the limit unpacks", unzip(zip({ "x": big }))["x"]().length === big.length);
  ok("a part that says it unpacks too big is refused", throws(() => unzip(zip({ "x": big }), small)["x"](), /unpacks to/));
  ok("one that lies about its size is stopped all the same",
    throws(() => unzip(zip({ "x": big }, { x: 10 }), small)["x"](), /./));
  ok("too many parts are refused", throws(() => unzip(zip(Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`f${i}`, "x"]))), small),
    /11 entries/));
  const whole = zip(BOOK);
  ok("a cut file is refused, not read past its end", throws(() => readXlsx(put("cut.xlsx", whole.subarray(0, whole.length - 30))), /zip/));
  ok("parts not asked for are not unpacked", (() => {
    const files = unzip(zip({ ...BOOK, "bomb": big }, { bomb: 10 }), small);
    return typeof files.bomb === "function" && !!files["xl/workbook.xml"]();
  })());
  ok("an export without a workbook is named as such", throws(() => readXlsx(put("empty.xlsx", zip({ "a.txt": "x" }))), /workbook/));

  // -------------------------------------------------------------- the copy before a write
  const example = fs.readFileSync(path.join(APP, "data", "wallet.example.json"), "utf8");
  const wallet = put("my.json", example);
  const data = WalletFile.parse(example);
  data.strategy_notes = "changed";
  const backup = save(wallet, data);
  ok("the copy holds the file as it was", fs.readFileSync(backup, "utf8") === example);
  ok("the file holds the new version", JSON.parse(fs.readFileSync(wallet, "utf8")).strategy_notes === "changed");
  ok("no unfinished write is left behind", !fs.readdirSync(tmp).some(f => f.includes(".tmp-")));
  ok("a copy keeps the extension and its own name", /my\.backup-\d{8}T\d{6}\.json$/.test(backup));
  const plain = put("wallet", example);
  const plainCopy = save(plain, data);
  ok("a file without an extension gets a real copy", plainCopy !== plain && fs.readFileSync(plainCopy, "utf8") === example);
  ok("a copy's name never is the file's", backupName("a/b.json") !== "a/b.json" && backupName("a/b") !== "a/b");

  // -------------------------------------------------------------- what git keeps out
  const ignored = (p) => spawnSync("git", ["check-ignore", "-q", "--no-index", p], { cwd: APP }).status === 0;
  if(spawnSync("git", ["--version"]).status !== 0) console.log("  (skipped) git is not here: what it ignores is not checked");
  else {
    const kept = ["wallet.json", "my.wallet.json", "data/anything.json",
      path.basename(backupName("wallet.json")), path.basename(backupName("my.wallet.json")), path.basename(backupName("notes")),
      "wallet.json.tmp-123"].filter(p => !ignored(p));
    ok("wallet files and their copies stay out of git", !kept.length, kept.join(", "));
    ok("the example and the tools do not", !ignored("data/wallet.example.json") && !ignored("tools/wallet.cjs"));
  }

  // -------------------------------------------------------------- the price cache
  const dir = path.join(tmp, "cache");
  const name = cachePath({ function: "TIME_SERIES_WEEKLY", symbol: "../../../x/notes" }, "2026-11-27", dir);
  ok("a symbol never leads out of the cache", path.dirname(name) === dir, name);
  ok("a plain symbol keeps its name", path.basename(cachePath({ function: "F", symbol: "WEBN.DEX" }, "2026-11-27", dir))
    === "2026-11-27_F_WEBN.DEX.json");

  // -------------------------------------------------------------- markets
  ok("a market's currency comes from the ticker", currencyOf("NKE.US") === "USD" && currencyOf("WEBN.DE") === "EUR"
    && currencyOf("CDR.PL") === "PLN");
  ok("an unknown market is refused, not taken for euros", throws(() => currencyOf("VOD.UK"), /\.UK/));
}
finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

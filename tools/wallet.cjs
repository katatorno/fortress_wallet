// tools/wallet.cjs
//
// Shared by the data tools and the tests: the app's own scripts loaded into Node,
// and reading and writing a wallet file with a copy of the previous version kept
// beside it.

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const APP = path.join(__dirname, "..");
const CORE = path.join(APP, "scripts", "core");

/**
 * The scripts of scripts/core the wallet logic is made of, in the order the page loads
 * them: those of scripts/core/wallet sorted by name, then those beside that folder
 * which need no browser.
 */
const CORE_FILES = [...fs.readdirSync(path.join(CORE, "wallet")).filter(f => f.endsWith(".js")).sort()
  .map(f => `wallet/${f}`), "base.js", "chart-math.js", "dates.js", "i18n.js"];

/** The global a script of scripts/core makes, named after its file: wallet-file.js → WalletFile. */
const moduleName = (file) => {
  const name = path.basename(file, ".js");
  return name === "i18n" ? "I18N" : name.replace(/(^|-)([a-z])/g, (m, dash, letter) => letter.toUpperCase());
};

/**
 * Runs scripts of scripts/core in one fresh context, as the page does: plain
 * scripts sharing one global scope. `globals` stand in for what the browser gives.
 * @param {string[]} files  names inside scripts/core
 * @param {object} [globals]
 * @returns {{ctx: object, run: (code:string) => any}}
 */
function loadScripts(files, globals = {}) {
  const ctx = vm.createContext({ console, URL, URLSearchParams, ...globals });
  for(const f of files) vm.runInContext(fs.readFileSync(path.join(CORE, f), "utf8"), ctx, { filename: f });
  return { ctx, run: (code) => vm.runInContext(code, ctx) };
}

/**
 * The wallet logic with the app's texts, plus any further scripts of scripts/core.
 * @param {string[]} [more]  further scripts, loaded after the core ones
 * @param {object} [globals]
 * @returns {{ctx: object, run: (code:string) => any}} and every module of CORE_FILES, by its name
 */
function loadCore(more = [], globals = {}) {
  const loaded = loadScripts([...CORE_FILES, ...more], globals);
  const modules = Object.fromEntries(CORE_FILES.map(moduleName).map(name => [name, loaded.run(name)]));
  const { I18N } = modules;
  I18N.use(I18N.parseToml(fs.readFileSync(path.join(APP, "locales", "translations.toml"), "utf8")));
  return { ...loaded, ...modules };
}

const { ctx, run, ...modules } = loadCore(); // the tools' and the tests' own copy
const { WalletFile } = modules;

const open = (file) => WalletFile.parse(fs.readFileSync(file, "utf8"));

/** The name of a copy of `file` made now: "<name>.backup-<time><extension>", never the file itself. */
function backupName(file, now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, "").slice(0, 15);
  const ext = path.extname(file);
  const base = ext ? file.slice(0, -ext.length) : file;
  return `${base}.backup-${stamp}${ext}`;
}

/**
 * Writes the wallet: first a copy of the file as it is, then the new text into a
 * temporary file that takes the file's place, so a broken write never leaves
 * half a file behind.
 * @returns {string} where the copy is
 */
function save(file, data) {
  const backup = backupName(file);
  if(path.resolve(backup) === path.resolve(file)) throw new Error(`No name for a copy of ${file}`);
  fs.copyFileSync(file, backup);
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, WalletFile.serialize(data));
  fs.renameSync(temp, file);
  return backup;
}

module.exports = { APP, CORE_FILES, moduleName, loadScripts, loadCore, ...modules, open, save, backupName };

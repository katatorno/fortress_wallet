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

/** The scripts of scripts/core the wallet logic needs, in the order the page loads them. */
const CORE_FILES = ["i18n.js", "core.js"];

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
 */
function loadCore(more = [], globals = {}) {
  const loaded = loadScripts([...CORE_FILES, ...more], globals);
  const I18N = loaded.run("I18N");
  I18N.use(I18N.parseToml(fs.readFileSync(path.join(APP, "locales", "translations.toml"), "utf8")));
  return { ...loaded, Core: loaded.run("Core"), I18N };
}

const { Core } = loadCore();

const open = (file) => Core.parse(fs.readFileSync(file, "utf8"));

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
  fs.writeFileSync(temp, Core.serialize(data));
  fs.renameSync(temp, file);
  return backup;
}

module.exports = { APP, CORE_FILES, loadScripts, loadCore, Core, open, save, backupName };

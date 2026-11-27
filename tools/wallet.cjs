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

/** Writes the wallet, first copying the file to "<name>.backup-<time>.json". */
function save(file, data) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
  const backup = file.replace(/[.]json$/, `.backup-${stamp}.json`);
  fs.copyFileSync(file, backup);
  fs.writeFileSync(file, Core.serialize(data));
  return backup;
}

module.exports = { APP, CORE_FILES, loadScripts, loadCore, Core, open, save };

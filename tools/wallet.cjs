// tools/wallet.cjs
//
// Shared by the data tools: the app's own logic loaded into Node, and reading and
// writing a wallet file with a copy of the previous version kept beside it.

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const APP = path.join(__dirname, "..");

function loadCore() {
  const ctx = vm.createContext({ console });
  for(const f of ["i18n.js", "core.js"]) {
    vm.runInContext(fs.readFileSync(path.join(APP, "scripts", "core", f), "utf8"), ctx, { filename: f });
  }
  const [Core, I18N] = vm.runInContext("[Core, I18N]", ctx);
  I18N.use(I18N.parseToml(fs.readFileSync(path.join(APP, "locales", "translations.toml"), "utf8")));
  return Core;
}

const Core = loadCore();

const open = (file) => Core.parse(fs.readFileSync(file, "utf8"));

/** Writes the wallet, first copying the file to "<name>.backup-<time>.json". */
function save(file, data) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
  const backup = file.replace(/[.]json$/, `.backup-${stamp}.json`);
  fs.copyFileSync(file, backup);
  fs.writeFileSync(file, Core.serialize(data));
  return backup;
}

module.exports = { Core, open, save };

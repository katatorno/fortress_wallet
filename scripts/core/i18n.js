// scripts/core/i18n.js
//
// Translations and number formats. Every text the app shows lives in
// `locales/translations.toml`, one [key] per text with a line per language:
//
//   [tab_dashboard]
//   en = "Dashboard"
//   pl = "Pulpit"
//
// Placeholders are `{name}`. A missing translation falls back to English,
// a missing key to the key itself. Plain script: no modules, one global `I18N`.

const I18N = (() => {
  const DEFAULT = "en";
  const META = "_languages";
  let strings = {};

  // ---------------------------------------------------------------- TOML subset

  /**
   * Parses the flat TOML of the translations file: `[section]` headers and
   * `key = "basic string"` / `key = 'literal string'` lines, `#` comments.
   * @param {string} text
   * @returns {Object<string, Object<string,string>>}
   */
  function parseToml(text) {
    const out = {};
    let section = null;
    const lines = String(text).replace(/\r\n?/g, "\n").split("\n");
    lines.forEach((raw, at) => {
      const line = raw.trim();
      if(!line || line.startsWith("#")) return;
      const head = line.match(/^\[\s*([A-Za-z0-9_.-]+)\s*\]\s*(#.*)?$/);
      if(head) {
        section = out[head[1]] = out[head[1]] || {};
        return;
      }
      const kv = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
      if(!kv || !section) throw new Error(`translations.toml line ${at + 1}: cannot read "${raw}"`);
      section[kv[1]] = _string(kv[2], at + 1);
    });
    return out;
  }

  function _string(src, lineNo) {
    const quote = src[0];
    if(quote === "'") {
      const end = src.indexOf("'", 1);
      if(end < 0) throw new Error(`translations.toml line ${lineNo}: unclosed string`);
      return src.slice(1, end);
    }
    if(quote !== '"') throw new Error(`translations.toml line ${lineNo}: a value must be quoted`);
    let out = "";
    for(let i = 1; i < src.length; i++) {
      const c = src[i];
      if(c === '"') return out;
      if(c !== "\\") { out += c; continue; }
      const n = src[++i];
      const simple = { n: "\n", t: "\t", r: "\r", '"': '"', "\\": "\\", b: "\b", f: "\f" };
      if(n in simple) out += simple[n];
      else if(n === "u" || n === "U") {
        const len = n === "u" ? 4 : 8;
        out += String.fromCodePoint(parseInt(src.slice(i + 1, i + 1 + len), 16));
        i += len;
      }
      else throw new Error(`translations.toml line ${lineNo}: unknown escape \\${n}`);
    }
    throw new Error(`translations.toml line ${lineNo}: unclosed string`);
  }

  // ---------------------------------------------------------------- texts

  /** Loads the translations from a URL (served next to index.html). */
  async function load(url = "locales/translations.toml") {
    const res = await fetch(url, { cache: "no-cache" });
    if(!res.ok) throw new Error(`Cannot load ${url}: HTTP ${res.status}`);
    strings = parseToml(await res.text());
    return strings;
  }

  /** Uses already parsed strings (tests, or an embedded copy). */
  const use = (parsed) => { strings = parsed; };

  const languages = () => strings[META] || { [DEFAULT]: "English" };

  /**
   * @param {string} lang
   * @param {string} key
   * @param {Object} [vars] values for `{placeholders}`
   */
  function t(lang, key, vars) {
    const entry = strings[key];
    let text = entry ? (entry[lang] || entry[DEFAULT] || key) : key;
    if(vars) text = text.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
    return text;
  }

  /** Placeholder names of a text, for checks. */
  const placeholders = (text) => new Set([...String(text).matchAll(/\{(\w+)\}/g)].map(m => m[1]));

  // ---------------------------------------------------------------- numbers

  // thousands separator and decimal mark per language
  const STYLE = { en: [",", "."], pl: [" ", ","], pt: [" ", ","] };
  const _style = (lang) => STYLE[lang] || STYLE[DEFAULT];

  /** A number as written in the language; nothing given is 0, a value that is no number "–". */
  function number(lang, x, dec = 0) {
    const [th, dp] = _style(lang);
    const v = x === null || x === undefined || x === "" ? 0 : Number(x);
    if(!Number.isFinite(v)) return "–";
    const fixed = Math.abs(v).toFixed(dec);
    let [int, frac] = fixed.split(".");
    int = int.replace(/\B(?=(\d{3})+(?!\d))/g, th);
    const sign = v < 0 && Number(fixed) !== 0 ? "-" : "";
    return sign + int + (frac ? dp + frac : "");
  }

  function money(lang, x, dec = 0) {
    const v = x === null || x === undefined || x === "" ? 0 : Number(x);
    if(!Number.isFinite(v)) return "–";
    const n = number(lang, Math.abs(v), dec);
    const sign = v < 0 && Number(Math.abs(v).toFixed(dec)) !== 0 ? "-" : "";
    return lang === "en" ? `${sign}€${n}` : `${sign}${n} €`;
  }

  const percent = (lang, x, dec = 1) => number(lang, x, dec) + "%";

  return { DEFAULT, META, parseToml, load, use, languages, t, placeholders, number, money, percent };
})();

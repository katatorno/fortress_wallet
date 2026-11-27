// tools/xlsx.cjs
//
// Just enough of .xlsx for a broker's export: the zip is read with Node's zlib,
// each sheet becomes rows of { column letter: text }. No dependencies.

const fs = require("node:fs");
const zlib = require("node:zlib");

/** The files of a zip archive, by name. */
function unzip(buffer) {
  let end = buffer.length - 22;
  while(end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end--;
  if(end < 0) throw new Error("Not a zip file");
  const files = {};
  let at = buffer.readUInt32LE(end + 16);
  for(let i = 0; i < buffer.readUInt16LE(end + 10); i++) {
    const method = buffer.readUInt16LE(at + 10), size = buffer.readUInt32LE(at + 20);
    const nameLen = buffer.readUInt16LE(at + 28), extra = buffer.readUInt16LE(at + 30), comment = buffer.readUInt16LE(at + 32);
    const local = buffer.readUInt32LE(at + 42);
    const name = buffer.toString("utf8", at + 46, at + 46 + nameLen);
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const raw = buffer.subarray(start, start + size);
    files[name] = (method === 8 ? zlib.inflateRawSync(raw) : raw).toString("utf8");
    at += 46 + nameLen + extra + comment;
  }
  return files;
}

const decode = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const textOf = (xml) => decode([...xml.matchAll(/<t(?: [^>]*)?>([^<]*)<\/t>/g)].map(m => m[1]).join(""));

/** @returns {Object<string, Array<Object<string,string>>>} sheet name → rows */
function readXlsx(file) {
  const files = unzip(fs.readFileSync(file));
  const shared = [...(files["xl/sharedStrings.xml"] || "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => textOf(m[1]));
  const targets = Object.fromEntries([...files["xl/_rels/workbook.xml.rels"].matchAll(/<Relationship [^>]*>/g)]
    .map(m => [m[0].match(/ Id="([^"]*)"/)[1], m[0].match(/ Target="([^"]*)"/)[1]]));
  const sheets = {};
  for(const m of files["xl/workbook.xml"].matchAll(/<sheet [^>]*>/g)) {
    const name = decode(m[0].match(/ name="([^"]*)"/)[1]);
    const target = targets[m[0].match(/ r:id="([^"]*)"/)[1]].replace(/^\/?(xl\/)?/, "xl/");
    sheets[name] = [...files[target].matchAll(/<row [^>]*>([\s\S]*?)<\/row>/g)].map(r => {
      const row = {};
      for(const c of r[1].matchAll(/<c r="([A-Z]+)[0-9]+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const [, column, attributes, body = ""] = c;
        const value = (body.match(/<v>([^<]*)<\/v>/) || [])[1];
        row[column] = / t="s"/.test(attributes) ? shared[Number(value)] : value === undefined ? textOf(body) : decode(value);
      }
      return row;
    });
  }
  return sheets;
}

module.exports = { readXlsx };

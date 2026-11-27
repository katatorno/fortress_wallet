// tools/xlsx.cjs
//
// Just enough of .xlsx for a broker's export: the zip is read with Node's zlib,
// each sheet becomes rows of { column letter: text }. No dependencies.
//
// The file comes from outside, so the zip is read with care: every offset is
// checked against the file, only the parts a sheet needs are unpacked, and none
// may unpack to more than a limit (a small zip can claim gigabytes).

const fs = require("node:fs");
const zlib = require("node:zlib");

const LIMITS = { entries: 10000, bytes: 64 * 1024 * 1024 };

/**
 * The files of a zip archive by name, each unpacked only when it is asked for.
 * @returns {Object<string, () => string>}
 */
function unzip(buffer, limits = LIMITS) {
  const broken = (why) => { throw new Error(`Not a readable zip file: ${why}`); };
  const u16 = (at) => (at >= 0 && at + 2 <= buffer.length ? buffer.readUInt16LE(at) : broken(`offset ${at}`));
  const u32 = (at) => (at >= 0 && at + 4 <= buffer.length ? buffer.readUInt32LE(at) : broken(`offset ${at}`));
  let end = buffer.length - 22;
  while(end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end--;
  if(end < 0) broken("no end of the central directory");
  const count = u16(end + 10);
  if(count > limits.entries) broken(`${count} entries`);
  const files = Object.create(null);
  let at = u32(end + 16);
  for(let i = 0; i < count; i++) {
    if(u32(at) !== 0x02014b50) broken(`entry ${i}`);
    const method = u16(at + 10), size = u32(at + 20), full = u32(at + 24);
    const nameLen = u16(at + 28), extra = u16(at + 30), comment = u16(at + 32);
    const local = u32(at + 42);
    const name = buffer.toString("utf8", at + 46, at + 46 + nameLen);
    if(u32(local) !== 0x04034b50) broken(`local header of ${name}`);
    const start = local + 30 + u16(local + 26) + u16(local + 28);
    if(start + size > buffer.length) broken(`${name} runs past the end`);
    if(method !== 0 && method !== 8) broken(`${name} is packed in a way this reader does not know`);
    files[name] = () => {
      if(full > limits.bytes) broken(`${name} unpacks to ${full} bytes`);
      const raw = buffer.subarray(start, start + size);
      return (method === 8 ? zlib.inflateRawSync(raw, { maxOutputLength: limits.bytes }) : raw).toString("utf8");
    };
    at += 46 + nameLen + extra + comment;
  }
  return files;
}

const decode = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const textOf = (xml) => decode([...xml.matchAll(/<t(?: [^>]*)?>([^<]*)<\/t>/g)].map(m => m[1]).join(""));

/** @returns {Object<string, Array<Object<string,string>>>} sheet name → rows */
function readXlsx(file, limits = LIMITS) {
  const files = unzip(fs.readFileSync(file), limits);
  const part = (name) => {
    if(!files[name]) throw new Error(`Not an .xlsx export: ${name} is missing`);
    return files[name]();
  };
  const shared = files["xl/sharedStrings.xml"]
    ? [...part("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => textOf(m[1])) : [];
  const targets = Object.fromEntries([...part("xl/_rels/workbook.xml.rels").matchAll(/<Relationship [^>]*>/g)]
    .map(m => [m[0].match(/ Id="([^"]*)"/)?.[1], m[0].match(/ Target="([^"]*)"/)?.[1]]));
  const sheets = Object.create(null);
  for(const m of part("xl/workbook.xml").matchAll(/<sheet [^>]*>/g)) {
    const name = decode(m[0].match(/ name="([^"]*)"/)?.[1] ?? "");
    const target = String(targets[m[0].match(/ r:id="([^"]*)"/)?.[1]] ?? "").replace(/^\/?(xl\/)?/, "xl/");
    sheets[name] = [...part(target).matchAll(/<row [^>]*>([\s\S]*?)<\/row>/g)].map(r => {
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

module.exports = { readXlsx, unzip, LIMITS };

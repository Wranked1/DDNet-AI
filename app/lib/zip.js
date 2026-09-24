"use strict";

const fs = require("node:fs");
const zlib = require("node:zlib");
const { promisify } = require("node:util");

const deflateRaw = promisify(zlib.deflateRaw);
const LIMIT = 0xffffffff;

function crc32(buf) {
  if (typeof zlib.crc32 === "function") return zlib.crc32(buf) >>> 0;

  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

function dosDateTime(d) {
  const year = Math.max(1980, d.getFullYear());
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

function safeEntryName(name) {
  const n = String(name).replace(/\\/g, "/").replace(/^\/+/, "");
  if (n === "" || n.split("/").some((p) => p === ".." || p === ".")) throw new Error(`плохое имя в архиве: ${name}`);
  return n;
}

async function writeZip(outPath, entries, onProgress) {
  const fh = await fs.promises.open(outPath, "w");
  const central = [];
  let offset = 0;
  const write = async (buf) => {
    await fh.write(buf, 0, buf.length, null);
    offset += buf.length;
  };
  const skipped = [];
  try {
    let done = 0;
    for (const e of entries) {
      const name = safeEntryName(e.name);
      const nameBuf = Buffer.from(name, "utf8");
      let data;
      let mtime = e.mtime instanceof Date ? e.mtime : new Date();
      if (e.file !== undefined) {
        try {
          data = await fs.promises.readFile(e.file);
          if (!(e.mtime instanceof Date)) mtime = (await fs.promises.stat(e.file)).mtime;
        } catch (err) {
          if (e.optional !== true || !err || err.code !== "ENOENT") throw err;
          skipped.push(name);
          done++;
          if (typeof onProgress === "function") onProgress(done, entries.length);
          continue;
        }
      } else {
        data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(String(e.data ?? ""), "utf8");
      }
      if (data.length >= LIMIT) throw new Error(`файл больше 4 ГБ: ${name}`);
      const crc = crc32(data);
      let method = 8;
      let body = await deflateRaw(data, { level: 6 });
      if (body.length >= data.length) {
        method = 0;
        body = data;
      }
      if (offset + body.length + 30 + nameBuf.length >= LIMIT) throw new Error("архив больше 4 ГБ");
      const { time, date } = dosDateTime(mtime);
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(0x0800, 6);
      local.writeUInt16LE(method, 8);
      local.writeUInt16LE(time, 10);
      local.writeUInt16LE(date, 12);
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(body.length, 18);
      local.writeUInt32LE(data.length, 22);
      local.writeUInt16LE(nameBuf.length, 26);
      local.writeUInt16LE(0, 28);
      const at = offset;
      await write(local);
      await write(nameBuf);
      await write(body);
      central.push({ nameBuf, method, time, date, crc, csize: body.length, usize: data.length, at });
      done++;
      if (typeof onProgress === "function") onProgress(done, entries.length);
    }
    const cdStart = offset;
    for (const c of central) {
      const h = Buffer.alloc(46);
      h.writeUInt32LE(0x02014b50, 0);
      h.writeUInt16LE(20, 4);
      h.writeUInt16LE(20, 6);
      h.writeUInt16LE(0x0800, 8);
      h.writeUInt16LE(c.method, 10);
      h.writeUInt16LE(c.time, 12);
      h.writeUInt16LE(c.date, 14);
      h.writeUInt32LE(c.crc, 16);
      h.writeUInt32LE(c.csize, 20);
      h.writeUInt32LE(c.usize, 24);
      h.writeUInt16LE(c.nameBuf.length, 28);
      h.writeUInt32LE(c.at, 42);
      await write(h);
      await write(c.nameBuf);
    }
    if (central.length > 0xffff) throw new Error("слишком много файлов для zip без ZIP64");
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(central.length, 8);
    end.writeUInt16LE(central.length, 10);
    end.writeUInt32LE(offset - cdStart, 12);
    end.writeUInt32LE(cdStart, 16);
    await write(end);
  } catch (err) {
    await fh.close();
    await fs.promises.rm(outPath, { force: true });
    throw err;
  }
  await fh.close();
  return { files: central.length, bytes: offset, skipped };
}

function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("не zip: нет конца каталога");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || p === LIMIT) throw new Error("ZIP64 не поддерживается");
  const out = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("битый центральный каталог");
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const xlen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const at = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString("utf8");
    p += 46 + nlen + xlen + clen;
    if (buf.readUInt32LE(at) !== 0x04034b50) throw new Error(`битый заголовок: ${name}`);
    const start = at + 30 + buf.readUInt16LE(at + 26) + buf.readUInt16LE(at + 28);
    out.push({
      name,
      isDir: name.endsWith("/"),
      size: usize,
      data() {
        const raw = buf.subarray(start, start + csize);
        const data = method === 0 ? Buffer.from(raw) : method === 8 ? zlib.inflateRawSync(raw) : null;
        if (data === null) throw new Error(`метод сжатия ${method} не поддерживается: ${name}`);
        if (data.length !== usize || crc32(data) !== crc) throw new Error(`контрольная сумма не сошлась: ${name}`);
        return data;
      },
    });
  }
  return out;
}

module.exports = { writeZip, readZip, crc32, safeEntryName };

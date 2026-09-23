import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const APP = path.join(HERE, "app");
const require = createRequire(import.meta.url);
const { readZip, writeZip } = require("../app/lib/zip.js");

const argv = process.argv.slice(2);
const flags = {};
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith("--")) continue;
  const key = argv[i].slice(2);
  flags[key] = argv[i + 1] !== undefined && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
}

function die(msg) {
  console.error(`packageApp: ${msg}`);
  process.exit(1);
}

if (Number.parseInt(process.versions.node.split(".")[0], 10) < 18) {
  die(`нужен Node.js 18 или новее (у тебя ${process.versions.node}): https://nodejs.org`);
}

const appPkg = JSON.parse(readFileSync(path.join(APP, "package.json"), "utf8"));
const ELECTRON = appPkg.devDependencies?.electron;
if (!/^\d+\.\d+\.\d+$/.test(ELECTRON ?? "")) die("в app/package.json версия electron должна быть точной, например 44.4.4");
const PLATFORM = "win32-x64";
const INSTALL = flags.install !== undefined;
if (INSTALL && flags.out !== undefined) die("--install ставит окно в папку бота; --out с ним не сочетается");
const outDir = path.resolve(HERE, flags.out ?? "dist");

const zipRoot = path.join(outDir, `ddnet-ai-app-${PLATFORM}`);
const liveDir = path.join(HERE, "app-win");
const stage = INSTALL ? path.join(HERE, `app-win.partial-${process.pid}`) : path.join(zipRoot, "app-win");

const STAMP = ".installed";
const LOCK = path.join(HERE, "app-win.lock");
const cacheDir = path.join(
  process.env.ELECTRON_CACHE ??
    (process.platform === "win32" && process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, "ddnet-ai-electron")
      : path.join(os.homedir(), ".cache", "ddnet-ai-electron")),
);
const EXE = "DDNet AI.exe";

async function download(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);

  const total = Number(res.headers.get("content-length") ?? 0);
  if (!res.body || total < 1_000_000) return Buffer.from(await res.arrayBuffer());
  const parts = [];
  let got = 0;
  let shown = -1;
  try {
    for await (const chunk of res.body) {
      parts.push(chunk);
      got += chunk.length;
      const pct = Math.floor((got / total) * 100);
      if (pct !== shown && pct % 5 === 0) {
        shown = pct;
        process.stdout.write(`\r  ${pct}%  ${(got / 1e6).toFixed(0)} из ${(total / 1e6).toFixed(0)} МБ   `);
      }
    }
  } finally {

    process.stdout.write("\n");
  }
  return Buffer.concat(parts);
}

async function electronZip() {
  const name = `electron-v${ELECTRON}-${PLATFORM}.zip`;
  const base = `https://github.com/electron/electron/releases/download/v${ELECTRON}`;
  mkdirSync(cacheDir, { recursive: true });
  const sumsFile = path.join(cacheDir, `SHASUMS256-v${ELECTRON}.txt`);
  const find = (text) => text.split("\n").find((l) => l.trim().endsWith(`*${name}`) || l.trim().endsWith(` ${name}`));

  let line = existsSync(sumsFile) ? find(readFileSync(sumsFile, "utf8")) : undefined;
  if (!line) {
    const fresh = await download(`${base}/SHASUMS256.txt`);
    writeAtomic(sumsFile, fresh);
    line = find(fresh.toString("utf8"));
  }
  if (!line) die(`в SHASUMS256.txt нет ${name}`);
  const want = line.trim().split(/\s+/)[0].toLowerCase();
  const file = path.join(cacheDir, name);
  let buf = existsSync(file) ? readFileSync(file) : null;
  if (buf === null || createHash("sha256").update(buf).digest("hex") !== want) {
    console.log(`качаю ${name}...`);
    buf = await download(`${base}/${name}`);
    const got = createHash("sha256").update(buf).digest("hex");
    if (got !== want) die(`контрольная сумма ${name} не сошлась: ${got} вместо ${want}`);
    writeAtomic(file, buf);
  } else {
    console.log(`беру из кэша ${file}`);
  }
  return buf;
}

function writeAtomic(file, data) {
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, data);
  renameSync(tmp, file);
}

function lockHolderAlive() {
  try {
    const pid = Number.parseInt(readFileSync(LOCK, "utf8"), 10);
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
    process.kill(pid, 0);
    return Date.now() - statSync(LOCK).mtimeMs < 20 * 60 * 1000;
  } catch (err) {

    return err && err.code === "EPERM";
  }
}
function takeLock() {
  try {
    writeFileSync(LOCK, String(process.pid), { flag: "wx" });
  } catch {
    if (lockHolderAlive()) die("окно уже ставится в другом окне консоли, дождись его");
    rmSync(LOCK, { force: true });
    writeFileSync(LOCK, String(process.pid), { flag: "wx" });
  }

  process.on("exit", () => rmSync(LOCK, { force: true }));

  for (const n of readdirSync(HERE)) {
    if (/^app-win\.(partial|old)-\d+$/.test(n)) rmSync(path.join(HERE, n), { recursive: true, force: true });
  }
}

function swapIn() {
  const old = `${liveDir}.old-${process.pid}`;
  if (existsSync(liveDir)) {
    try {
      renameSync(liveDir, old);
    } catch {
      rmSync(stage, { recursive: true, force: true });
      die("не получилось заменить app-win: закрой окно DDNet AI и запусти DDNet AI.vbs ещё раз");
    }
  }
  renameSync(stage, liveDir);
  rmSync(old, { recursive: true, force: true });
}

const APP_FILES = ["boot.js", "main.js", "preload.js", "lib", "ui", "icons"];
const SKIP = new Set(["build-icons.sh", "tee-grey.svg"]);

function copyApp(dest) {
  mkdirSync(dest, { recursive: true });
  for (const f of APP_FILES) {
    cpSync(path.join(APP, f), path.join(dest, f), { recursive: true, filter: (src) => !SKIP.has(path.basename(src)) });
  }
  const pkg = {
    name: appPkg.name,
    productName: appPkg.productName,
    version: appPkg.version,
    description: appPkg.description,
    main: "boot.js",
    type: appPkg.type,
    private: true,
  };
  writeFileSync(path.join(dest, "package.json"), JSON.stringify(pkg, null, 2));
}

async function patchExe(file) {

  let ResEdit = null;
  try {
    const entry = createRequire(path.join(APP, "package.json")).resolve("resedit");
    ResEdit = await import(pathToFileURL(entry).href);
  } catch {
    ResEdit = null;
  }
  if (ResEdit === null) {
    if (INSTALL) {
      console.log("resedit нет: у exe останется значок Electron, окно и трей всё равно свои");
      return;
    }
    die("нет resedit: сначала cd app && npm install");
  }
  const exe = ResEdit.NtExecutable.from(readFileSync(file), { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);
  const ico = ResEdit.Data.IconFile.from(readFileSync(path.join(APP, "icons", "app.ico")));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  if (groups.length === 0) die("в electron.exe не нашлось группы значков");
  for (const g of groups) {
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, g.id, g.lang, ico.icons.map((i) => i.data));
  }
  const [vi] = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  const [maj, min, pat] = appPkg.version.split(".").map(Number);
  vi.setFileVersion(maj, min, pat, 0);
  vi.setProductVersion(maj, min, pat, 0);
  const langs = vi.getAllLanguagesForStringValues();
  for (const lang of langs.length ? langs : [{ lang: 1033, codepage: 1200 }]) {
    vi.setStringValues(lang, {
      FileDescription: "DDNet AI",
      ProductName: "DDNet AI",
      InternalName: "DDNet AI",
      OriginalFilename: EXE,
      CompanyName: "ddnet-ai",
      LegalCopyright: "ddnet-ai; Electron (MIT); Lucide icons (ISC)",
      FileVersion: appPkg.version,
      ProductVersion: appPkg.version,
    });

    vi.removeStringValue(lang, "SquirrelAwareVersion");
  }
  vi.outputToResourceEntries(res.entries);
  res.outputResource(exe);
  writeFileSync(file, Buffer.from(exe.generate()));
}

function listFiles(dir, base = dir, out = []) {
  for (const n of readdirSync(dir)) {
    const full = path.join(dir, n);
    if (statSync(full).isDirectory()) listFiles(full, base, out);
    else out.push(full);
  }
  return out;
}

const README = `DDNet AI -- окно для бота
=========================

Эту папку (app-win) кладут ВНУТРЬ папки бота, рядом со start.mjs:

  ddnet-ai\\
    start.mjs
    app-win\\
      DDNet AI.exe   <- запускать это

Окно само найдёт бота, запустит его и покажет. Node.js ставить не обязательно:
если его нет или он старше 24-го, бот запускается встроенным в окно Node.

Если окно лежит в другом месте, оно спросит папку бота один раз и запомнит.
`;

async function main() {
  if (!existsSync(path.join(APP, "icons", "app.ico"))) die("нет app/icons/app.ico (app/icons/build-icons.sh)");
  if (INSTALL) takeLock();
  const zipBuf = await electronZip();
  rmSync(INSTALL ? stage : zipRoot, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  console.log("распаковываю Electron...");
  for (const e of readZip(zipBuf)) {
    const rel = e.name.replace(/\\/g, "/");
    if (rel.split("/").includes("..")) die(`подозрительный путь в архиве: ${rel}`);
    const dest = path.join(stage, rel);
    if (e.isDir) {
      mkdirSync(dest, { recursive: true });
      continue;
    }
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, e.data());
  }

  rmSync(path.join(stage, "resources", "default_app.asar"), { force: true });
  copyApp(path.join(stage, "resources", "app"));
  const exe = path.join(stage, EXE);

  renameSync(path.join(stage, "electron.exe"), exe);
  console.log("ставлю значок и версию в exe...");
  await patchExe(exe);
  writeFileSync(path.join(stage, "ПРОЧТИ.txt"), README.replace(/\n/g, "\r\n"));
  writeFileSync(path.join(stage, STAMP), ELECTRON);
  if (INSTALL) {
    swapIn();

    rmSync(path.join(cacheDir, `electron-v${ELECTRON}-${PLATFORM}.zip`), { force: true });
    console.log(`готово: ${liveDir}`);
    return;
  }
  if (flags["no-zip"] !== undefined) {
    console.log(`готово: ${stage}`);
    return;
  }
  const out = path.join(outDir, `ddnet-ai-app-${PLATFORM}.zip`);
  const files = listFiles(stage);
  console.log(`пакую ${files.length} файлов...`);

  const entries = files.map((f) => ({ name: path.relative(zipRoot, f).split(path.sep).join("/"), file: f }));
  entries.push({ name: "DDNet AI.vbs", file: path.join(HERE, "DDNet AI.vbs") });
  const res = await writeZip(out, entries);
  console.log(`готово: ${out} (${(res.bytes / 1048576).toFixed(1)} МБ)`);
}

main().catch((err) => die(err instanceof Error ? err.stack ?? err.message : String(err)));

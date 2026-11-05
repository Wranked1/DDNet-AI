import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { t } from "../i18n.ts";

const PUBLIC_REPO = "Wranked1/DDNet-AI";
const PRIVATE_REPO = "Wranked1/AiDDNet";
const TOKEN_FILE = "update-token.txt";
const BRANCH = "main";

const API = process.env.DDNET_AI_UPDATE_API ?? "https://api.github.com";

const PLAIN_GIT = process.env.DDNET_AI_UPDATE_API === undefined;
const GIT = "https://github.com";
const CODELOAD = "https://codeload.github.com";

async function headFromGit(repo: string): Promise<string> {
  const res = await fetch(`${GIT}/${repo}.git/info/refs?service=git-upload-pack`, { headers: { "user-agent": "git/2.40 ddnet-ai-bot" } });
  if (res.status === 404) throw new Error(t("репозиторий {repo} не найден", { repo }));
  if (!res.ok) throw new Error(`git ${res.status}`);
  const text = await res.text();
  const m = new RegExp(`([0-9a-f]{40}) refs/heads/${BRANCH}(?:\\n|\\s|$)`).exec(text);
  if (m === null) throw new Error("git: no refs/heads/" + BRANCH);
  return m[1];
}

const CHECK_EVERY_MS = 5 * 60 * 1000;

const TAKE = [
  "src",

  "app",
  "tools",
  "maps",
  "reference",
  "start.mjs",
  "package.json",
  "opponent.json",
  "run.bat",
  "run.sh",
  "run-gui.vbs",
  "DDNet AI.vbs",
  "DDNet AI.sh",
  "ddnet-ai.desktop",
  "run-forever.bat",
  "run-forever.sh",
  "update.bat",
  "update.sh",
  "READ_ME_FIRST.txt",
  "README.md",
  "README.en.md",
];

const NEVER_TAKE = new Set(["runs", "node_modules", "settings.json", "update-token.txt", ".version", ".git"]);
export function takeListOf(tree: string): string[] {
  let text: string;
  try {
    text = fs.readFileSync(path.join(tree, "src", "bot", "autoUpdate.ts"), "utf8");
  } catch {
    return [];
  }
  const block = /const TAKE = \[([\s\S]*?)\];/.exec(text);
  if (block === null) return [];
  return [...block[1].matchAll(/"([^"]+)"/g)]
    .map((m) => m[1])
    .filter((n) => /^[A-Za-z0-9 _-][A-Za-z0-9 ._-]*$/.test(n) && !n.includes("..") && !NEVER_TAKE.has(n));
}

export function copyChanged(from: string, to: string, changed?: string[], backup?: Array<{ to: string; old: Buffer | null }>): void {
  const st = fs.statSync(from);
  if (st.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const name of fs.readdirSync(from)) copyChanged(path.join(from, name), path.join(to, name), changed, backup);
    return;
  }
  const data = fs.readFileSync(from);
  let old: Buffer | null = null;
  try {
    old = fs.readFileSync(to);
    if (old.equals(data)) return;
  } catch (err) {

    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  backup?.push({ to, old });
  fs.writeFileSync(to, data);

  if (st.mode & 0o111) {
    try {
      fs.chmodSync(to, st.mode & 0o777);
    } catch {

    }
  }
  changed?.push(to);
}

export function needsRestart(changed: string[], root: string): boolean {
  return changed.some((f) => !/^(README(\.[a-z]+)?\.md|READ_ME_FIRST\.txt)$/i.test(path.relative(root, f)));
}

export type UpdateEvent = { kind: "checking" | "current" | "found" | "applied" | "failed"; text: string; sha?: string };

function stampFile(root: string): string {
  return path.join(root, ".version");
}

type Channel = { repo: string; token: string };

export function tokenOf(root: string): string {
  const env = process.env.DDNET_AI_TOKEN ?? "";
  if (env.trim() !== "") return env.trim();
  try {
    return fs.readFileSync(path.join(root, TOKEN_FILE), "utf8").trim();
  } catch {
    return "";
  }
}

export function channelOf(token: string): Channel {
  return token === "" ? { repo: PUBLIC_REPO, token: "" } : { repo: PRIVATE_REPO, token };
}

function headers(ch: Channel): Record<string, string> {
  const h: Record<string, string> = { "user-agent": "ddnet-ai-bot" };
  if (ch.token !== "") h.authorization = `Bearer ${ch.token}`;
  return h;
}

export function currentVersion(root: string): string {
  try {
    return fs.readFileSync(stampFile(root), "utf8").trim();
  } catch {
    return "";
  }
}

let lastHead: { repo: string; etag: string; sha: string } | null = null;

let limitedUntilMs = 0;

async function latestCommit(ch: Channel): Promise<string> {
  if (PLAIN_GIT && ch.token === "") {
    try {
      return await headFromGit(ch.repo);
    } catch {

    }
  }
  const h: Record<string, string> = { ...headers(ch), accept: "application/vnd.github.sha" };
  if (lastHead !== null && lastHead.repo === ch.repo) h["if-none-match"] = lastHead.etag;
  const res = await fetch(`${API}/repos/${ch.repo}/commits/${BRANCH}`, { headers: h });
  if (res.status === 304 && lastHead !== null && lastHead.repo === ch.repo) return lastHead.sha;
  if (res.status === 403 || res.status === 429) {
    const reset = Number(res.headers.get("x-ratelimit-reset"));
    const retry = Number(res.headers.get("retry-after"));
    limitedUntilMs = Number.isFinite(reset) && reset > 0 ? reset * 1000 : Date.now() + (Number.isFinite(retry) && retry > 0 ? retry * 1000 : 30 * 60 * 1000);
  }
  if (res.status === 401) throw new Error(t("{file} не подходит", { file: TOKEN_FILE }));
  if (res.status === 404) throw new Error(t("репозиторий {repo} не найден", { repo: ch.repo }));
  if (res.status === 403 || res.status === 429) throw new Error(t("GitHub просит подождать с запросами, проверю позже"));
  if (!res.ok) throw new Error(`github ${res.status}`);
  const sha = (await res.text()).trim();
  const etag = res.headers.get("etag");
  if (etag !== null && etag !== "") lastHead = { repo: ch.repo, etag, sha };
  return sha;
}

function parseVersion(v: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  return m === null ? null : [Number(m[1]), Number(m[2]), Number(m[3])];
}

function compareVersions(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}

export function satisfiesSimple(version: string, range: string): boolean {
  const v = parseVersion(version);
  if (v === null) return false;
  const r = range.trim();
  if (r === "" || r === "*") return true;
  const m = /^(\^|~|>=)?(\d+\.\d+\.\d+)$/.exec(r);
  if (m === null) return false;
  const base = parseVersion(m[2]);
  if (base === null) return false;
  const cmp = compareVersions(v, base);
  switch (m[1]) {

    case "^":
      return cmp >= 0 && v[0] === base[0] && (base[0] !== 0 || (v[1] === base[1] && (base[1] !== 0 || v[2] === base[2])));
    case "~":
      return cmp >= 0 && v[0] === base[0] && v[1] === base[1];
    case ">=":
      return cmp >= 0;
    default:
      return cmp === 0;
  }
}

function unmetDependencies(root: string, staged: string): string[] {
  let deps: Record<string, unknown>;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(staged, "package.json"), "utf8")) as { dependencies?: Record<string, unknown> } | null;
    deps = pkg?.dependencies ?? {};
  } catch {
    return [];
  }
  const unmet: string[] = [];
  for (const [name, range] of Object.entries(deps)) {
    let ok = false;
    try {
      const installed = JSON.parse(fs.readFileSync(path.join(root, "node_modules", ...name.split("/"), "package.json"), "utf8")) as { version?: unknown };
      ok = typeof installed.version === "string" && typeof range === "string" && satisfiesSimple(installed.version, range);
    } catch {

    }
    if (!ok) unmet.push(name);
  }
  return unmet;
}

export async function apply(root: string, sha: string, token = ""): Promise<string[]> {
  const ch = channelOf(token);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ddnet-ai-upd-"));
  try {

    const url = PLAIN_GIT && ch.token === "" ? `${CODELOAD}/${ch.repo}/tar.gz/${sha}` : `${API}/repos/${ch.repo}/tarball/${sha}`;
    const res = await fetch(url, { headers: headers(ch) });
    if (!res.ok) throw new Error(`codeload ${res.status}`);
    const tar = path.join(tmp, "src.tar.gz");
    fs.writeFileSync(tar, Buffer.from(await res.arrayBuffer()));

    execFileSync("tar", ["-xzf", tar, "-C", tmp], { stdio: "ignore" });

    const inner = fs.readdirSync(tmp, { withFileTypes: true }).find((e) => e.isDirectory())?.name;
    if (inner === undefined) throw new Error(t("в архиве нет папки с исходниками"));
    const unmet = unmetDependencies(root, path.join(tmp, inner));
    if (unmet.length > 0) {
      const refused = new Error(t("новой версии нужны другие зависимости ({names}): скачай свежий релиз с GitHub", { names: unmet.join(", ") }));
      refused.name = DEPS_REFUSED;
      throw refused;
    }
    const changed: string[] = [];
    const backup: Array<{ to: string; old: Buffer | null }> = [];
    const oldStamp = currentVersion(root);
    fs.rmSync(stampFile(root), { force: true });
    try {

      for (const name of new Set([...TAKE, ...takeListOf(path.join(tmp, inner))])) {
        const from = path.join(tmp, inner, name);
        if (!fs.existsSync(from)) continue;
        copyChanged(from, path.join(root, name), changed, backup);
      }

      fs.writeFileSync(stampFile(root), sha);
    } catch (err) {
      let restoredAll = true;
      for (let i = backup.length - 1; i >= 0; i--) {
        try {
          const { to, old } = backup[i];
          if (old === null) fs.rmSync(to, { force: true });
          else fs.writeFileSync(to, old);
        } catch {

          restoredAll = false;
        }
      }
      if (oldStamp !== "" && restoredAll) {
        try {
          fs.writeFileSync(stampFile(root), oldStamp);
        } catch {

        }
      }
      throw err;
    }
    return changed;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export type CheckResult = { kind: "current" | "applied" | "failed" | "stopped"; text: string };

const DEPS_REFUSED = "DepsRefused";

export function startAutoUpdate(
  root: string,
  onEvent: (e: UpdateEvent) => void,
  quit: () => void,
): { stop: () => void; check: () => Promise<CheckResult> } {
  let stopped = false;
  let saidGit = false;

  let refused: { sha: string; text: string } | null = null;

  let running: Promise<CheckResult> | null = null;
  const once = (manual = false): Promise<CheckResult> => {
    if (running === null) running = tick(manual).finally(() => (running = null));
    return running;
  };
  const tick = async (manual = false): Promise<CheckResult> => {
    if (stopped) return { kind: "stopped", text: "" };

    if (Date.now() < limitedUntilMs) {
      const text = t("GitHub просит подождать с запросами, проверю позже");
      if (manual) onEvent({ kind: "failed", text });
      return { kind: "failed", text };
    }
    let sha = "";
    try {
      const token = tokenOf(root);
      const have = currentVersion(root);

      if (fs.existsSync(path.join(root, ".git"))) {
        const text = t("папка бота -- git-репозиторий: обновляй через git pull");
        if (manual || !saidGit) onEvent({ kind: "failed", text });
        saidGit = true;
        return { kind: "failed", text };
      }
      sha = await latestCommit(channelOf(token));
      if (sha === have) return { kind: "current", text: "" };
      if (!manual && refused !== null && refused.sha === sha) return { kind: "failed", text: refused.text };

      if (have === "") onEvent({ kind: "checking", text: t("сверяю файлы с {sha}...", { sha: sha.slice(0, 7) }) });
      else onEvent({ kind: "found", text: t("есть обновление ({sha}), качаю...", { sha: sha.slice(0, 7) }) });
      const changed = await apply(root, sha, token);

      if (have === "" && changed.length === 0) return { kind: "current", text: "" };
      if (!needsRestart(changed, root)) {
        const text = t("обновлено до {sha}: только описание, бот играет дальше", { sha: sha.slice(0, 7) });
        onEvent({ kind: "current", sha, text });
        return { kind: "applied", text };
      }
      const text = t("обновлено до {sha}, перезапускаюсь", { sha: sha.slice(0, 7) });
      onEvent({ kind: "applied", sha, text });
      quit();
      return { kind: "applied", text };
    } catch (err) {
      const text = t("обновление не вышло: {err}", { err: err instanceof Error ? err.message : String(err) });
      if (err instanceof Error && err.name === DEPS_REFUSED && sha !== "") refused = { sha, text };
      onEvent({ kind: "failed", text });
      return { kind: "failed", text };
    }
  };
  void once();
  const timer = setInterval(() => void once(), CHECK_EVERY_MS);
  timer.unref?.();
  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
    check: () => once(true),
  };
}

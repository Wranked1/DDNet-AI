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

export function copyChanged(from: string, to: string, changed?: string[]): void {
  const st = fs.statSync(from);
  if (st.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const name of fs.readdirSync(from)) copyChanged(path.join(from, name), path.join(to, name), changed);
    return;
  }
  const data = fs.readFileSync(from);
  try {
    if (fs.readFileSync(to).equals(data)) return;
  } catch {

  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, data);
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

function tokenOf(root: string): string {
  const env = process.env.GITHUB_TOKEN ?? process.env.DDNET_AI_TOKEN ?? "";
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

export async function apply(root: string, sha: string, token = ""): Promise<string[]> {
  const ch = channelOf(token);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ddnet-ai-upd-"));
  try {
    const res = await fetch(`${API}/repos/${ch.repo}/tarball/${sha}`, { headers: headers(ch) });
    if (!res.ok) throw new Error(`codeload ${res.status}`);
    const tar = path.join(tmp, "src.tar.gz");
    fs.writeFileSync(tar, Buffer.from(await res.arrayBuffer()));

    execFileSync("tar", ["-xzf", tar, "-C", tmp], { stdio: "ignore" });

    const inner = fs.readdirSync(tmp, { withFileTypes: true }).find((e) => e.isDirectory())?.name;
    if (inner === undefined) throw new Error(t("в архиве нет папки с исходниками"));

    const changed: string[] = [];
    for (const name of new Set([...TAKE, ...takeListOf(path.join(tmp, inner))])) {
      const from = path.join(tmp, inner, name);
      if (!fs.existsSync(from)) continue;
      copyChanged(from, path.join(root, name), changed);
    }
    fs.writeFileSync(stampFile(root), sha);
    return changed;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export function startAutoUpdate(
  root: string,
  onEvent: (e: UpdateEvent) => void,
  quit: () => void,
): { stop: () => void; check: () => Promise<void> } {
  let stopped = false;
  const tick = async (manual = false): Promise<void> => {
    if (stopped) return;

    if (Date.now() < limitedUntilMs) {
      if (manual) onEvent({ kind: "failed", text: t("GitHub просит подождать с запросами, проверю позже") });
      return;
    }
    try {
      const token = tokenOf(root);
      const have = currentVersion(root);
      const sha = await latestCommit(channelOf(token));
      if (have === "") {

        fs.writeFileSync(stampFile(root), sha);
        return;
      }
      if (sha === have) return;
      onEvent({ kind: "found", text: t("есть обновление ({sha}), качаю...", { sha: sha.slice(0, 7) }) });
      const changed = await apply(root, sha, token);
      if (!needsRestart(changed, root)) {
        onEvent({ kind: "current", sha, text: t("обновлено до {sha}: только описание, бот играет дальше", { sha: sha.slice(0, 7) }) });
        return;
      }
      onEvent({ kind: "applied", sha, text: t("обновлено до {sha}, перезапускаюсь", { sha: sha.slice(0, 7) }) });
      quit();
    } catch (err) {
      onEvent({ kind: "failed", text: t("обновление не вышло: {err}", { err: err instanceof Error ? err.message : String(err) }) });
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), CHECK_EVERY_MS);
  timer.unref?.();
  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
    check: () => tick(true),
  };
}

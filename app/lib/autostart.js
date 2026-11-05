"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ENTRY = "ddnet-ai.desktop";
const LAUNCHER = "DDNet AI.sh";

function autostartDir(env, home) {
  const x = env.XDG_CONFIG_HOME;
  const base = typeof x === "string" && path.isAbsolute(x) ? x : path.join(home, ".config");
  return path.join(base, "autostart");
}

function autostartFile(env, home) {
  return path.join(autostartDir(env, home), ENTRY);
}

function launcherPath(root) {
  return path.join(root, LAUNCHER);
}

function execLine(root) {
  const launcher = launcherPath(root);
  if (/[\\"$`\r\n]/.test(launcher)) return null;
  return `"${launcher.replace(/%/g, "%%")}" --hidden`;
}

function desktopText(root, name = "DDNet AI") {
  const exec = execLine(root);
  if (exec === null) return null;
  return [
    "[Desktop Entry]",
    "Type=Application",
    `Name=${name}`,
    "Comment=Bot for DDNet",
    `Exec=${exec}`,
    "Icon=ddnet-ai",
    "Terminal=false",
    "StartupWMClass=ddnet-ai",
    "X-GNOME-Autostart-enabled=true",
    "",
  ].join("\n");
}

function supported(root, exists = fs.existsSync) {
  return typeof root === "string" && root !== "" && exists(launcherPath(root)) && exists(path.join(root, "app-linux", "ddnet-ai"));
}

function isOn(env, home, root, fsApi = fs) {
  if (typeof root !== "string" || root === "") return false;
  let text;
  try {
    text = fsApi.readFileSync(autostartFile(env, home), "utf8");
  } catch {
    return false;
  }
  const exec = execLine(root);
  const line = /^Exec=(.*?)\r?$/m.exec(text);
  if (exec === null || line === null || line[1] !== exec) return false;
  return !/^\s*Hidden\s*=\s*true\s*$/im.test(text) && !/^\s*X-GNOME-Autostart-enabled\s*=\s*false\s*$/im.test(text);
}

function setOn(on, { env, home, root, fsApi = fs }) {
  const file = autostartFile(env, home);
  try {
    if (!on) {
      try {
        fsApi.unlinkSync(file);
      } catch (err) {
        if (!err || err.code !== "ENOENT") throw err;
      }
      return { ok: true };
    }
    const text = desktopText(root);
    if (text === null) return { ok: false, error: "special-characters" };
    fsApi.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fsApi.writeFileSync(tmp, text, { mode: 0o644 });
    fsApi.renameSync(tmp, file);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

module.exports = { ENTRY, LAUNCHER, autostartDir, autostartFile, launcherPath, execLine, desktopText, supported, isOn, setOn };

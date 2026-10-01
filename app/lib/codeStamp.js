"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function codeStamp(appDir) {
  const files = ["main.js", "preload.js", "package.json"].map((f) => path.join(appDir, f));
  try {
    for (const f of fs.readdirSync(path.join(appDir, "lib")).sort()) if (f.endsWith(".js")) files.push(path.join(appDir, "lib", f));
  } catch {

  }
  return files
    .map((f) => {
      try {
        const data = fs.readFileSync(f);
        return `${f}:${data.length}:${crypto.createHash("sha1").update(data).digest("hex")}`;
      } catch {
        return `${f}:-`;
      }
    })
    .join("|");
}

function bootRunsLive({ appPath, execPath, env, electronVersion, exists, readFile }) {
  const looksLikeBot = (dir) => exists(path.join(dir, "start.mjs")) && exists(path.join(dir, "app", "main.js"));
  const findBot = () => {
    const override = env.DDNET_AI_ROOT;
    if (override && looksLikeBot(path.resolve(override))) return path.resolve(override);
    for (const start of [path.dirname(execPath), appPath]) {
      let dir = start;
      for (let i = 0; i < 5; i++) {
        if (looksLikeBot(dir)) return dir;
        const up = path.dirname(dir);
        if (up === dir) break;
        dir = up;
      }
    }
    return null;
  };
  const wantedElectron = (bot) => {
    try {
      const pkg = JSON.parse(readFile(path.join(bot, "app", "package.json")));
      return (pkg.devDependencies && pkg.devDependencies.electron) || null;
    } catch {
      return null;
    }
  };
  const bot = findBot();
  if (bot === null) return false;
  const want = wantedElectron(bot);
  const sameRuntime = want === null || want === electronVersion;
  return sameRuntime && path.resolve(bot, "app") !== path.resolve(appPath);
}

module.exports = { codeStamp, bootRunsLive };

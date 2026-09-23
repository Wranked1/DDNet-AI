"use strict";

const fs = require("node:fs");
const path = require("node:path");

function looksLikeBot(dir) {
  return fs.existsSync(path.join(dir, "start.mjs")) && fs.existsSync(path.join(dir, "app", "main.js"));
}

function findBot() {
  const override = process.env.DDNET_AI_ROOT;
  if (override && looksLikeBot(path.resolve(override))) return path.resolve(override);
  const starts = [path.dirname(process.execPath), __dirname];
  for (const start of starts) {
    let dir = start;
    for (let i = 0; i < 5; i++) {
      if (looksLikeBot(dir)) return dir;
      const up = path.dirname(dir);
      if (up === dir) break;
      dir = up;
    }
  }
  return null;
}

function wantedElectron(bot) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(bot, "app", "package.json"), "utf8"));
    return (pkg.devDependencies && pkg.devDependencies.electron) || null;
  } catch {
    return null;
  }
}

const bot = findBot();
const live = bot === null ? null : path.join(bot, "app", "main.js");
const want = bot === null ? null : wantedElectron(bot);
const sameRuntime = want === null || want === process.versions.electron;

if (live !== null && sameRuntime && path.resolve(path.dirname(live)) !== path.resolve(__dirname)) {
  require(live);
} else {
  require("./main.js");
}

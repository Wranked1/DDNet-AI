"use strict";

const MASTERS = [
  "https://master1.ddnet.org/ddnet/15/servers.json",
  "https://master2.ddnet.org/ddnet/15/servers.json",
  "https://master3.ddnet.org/ddnet/15/servers.json",
  "https://master4.ddnet.org/ddnet/15/servers.json",
];

const ADDR_RE = /^(tw-0\.6\+udp|tw-0\.7\+udp|ddnet\+udp|udp):\/\/(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/;

function pickAddress(addresses) {
  if (!Array.isArray(addresses)) return null;
  let fallback = null;
  for (const a of addresses) {
    if (typeof a !== "string") continue;
    const m = ADDR_RE.exec(a.trim());
    if (m === null) continue;
    const octets = m[2].split(".").map(Number);
    const port = Number(m[3]);
    if (octets.some((o) => o > 255) || port < 1 || port > 65535) continue;
    const addr = `${m[2]}:${port}`;
    if (m[1] === "tw-0.6+udp") return addr;
    fallback ??= addr;
  }
  return fallback;
}

const str = (v, max = 128) => (typeof v === "string" ? v.slice(0, max) : "");

function parseServerList(json) {
  const list = json !== null && typeof json === "object" && Array.isArray(json.servers) ? json.servers : [];
  const seen = new Set();
  const rows = [];
  for (const s of list) {
    if (s === null || typeof s !== "object") continue;
    const address = pickAddress(s.addresses);
    if (address === null || seen.has(address)) continue;
    const info = s.info !== null && typeof s.info === "object" ? s.info : {};
    const clients = Array.isArray(info.clients) ? info.clients.filter((c) => c !== null && typeof c === "object") : [];
    seen.add(address);
    rows.push({
      address,
      name: str(info.name) || address,
      map: str(info.map && typeof info.map === "object" ? info.map.name : info.map, 64),
      gameType: str(info.game_type, 32),
      location: str(s.location, 16),
      passworded: info.passworded === true,
      players: clients.filter((c) => c.is_player !== false).length,
      clients: clients.length,
      maxClients: Number.isFinite(info.max_clients) ? info.max_clients : 0,
      names: clients.map((c) => str(c.name, 32)).filter((n) => n !== ""),
    });
  }
  rows.sort((a, b) => b.clients - a.clients || a.name.localeCompare(b.name));
  return rows;
}

function filterServers(rows, opts = {}) {
  const q = typeof opts.query === "string" ? opts.query.trim().toLowerCase() : "";
  const favs = new Set(Array.isArray(opts.favorites) ? opts.favorites : []);
  return rows.filter((r) => {
    if (opts.onlyFavorites && !favs.has(r.address)) return false;
    if (opts.hideEmpty && r.clients === 0) return false;
    if (opts.hideFull && r.maxClients > 0 && r.clients >= r.maxClients) return false;
    if (opts.hideLocked && r.passworded) return false;
    if (q === "") return true;
    return (
      r.name.toLowerCase().includes(q) ||
      r.map.toLowerCase().includes(q) ||
      r.gameType.toLowerCase().includes(q) ||
      r.address.includes(q) ||
      r.names.some((n) => n.toLowerCase().includes(q))
    );
  });
}

function regionOf(location) {
  const m = /^([a-z]{2,3})/i.exec(location || "");
  return m === null ? "" : m[1].toUpperCase();
}

module.exports = { MASTERS, pickAddress, parseServerList, filterServers, regionOf };

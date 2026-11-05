"use strict";

const SHAPE = "Не разобрать адрес прокси: нужен вид socks5://логин:пароль@хост:порт или хост:порт";
const PORT = "В адресе прокси нужен порт от 1 до 65535";
const LENGTH = "Логин и пароль прокси не длиннее 255 байт";
const NEED_SOCKS5 = "Нужен SOCKS5-прокси: бот играет по UDP, HTTP-прокси его не пропускают";
const EMPTY = "Адрес прокси пустой";
const MASK = "***";

const { isIPv6 } = require("node:net");
const bytes = (s) => Buffer.byteLength(s, "utf8");

function bad(error) {
  return { ok: false, error };
}

function finish(host, portText, user, pass) {
  if (!/^\d{1,5}$/.test(portText)) return bad(PORT);
  const port = Number(portText);
  if (port < 1 || port > 65535) return bad(PORT);
  if (host === "" || !(isIPv6(host) || /^[A-Za-z0-9._-]+$/.test(host))) return bad(SHAPE);
  if (user !== undefined) {
    if (user === "") return bad(SHAPE);
    if (bytes(user) > 255 || bytes(pass || "") > 255) return bad(LENGTH);
  }
  const proxy = { host, port };
  if (user !== undefined) {
    proxy.user = user;
    proxy.pass = pass || "";
  }
  return { ok: true, proxy };
}

function splitText(text) {
  const s = text.trim();
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//.exec(s);
  if (scheme !== null) {
    const rest = s.slice(scheme[0].length);
    const at = rest.lastIndexOf("@");
    if (at < 0) return null;
    const c = rest.indexOf(":");
    if (c < 0 || c > at) return null;
    return { pre: scheme[0] + rest.slice(0, c + 1), pass: rest.slice(c + 1, at), post: rest.slice(at) };
  }
  const parts = s.split(":");
  if (parts.length < 4) return null;
  const head = parts.slice(0, 3).join(":") + ":";
  return { pre: head, pass: s.slice(head.length), post: "" };
}

function fromUrl(rest) {
  const body = rest.replace(/\/+$/, "");
  if (body === "" || body.includes("/") || /\s/.test(body)) return bad(SHAPE);
  const at = body.lastIndexOf("@");
  let user;
  let pass;
  if (at >= 0) {
    const info = body.slice(0, at);
    const c = info.indexOf(":");
    try {
      user = decodeURIComponent(c < 0 ? info : info.slice(0, c));
      pass = c < 0 ? undefined : decodeURIComponent(info.slice(c + 1));
    } catch {
      return bad(SHAPE);
    }
  }
  const hostPort = body.slice(at + 1);
  const m = /^\[([^\]]+)\]:(\d*)$/.exec(hostPort) || /^([^:[\]]+):(\d*)$/.exec(hostPort);
  if (m === null) return bad(/^[^:]+$/.test(hostPort) ? PORT : SHAPE);
  return finish(m[1], m[2], user, pass);
}

function parseProxyText(text, allowDash) {
  const s = typeof text === "string" ? text.trim() : "";
  if (s === "") return bad(EMPTY);
  if (s === "-" && allowDash === true) return { ok: true, proxy: null };
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//.exec(s);
  if (scheme !== null) {
    const name = scheme[1].toLowerCase();
    if (name === "socks5" || name === "socks5h") {
      const r = fromUrl(s.slice(scheme[0].length));
      if (r.ok && name === "socks5h") r.proxy.remoteDns = true;
      return r;
    }
    return bad(NEED_SOCKS5);
  }
  const parts = s.split(":");
  if (parts.length === 2) return finish(parts[0], parts[1], undefined, undefined);
  if (parts.length >= 4) return finish(parts[0], parts[1], parts[2], parts.slice(3).join(":"));
  return bad(SHAPE);
}

function maskProxy(text) {
  if (typeof text !== "string" || text === "") return "";
  const sp = splitText(text);
  return sp === null || sp.pass === "" ? text : sp.pre + MASK + sp.post;
}

function unmaskProxy(submitted, stored) {
  if (typeof submitted !== "string" || typeof stored !== "string") return submitted;
  if (submitted.trim() !== "" && submitted.trim() === maskProxy(stored) && stored.trim() !== submitted.trim()) return stored.trim();

  const sub = splitText(submitted);
  const st = splitText(stored);
  if (sub !== null && st !== null && sub.pass === MASK && st.pass !== "" && st.pass !== MASK && /:\/\//.test(sub.pre) === /:\/\//.test(st.pre)) return sub.pre + st.pass + sub.post;
  return submitted;
}

module.exports = { parseProxyText, maskProxy, unmaskProxy, MASK };

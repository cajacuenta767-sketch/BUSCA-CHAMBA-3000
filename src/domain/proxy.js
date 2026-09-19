"use strict";
/** Normalización de proxies: acepta ip:puerto, ip:puerto:usuario:clave, usuario:clave@ip:puerto o URL completa. */
function normalizeProxy(s) {
  s = String(s == null ? "" : s).trim();
  if (!s) return "";
  if (/^(https?|socks5h?):\/\//i.test(s)) return s;
  const p = s.split(":");
  if (p.length === 4) return `http://${p[2]}:${p[3]}@${p[0]}:${p[1]}`;
  if (p.length === 2) return `http://${p[0]}:${p[1]}`;
  return "http://" + s;
}

/** Texto con proxies separadas por saltos de línea, espacios o comas → lista única normalizada. */
function parseProxyList(text) {
  if (!text) return [];
  const noComments = String(text).split(/\r?\n/).filter((line) => !line.trim().startsWith("#")).join("\n");
  const list = noComments.split(/[\r\n\s,]+/).map((s) => s.trim()).filter(Boolean).map(normalizeProxy).filter(Boolean);
  return [...new Set(list)];
}

/** Oculta usuario y clave para logs. */
function maskProxy(p) {
  try { const u = new URL(p); if (u.username) { u.username = "***"; u.password = "***"; } return u.href; }
  catch (e) { return String(p).replace(/\/\/[^@]+@/, "//***:***@"); }
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

module.exports = { normalizeProxy, parseProxyList, maskProxy, shuffle };

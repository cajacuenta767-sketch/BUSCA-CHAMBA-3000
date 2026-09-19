"use strict";
/** Cliente HTTP mínimo (sin dependencias): GET texto, POST JSON, descarga de página con redirecciones y test de proxy. */
const http = require("http");
const https = require("https");

function libFor(u) { return u.protocol === "http:" ? http : https; }

function httpGet(url, { timeout = 12000 } = {}) {
  return new Promise((res) => {
    let u; try { u = new URL(url); } catch (e) { return res(""); }
    try {
      const req = libFor(u).request({ hostname: u.hostname, port: u.port || (u.protocol === "http:" ? 80 : 443), path: u.pathname + u.search, method: "GET", timeout, headers: { "User-Agent": "Mozilla/5.0" } },
        (r) => { let b = ""; r.on("data", (d) => (b += d)); r.on("end", () => res(b)); });
      req.on("error", () => res("")); req.on("timeout", () => { req.destroy(); res(""); }); req.end();
    } catch (e) { res(""); }
  });
}

function httpsPost(url, obj, { timeout = 9000 } = {}) {
  return new Promise((res) => {
    try {
      const u = new URL(url), data = JSON.stringify(obj);
      const req = https.request({ hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }, timeout },
        (r) => { let b = ""; r.on("data", (d) => (b += d)); r.on("end", () => res({ status: r.statusCode, body: b.slice(0, 300) })); });
      req.on("error", (e) => res({ error: String(e) })); req.on("timeout", () => { req.destroy(); res({ error: "timeout" }); });
      req.write(data); req.end();
    } catch (e) { res({ error: String(e) }); }
  });
}

/** Descarga HTML (máx 300 KB, 3 redirecciones, 9 s). Devuelve "" si falla. */
function fetchPage(url, redirects = 0) {
  return new Promise((res) => {
    if (redirects > 3) return res("");
    let u; try { u = new URL(url); } catch (e) { return res(""); }
    try {
      const req = libFor(u).request({ hostname: u.hostname, port: u.port || (u.protocol === "https:" ? 443 : 80), path: (u.pathname || "/") + (u.search || ""), method: "GET", timeout: 9000, headers: { "User-Agent": "Mozilla/5.0 (compatible; BuscaChamba/1.0)", Accept: "text/html,*/*" } }, (r) => {
        if ([301, 302, 303, 307, 308].includes(r.statusCode) && r.headers.location) { r.destroy(); return res(fetchPage(new URL(r.headers.location, url).href, redirects + 1)); }
        if (r.statusCode !== 200) { r.destroy(); return res(""); }
        let b = "", n = 0;
        r.on("data", (d) => { n += d.length; if (n > 300000) { r.destroy(); return; } b += d; });
        r.on("end", () => res(b)); r.on("close", () => res(b));
      });
      req.on("error", () => res("")); req.on("timeout", () => { req.destroy(); res(""); }); req.end();
    } catch (e) { res(""); }
  });
}

/** Prueba una proxy HTTP contra google.com/generate_204. Soporta usuario:clave. */
function testProxy(proxy, { timeout = 3000 } = {}) {
  return new Promise((res) => {
    let u; try { u = new URL(/^\w+:\/\//.test(proxy) ? proxy : `http://${proxy}`); } catch (e) { return res(false); }
    const headers = { Host: "www.google.com", "User-Agent": "Mozilla/5.0" };
    if (u.username && u.password) headers["Proxy-Authorization"] = "Basic " + Buffer.from(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`).toString("base64");
    try {
      const req = http.request({ hostname: u.hostname, port: +u.port || 80, path: "http://www.google.com/generate_204", method: "GET", headers, timeout }, (r) => {
        const ok = r.statusCode === 204 || r.statusCode === 200; r.destroy(); res(ok);
      });
      req.on("error", () => res(false)); req.on("timeout", () => { req.destroy(); res(false); }); req.end();
    } catch (e) { res(false); }
  });
}

module.exports = { httpGet, httpsPost, fetchPage, testProxy };

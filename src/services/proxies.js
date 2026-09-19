"use strict";
/**
 * Proxies: las del backend (env PROXIES → data/proxies.txt → proxies.txt → Ajustes) con caché de 5 s,
 * y la descarga + prueba de listas públicas (opcional; ver riesgos en el README).
 */
const fs = require("fs");
const { parseProxyList } = require("../domain/proxy");

const PUBLIC_SOURCES = [
  "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt",
  "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks5.txt",
  "https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-raw.txt",
  "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt",
  "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks5.txt",
  "https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/http.txt",
  "https://raw.githubusercontent.com/mmpx12/proxy-list/master/http.txt",
  "https://raw.githubusercontent.com/hookzof/socks5_list/master/proxy.txt",
  "https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/protocols/http/data.txt",
  "https://api.proxyscrape.com/v2/?request=getproxies&protocol=http&timeout=8000&country=all&ssl=all&anonymity=all",
  "https://www.proxy-list.download/api/v1/get?type=http",
  "https://openproxylist.xyz/http.txt",
];

class ProxyService {
  constructor({ env, settings, http, log, cacheMs = 5000 }) {
    this.env = env; this.settings = settings; this.http = http; this.log = log || (() => {});
    this.cacheMs = cacheMs; this._cache = null; this._cacheAt = 0;
  }

  /** Lista efectiva de proxies del backend. Lee archivos como máximo cada `cacheMs`. */
  backendProxies() {
    const now = Date.now();
    if (this._cache && now - this._cacheAt < this.cacheMs) return this._cache;
    let list = [];
    for (const f of [this.env.files.proxies, this.env.files.rootProxies]) {
      try { if (fs.existsSync(f)) { list = parseProxyList(fs.readFileSync(f, "utf8")); if (list.length) break; } } catch (e) { /* siguiente */ }
    }
    if (!list.length) list = parseProxyList(this.settings.get("proxies"));
    this._cache = list; this._cacheAt = now;
    return list;
  }
  invalidate() { this._cache = null; }

  /** Al arrancar: si Ajustes no tiene proxies, siembra desde env PROXIES o proxies.txt. */
  seed() {
    const current = this.settings.get("proxies");
    if (current && current.trim()) return;
    let seed = "";
    if (this.env.PROXIES_ENV.trim()) seed = this.env.PROXIES_ENV.replace(/[;,]+/g, "\n");
    else {
      try {
        const f = fs.existsSync(this.env.files.proxies) ? this.env.files.proxies : this.env.files.rootProxies;
        if (fs.existsSync(f)) seed = fs.readFileSync(f, "utf8");
      } catch (e) { /* sin archivo */ }
    }
    seed = (seed || "").split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith("#")).join("\n");
    if (seed) {
      this.settings.set("proxies", seed);
      this.invalidate();
      this.log("Proxies cargadas del backend (" + seed.split("\n").length + ") desde " + (this.env.PROXIES_ENV ? "env PROXIES" : "proxies.txt"));
    }
  }

  /** Comprueba una muestra (3) de la lista: basta con que una responda. */
  async anyAlive(list, sample = 3) {
    const checks = await Promise.all(list.slice(0, sample).map((p) => this.http.testProxy(p, { timeout: 3000 })));
    return checks.some(Boolean);
  }

  async fetchPublicList() {
    const set = new Set();
    await Promise.all(PUBLIC_SOURCES.map(async (s) => {
      const t = await this.http.httpGet(s);
      (t.match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d{2,5}\b/g) || []).forEach((p) => set.add(p));
    }));
    return [...set].slice(0, 12000);
  }

  /** Descarga listas públicas y prueba en lotes de 50 hasta 250 vivas o 75 s. */
  async fetchAndTest() {
    const list = await this.fetchPublicList();
    const working = [];
    const batch = 50, deadline = Date.now() + 75000;
    for (let i = 0; i < list.length && working.length < 250 && Date.now() < deadline; i += batch) {
      const chunk = list.slice(i, i + batch);
      const ok = await Promise.all(chunk.map((p) => this.http.testProxy(p, { timeout: 5000 })));
      chunk.forEach((p, j) => { if (ok[j]) working.push("http://" + p); });
    }
    this.log(`Proxies: ${working.length} vivas de ${list.length} candidatas`);
    if (working.length) { this.settings.set("proxies", working.join("\n")); this.invalidate(); }
    return { total: list.length, working };
  }
}

module.exports = { ProxyService, PUBLIC_SOURCES };

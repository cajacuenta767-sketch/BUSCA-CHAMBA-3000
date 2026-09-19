"use strict";
const { EventEmitter } = require("events");
const path = require("path");
const os = require("os");
const fs = require("fs");
const { Settings } = require("../src/config/settings");

/** Entorno de pruebas apuntando a un directorio temporal. */
function testEnv(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bc3-test-"));
  return Object.assign({
    ROOT: path.resolve(__dirname, ".."), DATA_DIR: dir, PORT: 0, HOST: "127.0.0.1", BASIC_AUTH: "", SCRAPER_BIN: "", SCRAPER_MODE: "binary",
    DB_DRIVER: "sqlite", PROXIES_ENV: "", MAX_BODY_BYTES: 1024 * 1024,
    files: { dashboard: path.resolve(__dirname, "..", "dashboard.html"), dbJson: path.join(dir, "db.json"), dbSqlite: ":memory:", config: path.join(dir, "config.json"), queries: path.join(dir, "q.txt"), cellCsv: path.join(dir, "cell.csv"), proxies: path.join(dir, "proxies.txt"), rootProxies: path.join(dir, "root-proxies.txt") },
  }, overrides);
}

/** Ajustes rápidos para tests (pausas mínimas, sin archivo). */
function fastSettings(extra = {}) {
  const s = new Settings();
  s.update(Object.assign({ pauseMin: 0.05, pauseMax: 0.05, cellMax: 1, inactivity: 25 }, extra));
  return s;
}

/**
 * Runner falso: en vez de lanzar el scraper devuelve un proceso simulado que
 * "escribe" el CSV indicado y termina en `exitAfterMs`.
 */
class FakeRunner {
  constructor({ csvByCell = () => "", exitAfterMs = 20, stderr = "" } = {}) {
    this.csvByCell = csvByCell; this.exitAfterMs = exitAfterMs; this.stderrText = stderr;
    this.jobs = []; this.killed = 0; this.current = null;
  }
  start(job) {
    this.jobs.push(job);
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    child.pid = 1000 + this.jobs.length;
    this.current = job;
    child._t = setTimeout(() => { if (this.stderrText) child.stderr.emit("data", Buffer.from(this.stderrText)); child.emit("exit", 0); }, this.exitAfterMs);
    return { child };
  }
  readCellCsv() { return this.current ? this.csvByCell(this.current) : ""; }
  kill(child) { this.killed++; clearTimeout(child._t); }
}

const CSV_HEADER = "title,category,address,phone,website,emails,review_rating,review_count,latitude,longitude,link,place_id\n";
function csvRow(i, extra = {}) {
  const o = Object.assign({ title: "Negocio " + i, category: "Farmacia", address: "Calle " + i + ", Lima", phone: "+51 9" + (10000000 + i), website: "", emails: "", rating: "4.5", reviews: String(10 + i), lat: "-12.05", lon: "-77.04", link: "https://maps.google.com/?cid=" + i, place_id: "pid" + i }, extra);
  return [o.title, o.category, `"${o.address}"`, o.phone, o.website, o.emails, o.rating, o.reviews, o.lat, o.lon, o.link, o.place_id].join(",") + "\n";
}

/** Temporizadores acelerados (los backoffs de segundos duran milisegundos). */
function fastTimers(scale = 50) {
  return { setTimeout: (fn, ms) => setTimeout(fn, Math.max(1, ms / scale)), clearTimeout, setInterval: (fn, ms) => setInterval(fn, Math.max(1, ms / scale)), clearInterval };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, { timeout = 5000, step = 20 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { if (fn()) return true; await wait(step); }
  throw new Error("waitFor: tiempo agotado");
}

module.exports = { testEnv, fastSettings, FakeRunner, CSV_HEADER, csvRow, wait, waitFor, fastTimers };

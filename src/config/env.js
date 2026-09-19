"use strict";
/**
 * Variables de entorno y rutas del sistema.
 * Único lugar donde se lee `process.env`; el resto del código recibe este objeto.
 */
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, "data");

module.exports = Object.freeze({
  ROOT,
  DATA_DIR,
  PORT: Number(process.env.PORT) || 8090,
  HOST: process.env.HOST || "0.0.0.0",
  BASIC_AUTH: process.env.BASIC_AUTH || "",
  SCRAPER_BIN: process.env.SCRAPER_BIN || "",
  SCRAPER_MODE: process.env.SCRAPER_MODE === "docker" ? "docker" : "binary",
  /** auto → SQLite si `node:sqlite` está disponible, si no JSON. También: "sqlite" | "json". */
  DB_DRIVER: (process.env.DB_DRIVER || "auto").toLowerCase(),
  PROXIES_ENV: process.env.PROXIES || "",
  MAX_BODY_BYTES: Number(process.env.MAX_BODY_BYTES) || 1024 * 1024,
  files: Object.freeze({
    dashboard: path.join(ROOT, "dashboard.html"),
    dbJson: path.join(DATA_DIR, "db.json"),
    dbSqlite: path.join(DATA_DIR, "busca-chamba.sqlite"),
    config: path.join(DATA_DIR, "config.json"),
    queries: path.join(DATA_DIR, "q.txt"),
    cellCsv: path.join(DATA_DIR, "cell.csv"),
    proxies: path.join(DATA_DIR, "proxies.txt"),
    rootProxies: path.join(ROOT, "proxies.txt"),
  }),
});

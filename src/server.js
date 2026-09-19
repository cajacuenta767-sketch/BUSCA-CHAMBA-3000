#!/usr/bin/env node
"use strict";
/*
 * BUSCA-CHAMBA-3000 — servidor local (sin dependencias npm)
 * Orquesta el escaneo por CUADRÍCULA (celda por celda, mapa en vivo), transmite leads (SSE),
 * y opcionalmente los reenvía a Telegram / webhook.
 *
 * Uso:  node server.js            → http://localhost:8090
 * Env:  PORT, BASIC_AUTH="usuario:clave", SCRAPER_BIN, SCRAPER_MODE=docker, DB_DRIVER=auto|sqlite|json, DATA_DIR, PROXIES
 */
const env = require("./config/env");
const { createApp } = require("./app");

process.on("uncaughtException", (err) => console.error("⚠️ Uncaught exception:", err));
process.on("unhandledRejection", (err) => console.error("⚠️ Unhandled rejection:", err));

const app = createApp({ env });
app.proxies.seed();
app.start().then(() => {
  console.log(`BUSCA-CHAMBA-3000 → http://localhost:${env.PORT}  (${app.store.countLeads()} leads · ${app.store.driver} · ${app.proxies.backendProxies().length} proxies backend activos${env.BASIC_AUTH ? " · con login" : ""})`);
  app.scanner.autoResume();
});

const shutdown = (sig) => { console.log(`\n${sig}: cerrando...`); app.stop().then(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); };
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

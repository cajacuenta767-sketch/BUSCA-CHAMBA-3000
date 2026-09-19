"use strict";
/**
 * Raíz de composición: construye cada pieza con sus dependencias y devuelve la app.
 * Nada aquí es global: se puede crear más de una app (tests) con distinto env.
 */
const http = require("http");
const fs = require("fs");
const { Logger } = require("./infra/logger");
const httpClient = require("./infra/http-client");
const { ScraperRunner } = require("./infra/scraper-runner");
const { createStore } = require("./infra/storage");
const { Settings } = require("./config/settings");
const { EventBus } = require("./services/event-bus");
const { Notifier } = require("./services/notifier");
const { ProxyService } = require("./services/proxies");
const { Enricher } = require("./services/enricher");
const { Scanner } = require("./services/scanner");
const { DemoGenerator } = require("./services/demo");
const { buildRoutes } = require("./http/routes");
const { sendJson, readJsonBody, makeAuth, handlePreflight } = require("./http/middleware");

function createApp({ env, overrides = {} } = {}) {
  fs.mkdirSync(env.DATA_DIR, { recursive: true });
  const logger = overrides.logger || new Logger({ echo: !!overrides.echoLogs });
  const log = (s) => logger.log(s);
  const settings = overrides.settings || new Settings({ file: env.files.config, log });
  const store = overrides.store || createStore({ env, log });
  const bus = overrides.bus || new EventBus();
  const httpc = overrides.httpClient || httpClient;
  const notifier = new Notifier({ settings, httpsPost: httpc.httpsPost });
  const proxies = new ProxyService({ env, settings, http: httpc, log });
  const runner = overrides.runner || new ScraperRunner({ env });
  const enricher = new Enricher({ store, bus, log, fetchPage: httpc.fetchPage });
  const scanner = new Scanner({ store, bus, settings, runner, proxies, notifier, log, demo: new DemoGenerator() });

  const app = { env, logger, settings, store, bus, notifier, proxies, runner, enricher, scanner, httpc };
  const router = buildRoutes(app);
  const auth = makeAuth(env.BASIC_AUTH);

  const server = http.createServer(async (req, res) => {
    try {
      if (handlePreflight(req, res)) return;
      if (!auth(req, res)) return;
      const url = new URL(req.url, "http://localhost");
      const handler = router.match(req.method, url.pathname);
      if (!handler) return sendJson(res, { error: router.pathExists(url.pathname) ? "método no permitido" : "not found" }, router.pathExists(url.pathname) ? 405 : 404);
      const ctx = { req, res, url, body: () => readJsonBody(req, env.MAX_BODY_BYTES) };
      const out = await handler(ctx);
      if (out !== undefined && !res.headersSent) sendJson(res, out);
    } catch (e) {
      log("HTTP " + req.method + " " + req.url + " → " + (e && e.message));
      if (!res.headersSent) sendJson(res, { error: e.status ? e.message : "error interno" }, e.status || 500);
      else { try { res.end(); } catch (_) { /* cerrado */ } }
    }
  });

  app.server = server;
  app.start = (port = env.PORT, host = env.HOST) => new Promise((resolve) => server.listen(port, host, () => resolve(server.address())));
  app.stop = () => new Promise((resolve) => { scanner.close(); enricher.stop(); bus.close(); store.close(); server.close(() => resolve()); });
  return app;
}

module.exports = { createApp };

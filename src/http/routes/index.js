"use strict";
/**
 * Endpoints de la API. Cada handler recibe ctx = { req, res, url, body() } y devuelve
 * un objeto (→ JSON 200) o escribe la respuesta él mismo y devuelve undefined.
 */
const fs = require("fs");
const { Router } = require("../router");
const { sendText } = require("../middleware");
const { CATEGORIES } = require("../../config/categories");

function buildRoutes(app) {
  const { env, store, settings, bus, scanner, enricher, proxies, notifier, logger } = app;
  const r = new Router();

  // ---- Panel ----
  const dashboard = (ctx) => {
    let html;
    try { html = fs.readFileSync(env.files.dashboard); }
    catch (e) { return sendText(ctx.res, "dashboard.html no encontrado", 404); }
    ctx.res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0", Pragma: "no-cache", Expires: "0" });
    ctx.res.end(html);
  };
  r.get("/", dashboard).get("/dashboard.html", dashboard);

  // ---- Estado y datos ----
  r.get("/api/health", () => ({ ok: true, driver: store.driver, leads: store.countLeads(), scanning: scanner.running, uptime: Math.round(process.uptime()) }));
  r.get("/api/status", () => scanner.status());
  r.get("/api/leads", (ctx) => {
    const limit = Math.max(0, parseInt(ctx.url.searchParams.get("limit") || "0", 10) || 0);
    const offset = Math.max(0, parseInt(ctx.url.searchParams.get("offset") || "0", 10) || 0);
    return { status: scanner.status(), leads: store.listLeads({ offset, limit }), total: store.countLeads(), cells: scanner.cellsView(), categories: CATEGORIES, history: store.history() };
  });
  r.get("/api/stream", (ctx) => { bus.subscribe(ctx.req, ctx.res, { type: "status", data: scanner.status() }); });
  r.get("/api/logs", (ctx) => sendText(ctx.res, logger.text()));

  // ---- Escaneo ----
  r.post("/api/scan/start", async (ctx) => scanner.start(await ctx.body()));
  r.post("/api/scan/pause", () => scanner.pause());
  r.post("/api/scan/resume", () => scanner.resume());
  r.post("/api/scan/stop", () => scanner.stop());

  // ---- Leads ----
  r.post("/api/lead/update", async (ctx) => {
    const b = await ctx.body();
    const meta = store.updateLeadMeta(b.id, b.patch || {});
    if (!meta) return { error: "no existe" };
    bus.broadcast("update", { id: b.id, meta });
    return { ok: true };
  });
  r.post("/api/reset", () => {
    scanner.discard();
    store.resetLeads();
    bus.broadcast("reset", {});
    return { ok: true };
  });

  // ---- Ajustes e integraciones ----
  r.get("/api/config", () => settings.publicView());
  r.post("/api/config", async (ctx) => { const changed = settings.update(await ctx.body()); if (changed.includes("proxies")) proxies.invalidate(); return { ok: true }; });
  r.post("/api/test-telegram", async (ctx) => {
    const b = await ctx.body();
    if (b && typeof b.telegramToken === "string" && b.telegramToken) settings.update({ telegramToken: b.telegramToken, telegramChat: b.telegramChat || settings.get("telegramChat") });
    return notifier.sendTelegram("✅ BUSCA-CHAMBA-3000 conectado. Aquí te llegarán los leads nuevos.");
  });
  r.post("/api/proxies/fetch", async () => { const out = await proxies.fetchAndTest(); return { total: out.total, working: out.working.length, proxies: out.working.join("\n") }; });

  // ---- Enriquecer ----
  r.post("/api/enrich", () => enricher.start());
  r.post("/api/enrich/stop", () => enricher.stop());

  return r;
}

module.exports = { buildRoutes };

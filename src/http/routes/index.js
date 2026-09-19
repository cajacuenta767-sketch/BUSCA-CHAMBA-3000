"use strict";
/**
 * Endpoints de la API. Cada handler recibe ctx = { req, res, url, body() } y devuelve
 * un objeto (→ JSON 200) o escribe la respuesta él mismo y devuelve undefined.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Router } = require("../router");
const { sendText, sendJson } = require("../middleware");
const { CATEGORIES } = require("../../config/categories");
const taxonomy = require("../../domain/taxonomy");
const insights = require("../../domain/insights");

function buildRoutes(app) {
  const { env, store, settings, bus, scanner, enricher, proxies, notifier, logger, httpc } = app;
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

  // ---- Estáticos: /public/* (fuentes de marca, etc.). Solo archivos dentro de public/. ----
  const MIME = { ".ttf": "font/ttf", ".woff2": "font/woff2", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".txt": "text/plain; charset=utf-8" };
  const PUBLIC = path.join(env.ROOT, "public");
  r.prefix("GET", "/public/", (ctx) => {
    const rel = decodeURIComponent(ctx.url.pathname.slice("/public/".length));
    const file = path.normalize(path.join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return sendJson(ctx.res, { error: "not found" }, 404);
    ctx.res.writeHead(200, { "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": "public, max-age=604800", "Access-Control-Allow-Origin": "*" });
    fs.createReadStream(file).pipe(ctx.res);
  });

  // ---- Foto del negocio para el PDF: proxy con lista blanca y caché en disco (evita CORS) ----
  const IMG_HOSTS = /(^|\.)(googleusercontent\.com|ggpht\.com|gstatic\.com|googleapis\.com)$/i;
  const IMG_CACHE = path.join(env.DATA_DIR, "cache", "img");
  r.get("/api/img", async (ctx) => {
    const u = ctx.url.searchParams.get("u") || "";
    let url; try { url = new URL(u); } catch (e) { return sendJson(ctx.res, { error: "url inválida" }, 400); }
    if (url.protocol !== "https:" || !IMG_HOSTS.test(url.hostname)) return sendJson(ctx.res, { error: "host no permitido" }, 403);
    fs.mkdirSync(IMG_CACHE, { recursive: true });
    const key = crypto.createHash("sha1").update(u).digest("hex"), file = path.join(IMG_CACHE, key);
    let buf = null, type = "image/jpeg";
    if (fs.existsSync(file)) { buf = fs.readFileSync(file); try { type = fs.readFileSync(file + ".type", "utf8"); } catch (e) { /* jpeg */ } }
    else {
      const got = await httpc.fetchBinary(u, { timeout: 10000, maxBytes: 2 * 1024 * 1024 });
      if (!got || !got.buf) return sendJson(ctx.res, { error: "no disponible" }, 502);
      buf = got.buf; type = got.type || type;
      try { fs.writeFileSync(file, buf); fs.writeFileSync(file + ".type", type); } catch (e) { /* sin caché */ }
    }
    ctx.res.writeHead(200, { "Content-Type": type, "Cache-Control": "public, max-age=86400", "Access-Control-Allow-Origin": "*" });
    ctx.res.end(buf);
  });

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

  // ---- Inteligencia de la propuesta ----
  r.get("/api/taxonomy", () => ({ verticals: taxonomy.VERTICALS, groups: taxonomy.GROUPS, rules: taxonomy.RULES.map((x) => ({ label: x[1], vertical: x[2], group: x[3] })), counts: store.categoryCounts() }));
  r.get("/api/insights", (ctx) => {
    const id = ctx.url.searchParams.get("id") || "";
    const lead = store.getLead(id);
    if (!lead) return sendJson(ctx.res, { error: "no existe" }, 404);
    const peers = store.listLeadsByCatKey(taxonomy.categoryKey(lead.category));
    const r = insights.analyze(lead, peers);
    return { id, ok: r.ok, reason: r.reason || null, cat: r.cat, stats: r.stats, insights: r.insights, anchor: r.anchor };
  });

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

"use strict";
/**
 * Ajustes del usuario (persisten en data/config.json).
 * Valida y normaliza lo que llega de la API; expone una vista pública sin secretos.
 */
const fs = require("fs");

const DEFAULTS = Object.freeze({
  telegramToken: "", telegramChat: "", webhookUrl: "", proxies: "", leadsdbKey: "",
  notify: false, safeMode: true, pauseMin: 3, pauseMax: 8, depth: 0, maxBlocks: 4,
  subdivide: true, subdivideAt: 90, exclude: "", maxLeads: 0, retryFailed: true,
  cellMax: 6, conc: 1, inactivity: 20,
});

const STRING_KEYS = ["telegramToken", "telegramChat", "webhookUrl", "proxies", "leadsdbKey", "exclude"];
const NUMBER_KEYS = ["pauseMin", "pauseMax", "depth", "maxBlocks", "subdivideAt", "maxLeads", "cellMax", "conc", "inactivity"];
const BOOL_KEYS = ["notify", "safeMode", "subdivide", "retryFailed"];

class Settings {
  /** @param {{file?:string, log?:(s:string)=>void}} opts */
  constructor({ file, log } = {}) {
    this.file = file;
    this.log = log || (() => {});
    this.values = Object.assign({}, DEFAULTS, file ? readJson(file) : {});
  }

  get(key) { return this.values[key]; }
  all() { return Object.assign({}, this.values); }

  /** Aplica un parche validado (misma semántica que POST /api/config). Devuelve las claves cambiadas. */
  update(patch) {
    const changed = [];
    if (!patch || typeof patch !== "object") return changed;
    for (const k of STRING_KEYS) if (typeof patch[k] === "string") { this.values[k] = patch[k]; changed.push(k); }
    for (const k of NUMBER_KEYS) if (typeof patch[k] === "number" && Number.isFinite(patch[k]) && patch[k] >= 0) { this.values[k] = patch[k]; changed.push(k); }
    for (const k of BOOL_KEYS) if (patch[k] !== undefined) { this.values[k] = !!patch[k]; changed.push(k); }
    if (changed.length) this.save();
    return changed;
  }

  set(key, value) { this.values[key] = value; this.save(); }

  /** Vista para el panel: nunca expone el token de Telegram ni la API key. */
  publicView() {
    const c = this.values;
    return {
      telegramChat: c.telegramChat, hasToken: !!c.telegramToken, webhookUrl: c.webhookUrl, proxies: c.proxies,
      notify: !!c.notify, leadsdb: !!c.leadsdbKey, safeMode: c.safeMode !== false, pauseMin: c.pauseMin, pauseMax: c.pauseMax,
      exclude: c.exclude || "", maxLeads: c.maxLeads || 0, retryFailed: c.retryFailed !== false, conc: c.conc || 1,
      inactivity: c.inactivity || 20, cellMax: c.cellMax || 6,
    };
  }

  save() {
    if (!this.file) return;
    try { fs.writeFileSync(this.file, JSON.stringify(this.values)); }
    catch (e) { this.log("No pude guardar config: " + e.message); }
  }
}

function readJson(file) {
  try {
    const raw = fs.readFileSync(file, "utf8");
    const parsed = raw && raw.trim() ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (e) { return {}; }
}

module.exports = { Settings, DEFAULTS };

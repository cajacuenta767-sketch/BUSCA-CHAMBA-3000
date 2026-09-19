"use strict";
/** Router mínimo: método + ruta exacta → handler(ctx). Si el handler devuelve un valor, se responde como JSON. */
class Router {
  constructor() { this.routes = new Map(); }
  add(method, path, handler) { this.routes.set(method + " " + path, handler); return this; }
  get(path, h) { return this.add("GET", path, h); }
  post(path, h) { return this.add("POST", path, h); }
  /** Ruta por prefijo (p. ej. estáticos). */
  prefix(method, pre, handler) { (this.prefixes = this.prefixes || []).push({ method, pre, handler }); return this; }
  match(method, path) {
    const exact = this.routes.get(method + " " + path);
    if (exact) return exact;
    for (const p of this.prefixes || []) if (p.method === method && path.startsWith(p.pre)) return p.handler;
    return null;
  }
  /** Verdadero si la ruta existe con otro método (para responder 405 en vez de 404). */
  pathExists(path) { for (const k of this.routes.keys()) if (k.endsWith(" " + path)) return true; return false; }
}
module.exports = { Router };

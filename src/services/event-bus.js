"use strict";
/**
 * Bus de eventos en tiempo real: los servicios emiten, el panel escucha por SSE.
 * Desacopla "algo pasó" de "cómo se transmite": internamente es un EventEmitter,
 * así cualquier módulo (o test) puede suscribirse sin abrir una conexión HTTP.
 */
const { EventEmitter } = require("events");

class EventBus extends EventEmitter {
  constructor({ pingMs = 25000 } = {}) {
    super();
    this.setMaxListeners(0);
    this.clients = new Set();
    this._ping = setInterval(() => this._write(": ping\n\n"), pingMs);
    if (this._ping.unref) this._ping.unref();
  }

  /** Emite a suscriptores internos y a todos los clientes SSE. */
  broadcast(type, data) {
    if (type !== "error" || this.listenerCount("error")) this.emit(type, data);
    this.emit("*", type, data);
    this._write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  _write(chunk) {
    for (const res of [...this.clients]) {
      try { res.write(chunk, (err) => { if (err) this.clients.delete(res); }); }
      catch (e) { this.clients.delete(res); }
    }
  }

  /** Registra una respuesta HTTP como cliente SSE y envía el estado inicial. */
  subscribe(req, res, initial) {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "Access-Control-Allow-Origin": "*" });
    res.write("retry: 3000\n\n");
    if (initial) res.write(`event: ${initial.type}\ndata: ${JSON.stringify(initial.data)}\n\n`);
    this.clients.add(res);
    const drop = () => this.clients.delete(res);
    res.on("error", drop); req.on("close", drop); req.on("error", drop);
  }

  close() { clearInterval(this._ping); for (const r of this.clients) { try { r.end(); } catch (e) { /* cerrado */ } } this.clients.clear(); }
}

module.exports = { EventBus };

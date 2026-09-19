"use strict";
/**
 * Enriquecedor: visita la web propia de cada negocio (4 en paralelo) y saca correos y redes.
 * Corre aparte del escaneo para no frenarlo. Estado observable por SSE ("enrich", "leadup").
 */
const { extractEmails, cleanEmails, extractSocial, isOwnWebsite, leadId } = require("../domain/lead");

class Enricher {
  constructor({ store, bus, log, fetchPage, workers = 4 }) {
    this.store = store; this.bus = bus; this.log = log || (() => {}); this.fetchPage = fetchPage; this.workers = workers;
    this.state = null;
  }

  get running() { return !!(this.state && this.state.running); }

  start() {
    if (this.running) return { error: "Ya se está enriqueciendo." };
    this._run().catch((e) => this.log("Enriquecer falló: " + e.message));
    return { ok: true };
  }

  stop() { if (this.state) this.state.running = false; return { ok: true }; }

  async _run() {
    const pending = this.store.listLeads().filter((l) => isOwnWebsite(l.website) && !l._enr);
    this.state = { total: pending.length, done: 0, mails: 0, socs: 0, running: true };
    this.bus.broadcast("enrich", this.state);
    this.log("Enriquecer: " + pending.length + " negocios con web propia");
    let idx = 0;
    const worker = async () => {
      while (this.state && this.state.running && idx < pending.length) {
        const l = pending[idx++];
        const html = await this.fetchPage(l.website);
        let changed = false;
        if (html) {
          const em = cleanEmails(extractEmails(html));
          if (em.length) { l.emails = [...new Set((l.emails || []).concat(em))].slice(0, 5); this.state.mails++; changed = true; }
          const so = extractSocial([html]);
          if (so.fb || so.ig || so.tt) { l.social = Object.assign({}, l.social, so); this.state.socs++; changed = true; }
        }
        l._enr = 1;
        this.store.saveLead(leadId(l), l);
        if (changed) this.bus.broadcast("leadup", l);
        this.state.done++;
        if (this.state.done % 5 === 0 || this.state.done === pending.length) this.bus.broadcast("enrich", this.state);
      }
    };
    await Promise.all(new Array(Math.min(this.workers, pending.length || 1)).fill(0).map(worker));
    if (this.state) { this.state.running = false; this.bus.broadcast("enrich", this.state); }
    this.store.flush();
    this.log("Enriquecer listo: " + (this.state ? this.state.mails : 0) + " con correo, " + (this.state ? this.state.socs : 0) + " con redes");
  }
}

module.exports = { Enricher };

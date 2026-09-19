"use strict";
/** Avisos de leads nuevos a Telegram (cola con 1.3 s entre mensajes) y a un webhook HTTPS. */
const escapeHtml = (s) => String(s || "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

class Notifier {
  constructor({ settings, httpsPost, delayMs = 1300 }) {
    this.settings = settings; this.httpsPost = httpsPost; this.delayMs = delayMs;
    this.queue = []; this.busy = false;
  }

  get telegramReady() { return !!(this.settings.get("telegramToken") && this.settings.get("telegramChat")); }

  sendTelegram(text) {
    if (!this.telegramReady) return Promise.resolve({ error: "Falta token o chat_id de Telegram." });
    return this.httpsPost(`https://api.telegram.org/bot${this.settings.get("telegramToken")}/sendMessage`,
      { chat_id: this.settings.get("telegramChat"), text, parse_mode: "HTML", disable_web_page_preview: true });
  }

  notifyLead(l) {
    if (this.settings.get("notify") && this.telegramReady) { this.queue.push(l); this._pump(); }
    const hook = this.settings.get("webhookUrl");
    if (hook && /^https:/.test(hook)) this.httpsPost(hook, l);
  }

  _pump() {
    if (this.busy || !this.queue.length) return;
    this.busy = true;
    const l = this.queue.shift();
    const txt = `🆕 <b>${escapeHtml(l.title)}</b>\n${escapeHtml(l.category || "")}${l.website ? "" : " · 🔥 SIN WEB"}\n${l.phone ? "📞 " + escapeHtml(l.phone) : "(sin teléfono)"}\n📍 ${escapeHtml(l.address || "")}\n${l.link || ""}`;
    this.sendTelegram(txt).then(() => setTimeout(() => { this.busy = false; this._pump(); }, this.delayMs));
  }

  scanFinished(found, cells) {
    if (this.settings.get("notify") && this.telegramReady) this.sendTelegram(`✅ Escaneo terminado: <b>${found}</b> negocios en ${cells} celdas.`);
  }
}

module.exports = { Notifier, escapeHtml };

"use strict";
/** Log en memoria (anillo de N líneas) que el panel puede descargar en /api/logs. */
class Logger {
  constructor({ max = 400, echo = false } = {}) { this.lines = []; this.max = max; this.echo = echo; }
  log(s) {
    const line = new Date().toISOString().slice(11, 19) + " " + s;
    this.lines.push(line);
    if (this.lines.length > this.max) this.lines.shift();
    if (this.echo) console.log(line);
  }
  text() { return this.lines.join("\n") || "(sin logs)"; }
}
module.exports = { Logger };

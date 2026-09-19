"use strict";
/**
 * Adaptador al binario gosom/google-maps-scraper (o su imagen Docker).
 * Traduce una "celda" a argumentos de línea de comandos y gestiona el proceso hijo.
 * Soporta varios trabajadores a la vez: cada `slot` escribe su propio CSV (cell.csv, cell-1.csv…).
 */
const fs = require("fs");
const path = require("path");
const { spawn, execSync } = require("child_process");

class ScraperRunner {
  constructor({ env }) { this.env = env; this._lastQueries = null; }

  csvPathFor(slot) { return slot ? path.join(this.env.DATA_DIR, `cell-${slot}.csv`) : this.env.files.cellCsv; }

  findBinary() {
    const { ROOT, SCRAPER_BIN } = this.env;
    if (SCRAPER_BIN && fs.existsSync(SCRAPER_BIN)) return SCRAPER_BIN;
    const candidates = [
      path.join(ROOT, "gms.exe"), path.join(ROOT, "google_maps_scraper.exe"), path.join(ROOT, "gms"),
      path.join(ROOT, "..", "google-maps-scraper", "gms.exe"), path.join(ROOT, "..", "google-maps-scraper", "gms"),
    ];
    return candidates.find((p) => fs.existsSync(p)) || null;
  }

  /**
   * @param {{slot?:number, bbox:number[], cellKm:number, queries:string[], proxies:string[], depth:number, concurrency:number, inactivitySec:number, leadsdbKey?:string}} job
   * @returns {{cmd:string,args:string[]}|{error:string}}
   */
  buildCommand(job) {
    const { files, DATA_DIR, SCRAPER_MODE } = this.env;
    const slot = job.slot || 0;
    const bb = job.bbox.map((x) => x.toFixed(5)).join(",");
    const radius = Math.max(500, Math.round(job.cellKm * 1000 * 0.7));
    const grid = ["-grid-bbox", bb, "-grid-cell", String(job.cellKm), "-radius", String(radius), "-zoom", "16"];
    // NOTA VELOCIDAD: el flag -email del scraper navega cada web con Chromium y congela la celda minutos.
    // Los correos se sacan aparte, en segundo plano, con el enriquecedor (/api/enrich).
    const extra = ["-c", String(job.concurrency)];
    if (job.proxies && job.proxies.length) extra.push("-proxies", job.proxies.join(","));
    if (job.leadsdbKey) extra.push("-leadsdb-api-key", job.leadsdbKey);
    extra.push("-depth", String(job.depth));
    const inactivity = job.inactivitySec + "s";
    if (SCRAPER_MODE === "docker") {
      const out = slot ? `/out/cell-${slot}.csv` : "/out/cell.csv";
      return { cmd: "docker", args: ["run", "--rm", "--name", `avendia-scraper-${slot}`, "--memory", "1200m", "--cpus", "1.5", "-v", `${DATA_DIR}:/out`, "-v", `${files.queries}:/queries.txt:ro`, "gosom/google-maps-scraper", "-input", "/queries.txt", "-results", out, "-lang", "es", "-exit-on-inactivity", inactivity, ...extra, ...grid] };
    }
    const bin = this.findBinary();
    if (!bin) return { error: "No encuentro 'gms'. Compílalo (go build), define SCRAPER_BIN o usa SCRAPER_MODE=docker." };
    return { cmd: bin, args: ["-input", files.queries, "-results", this.csvPathFor(slot), "-lang", "es", "-exit-on-inactivity", inactivity, ...extra, ...grid] };
  }

  /** Escribe las consultas (solo si cambiaron), vacía el CSV del slot y lanza el proceso. */
  start(job) {
    const { files, ROOT } = this.env;
    const q = job.queries.join("\n") + "\n";
    if (q !== this._lastQueries) { fs.writeFileSync(files.queries, q); this._lastQueries = q; }
    try { fs.writeFileSync(this.csvPathFor(job.slot || 0), ""); } catch (e) { /* se recrea al escribir */ }
    const cmd = this.buildCommand(job);
    if (cmd.error) return cmd;
    try { return { child: spawn(cmd.cmd, cmd.args, { cwd: ROOT }) }; }
    catch (e) { return { error: "No pude lanzar el scraper: " + e.message }; }
  }

  /**
   * Lee SOLO los bytes nuevos del CSV del slot desde `offset` (lectura incremental: O(nuevo) en vez de O(archivo)).
   * @returns {{buf:Buffer|null, next:number}}
   */
  readCellChunk(slot, offset) {
    let fd;
    try {
      fd = fs.openSync(this.csvPathFor(slot || 0), "r");
      const size = fs.fstatSync(fd).size;
      if (size < offset) offset = 0; // el archivo se vació (nuevo lanzamiento)
      if (size === offset) return { buf: null, next: offset };
      const buf = Buffer.allocUnsafe(size - offset);
      const n = fs.readSync(fd, buf, 0, buf.length, offset);
      return { buf: n === buf.length ? buf : buf.subarray(0, n), next: offset + n };
    } catch (e) { return { buf: null, next: offset }; }
    finally { if (fd !== undefined) { try { fs.closeSync(fd); } catch (e) { /* ya cerrado */ } } }
  }

  kill(child) {
    if (!child) return;
    try {
      if (process.platform === "win32" && child.pid) execSync(`taskkill /F /T /PID ${child.pid} 2>nul`, { stdio: "ignore" });
      else if (child.kill) child.kill("SIGKILL");
    } catch (e) { try { if (child.kill) child.kill("SIGKILL"); } catch (_) { /* ya murió */ } }
  }
}

module.exports = { ScraperRunner };

"use strict";
/**
 * Adaptador al binario gosom/google-maps-scraper (o su imagen Docker).
 * Traduce una "celda" a argumentos de línea de comandos y gestiona el proceso hijo.
 */
const fs = require("fs");
const path = require("path");
const { spawn, execSync } = require("child_process");

class ScraperRunner {
  constructor({ env }) { this.env = env; }

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
   * @param {{bbox:number[], cellKm:number, queries:string[], proxies:string[], depth:number, concurrency:number, inactivitySec:number, leadsdbKey?:string}} job
   * @returns {{cmd:string,args:string[]}|{error:string}}
   */
  buildCommand(job) {
    const { files, DATA_DIR, SCRAPER_MODE } = this.env;
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
      return { cmd: "docker", args: ["run", "--rm", "--name", "avendia-scraper", "--memory", "1200m", "--cpus", "1.5", "-v", `${DATA_DIR}:/out`, "-v", `${files.queries}:/queries.txt:ro`, "gosom/google-maps-scraper", "-input", "/queries.txt", "-results", "/out/cell.csv", "-lang", "es", "-exit-on-inactivity", inactivity, ...extra, ...grid] };
    }
    const bin = this.findBinary();
    if (!bin) return { error: "No encuentro 'gms'. Compílalo (go build), define SCRAPER_BIN o usa SCRAPER_MODE=docker." };
    return { cmd: bin, args: ["-input", files.queries, "-results", files.cellCsv, "-lang", "es", "-exit-on-inactivity", inactivity, ...extra, ...grid] };
  }

  /** Escribe las consultas, vacía el CSV de la celda y lanza el proceso. */
  start(job) {
    const { files, ROOT } = this.env;
    fs.writeFileSync(files.queries, job.queries.join("\n") + "\n");
    try { fs.writeFileSync(files.cellCsv, ""); } catch (e) { /* se recrea al escribir */ }
    const cmd = this.buildCommand(job);
    if (cmd.error) return cmd;
    try { return { child: spawn(cmd.cmd, cmd.args, { cwd: ROOT }) }; }
    catch (e) { return { error: "No pude lanzar el scraper: " + e.message }; }
  }

  readCellCsv() { try { return fs.readFileSync(this.env.files.cellCsv, "utf8"); } catch (e) { return ""; } }

  kill(child) {
    if (!child) return;
    try {
      if (process.platform === "win32" && child.pid) execSync(`taskkill /F /T /PID ${child.pid} 2>nul`, { stdio: "ignore" });
      else if (child.kill) child.kill("SIGKILL");
    } catch (e) { try { if (child.kill) child.kill("SIGKILL"); } catch (_) { /* ya murió */ } }
  }
}

module.exports = { ScraperRunner };

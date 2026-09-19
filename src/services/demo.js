"use strict";
/** Generador de negocios de ejemplo para el modo Demo (ver todo funcionando sin escanear). */
const NAMES = [["Botica ", "Farmacia", 0], ["Restaurante ", "Restaurante", 1], ["Barbería ", "Barbería", 0], ["Ferretería ", "Ferretería", 0], ["Gimnasio ", "Gimnasio", 1], ["Bodega ", "Bodega", 0], ["Dental ", "Clínica dental", 1], ["TecniCell ", "Taller de celulares", 0]];
const SUFFIXES = ["San Martín", "Central", "Los Andes", "El Sol", "Perú", "Miraflores", "Norte", "Express"];

class DemoGenerator {
  constructor() { this.n = 0; }
  /** Entre 1 y 3 leads dentro del bbox de la celda. */
  leadsFor(cell) {
    const k = 1 + Math.floor(Math.random() * 3);
    const out = [];
    for (let i = 0; i < k; i++) {
      const [pre, cat, web] = NAMES[this.n % NAMES.length];
      const lat = cell.bbox[0] + Math.random() * (cell.bbox[2] - cell.bbox[0]);
      const lon = cell.bbox[1] + Math.random() * (cell.bbox[3] - cell.bbox[1]);
      this.n++;
      const n = this.n;
      out.push({ title: pre + SUFFIXES[n % SUFFIXES.length], category: cat, address: "Calle Demo " + (100 + n) + ", Lima", phone: "+51 9" + (10000000 + (n * 137) % 89999999), website: web ? "https://demo" + n + ".pe" : "", emails: web ? ["demo" + n + "@mail.com"] : [], rating: 3.8 + Math.random() * 1.2, reviews: 10 + ((n * 37) % 900), lat, lon, link: "https://maps.google.com/demo/" + n, thumb: "", about: "Negocio de ejemplo para probar el panel.", images: [] });
    }
    return out;
  }
}

module.exports = { DemoGenerator };

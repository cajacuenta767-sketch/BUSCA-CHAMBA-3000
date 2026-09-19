"use strict";
/**
 * Cuadrícula geográfica: partir un área [sur, oeste, norte, este] en celdas de N km,
 * ordenarlas desde el centro, subdividir celdas densas y reconocer celdas ya barridas.
 * Todo puro: sin I/O.
 */
const KM_PER_DEG = 111;

function computeCells(area, cellKm) {
  const [s, w, n, e] = area;
  const latC = (s + n) / 2;
  const dLat = cellKm / KM_PER_DEG;
  const dLon = cellKm / (KM_PER_DEG * Math.cos((latC * Math.PI) / 180));
  const cells = [];
  for (let lat = s; lat < n; lat += dLat) {
    for (let lon = w; lon < e; lon += dLon) {
      const top = Math.min(lat + dLat, n), right = Math.min(lon + dLon, e);
      cells.push({ key: lat.toFixed(4) + "_" + lon.toFixed(4), bbox: [lat, lon, top, right], state: "pending", found: 0, km: cellKm, depth: 0 });
    }
  }
  return cells;
}

function splitCell(c) {
  const [s, w, n, e] = c.bbox;
  const mLat = (s + n) / 2, mLon = (w + e) / 2, km = (c.km || 1) / 2, depth = (c.depth || 0) + 1;
  return [[s, w, mLat, mLon], [s, mLon, mLat, e], [mLat, w, n, mLon], [mLat, mLon, n, e]]
    .map((bbox, i) => ({ key: c.key + "s" + i, bbox, state: "pending", found: 0, km, depth }));
}

function center(area) { return { lat: (area[0] + area[2]) / 2, lon: (area[1] + area[3]) / 2 }; }

/** Ordena in-place desde el centro del área hacia afuera (el usuario ve resultados útiles primero). */
function sortFromCenter(cells, area) {
  const c = center(area);
  const dist = (x) => Math.hypot((x.bbox[0] + x.bbox[2]) / 2 - c.lat, (x.bbox[1] + x.bbox[3]) / 2 - c.lon);
  return cells.sort((a, b) => dist(a) - dist(b));
}

/**
 * Área grande = auto-ajuste: sube el tamaño de celda hasta que el área entre en `cap` celdas.
 * @returns {{cells:object[], cellKm:number, adjusted:boolean, askedKm:number, tooBig:boolean}}
 */
function fitCells(area, requestedKm, cap = 550, maxKm = 25) {
  let cellKm = Math.max(0.2, requestedKm || 1);
  const askedKm = cellKm;
  let cells = computeCells(area, cellKm);
  let adjusted = false;
  while (cells.length > cap && cellKm < maxKm) {
    cellKm = Math.round((cellKm + (cellKm < 3 ? 0.3 : 1)) * 10) / 10;
    cells = computeCells(area, cellKm);
    adjusted = true;
  }
  return { cells, cellKm, adjusted, askedKm, tooBig: cells.length > cap };
}

/**
 * Marca como "done" las celdas cuya clave ya fue barrida o cuyo centro cae a menos de
 * 0.75·cellKm de una celda barrida (cubre cambios de tamaño de celda entre sesiones).
 * @returns {number} cuántas se marcaron
 */
function markScanned(cells, scannedKeys, cellKm, area) {
  if (!scannedKeys || !scannedKeys.length) return 0;
  const done = new Set(scannedKeys);
  const cLat = center(area).lat;
  const halfLat = cellKm / KM_PER_DEG / 2;
  const halfLon = cellKm / (KM_PER_DEG * Math.cos((cLat * Math.PI) / 180)) / 2;
  const points = scannedKeys.map((k) => { const p = k.split("_"); return { lat: +p[0] + halfLat, lon: +p[1] + halfLon }; });
  let count = 0;
  for (const c of cells) {
    if (done.has(c.key)) { c.state = "done"; count++; continue; }
    const lat = (c.bbox[0] + c.bbox[2]) / 2, lon = (c.bbox[1] + c.bbox[3]) / 2;
    const cosLat = Math.cos((lat * Math.PI) / 180);
    const near = points.some((sp) => Math.hypot((lat - sp.lat) * KM_PER_DEG, (lon - sp.lon) * KM_PER_DEG * cosLat) < cellKm * 0.75);
    if (near) { c.state = "done"; count++; }
  }
  return count;
}

const FINISHED = new Set(["done", "empty", "error"]);
function countFinished(cells) { return cells.reduce((n, c) => n + (FINISHED.has(c.state) ? 1 : 0), 0); }

module.exports = { computeCells, splitCell, sortFromCenter, fitCells, markScanned, countFinished, center };

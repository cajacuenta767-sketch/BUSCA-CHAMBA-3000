"use strict";
/**
 * Motor de comparación e insights: con qué competidores se compara un negocio, qué números salen
 * y qué frases (máximo 3, sin contradicciones) alimentan la propuesta y el mensaje.
 *
 * Reglas duras:
 *  - Solo se compara con el MISMO rubro normalizado (taxonomía). Nunca con "toda la base".
 *  - La zona es por distancia real: 2 km → 5 km → misma ciudad. Con < 5 negocios no hay ranking.
 *  - Dos rankings: visibilidad (reseñas) y calidad (calificación con promedio bayesiano).
 *    La propuesta usa el que favorece o motiva al negocio (`focus`).
 * Puro: sin I/O. Se incluye en dashboard.html mediante el build.
 */
const { isOwnWebsite } = require("./lead");
const T = require("./taxonomy");

const MIN_PEERS = 5;      // incluye al propio negocio
const RADII_KM = [2, 5];
const BAYES_M = 10;       // reseñas "de confianza" para el promedio bayesiano

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
const hasCoords = (l) => !!(l && Number(l.lat) && Number(l.lon));
const hasSocial = (l) => !!(l && l.social && (l.social.fb || l.social.ig || l.social.tt));
const hasPhone = (l) => !!(l && l.phone && String(l.phone).replace(/\D/g, "").length >= 7);
function cityOf(l) {
  if (!l) return "";
  if (l.city) return String(l.city).trim();
  const parts = String(l.address || "").split(",").map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}
const leadKey = (l) => l.place_id || l.link || (l.title + "|" + l.address);

/** Vocabulario por vertical para que las frases suenen al rubro y no a plantilla. */
const VOCAB = {
  farmacia: { cliente: "cliente", plural: "clientes", queja: "productos vencidos o que se acabaron" },
  taller_celulares: { cliente: "cliente", plural: "clientes", queja: "demoras y equipos que no se avisan cuando están listos" },
  restaurante: { cliente: "comensal", plural: "comensales", queja: "demoras y pedidos mal anotados" },
  dental: { cliente: "paciente", plural: "pacientes", queja: "citas cruzadas y esperas" },
  inmobiliaria: { cliente: "interesado", plural: "interesados", queja: "falta de seguimiento" },
  gimnasio: { cliente: "socio", plural: "socios", queja: "cobros y membresías mal llevadas" },
  bodega: { cliente: "cliente", plural: "clientes", queja: "productos que faltan y fiados olvidados" },
  ferreteria: { cliente: "cliente", plural: "clientes", queja: "cotizaciones lentas y stock que no cuadra" },
  hotel: { cliente: "huésped", plural: "huéspedes", queja: "reservas confusas y sobreventa" },
  belleza: { cliente: "cliente", plural: "clientes", queja: "horas cruzadas y esperas" },
  veterinaria: { cliente: "dueño de mascota", plural: "dueños de mascotas", queja: "vacunas que se olvidan" },
  contable: { cliente: "cliente", plural: "clientes", queja: "vencimientos que se pasan" },
  juridico: { cliente: "cliente", plural: "clientes", queja: "no saber cómo va el caso" },
};
const vocabOf = (v) => VOCAB[v] || { cliente: "cliente", plural: "clientes", queja: "demoras y errores al anotar" };

/** Índice por rubro normalizado; se construye una vez por lista de leads. */
function createIndex(leads) {
  const byKey = new Map();
  for (const l of leads || []) {
    const key = T.categoryKey(l.category);
    if (!key) continue;
    let g = byKey.get(key);
    if (!g) { g = []; byKey.set(key, g); }
    g.push(l);
  }
  return { byKey, size: (leads || []).length, memo: new WeakMap() };
}

/** Competidores: mismo rubro, por radio; si no alcanza, misma ciudad; si no, nada. */
function findPeers(lead, index) {
  const cat = T.classifyCategory(lead.category);
  if (!cat.key) return { level: "none", peers: [], cat, reason: "sin rubro" };
  const all = index.byKey.get(cat.key) || [];
  const me = leadKey(lead);
  const list = all.some((x) => x === lead || leadKey(x) === me) ? all : all.concat([lead]);
  if (hasCoords(lead)) {
    for (const r of RADII_KM) {
      const peers = list.filter((x) => x === lead || leadKey(x) === me || (hasCoords(x) && haversineKm(lead.lat, lead.lon, x.lat, x.lon) <= r));
      if (peers.length >= MIN_PEERS) return { level: "radius", radiusKm: r, peers, cat };
    }
  }
  const city = T.fold(cityOf(lead));
  if (city) {
    const peers = list.filter((x) => x === lead || leadKey(x) === me || T.fold(cityOf(x)) === city);
    if (peers.length >= MIN_PEERS) return { level: "city", city: cityOf(lead), peers, cat };
  }
  return { level: "none", peers: list, cat, reason: list.length < MIN_PEERS ? "pocos competidores" : "sin ubicación" };
}

function scopeLabel(f, n) {
  const what = n + " negocios de " + f.cat.label.toLowerCase();
  if (f.level === "radius") return what + " a menos de " + f.radiusKm + " km";
  if (f.level === "city") return what + " en " + f.city;
  return what;
}

function computeStats(lead, f) {
  const peers = f.peers, n = peers.length;
  const revs = peers.map((x) => +x.reviews || 0).sort((a, b) => a - b);
  const mine = +lead.reviews || 0, myR = +lead.rating || 0;
  const rated = peers.filter((x) => +x.rating > 0);
  const avgR = rated.length ? rated.reduce((s, x) => s + +x.rating, 0) / rated.length : 0;
  const avgRev = revs.reduce((s, v) => s + v, 0) / n;
  const medianRev = revs[Math.floor((n - 1) / 2)];
  const top = revs[n - 1] || 0;
  const bayes = (x) => { const v = +x.reviews || 0, r = +x.rating || 0; return v && r ? (v / (v + BAYES_M)) * r + (BAYES_M / (v + BAYES_M)) * avgR : 0; };
  const myQ = bayes(lead);
  const rankVis = revs.filter((v) => v > mine).length + 1;
  const rankQual = myQ ? peers.filter((x) => bayes(x) > myQ).length + 1 : null;
  const third = Math.ceil(n / 3);
  let focus = "crecimiento";
  if (rankVis <= third) focus = "visibilidad";
  else if (rankQual && (rankQual <= third || rankQual < rankVis)) focus = "calidad";
  const tierOf = (r) => (r == null ? null : r <= third ? "lider" : r <= 2 * third ? "medio" : "cola");
  const pct = (fn) => Math.round((100 * peers.filter(fn).length) / n);
  return {
    n, level: f.level, radiusKm: f.radiusKm || null, city: f.city || cityOf(lead), scope: scopeLabel(f, n),
    cat: f.cat.label, catKey: f.cat.key, vertical: f.cat.vertical,
    mine, myR, avgRev, medianRev, avgR, top,
    rank: rankVis, rankVis, rankQual, focus, tier: tierOf(rankVis), tierQual: tierOf(rankQual),
    pctNoWeb: pct((x) => !isOwnWebsite(x.website)), pctTel: pct(hasPhone), pctSoc: pct(hasSocial),
    pctBetter: Math.round((100 * revs.filter((v) => v < mine).length) / n),
    peers: peers.map((x) => ({ title: x.title, lat: +x.lat || 0, lon: +x.lon || 0, reviews: +x.reviews || 0, rating: +x.rating || 0, me: x === lead || leadKey(x) === leadKey(lead) })),
  };
}

/**
 * Reglas de insight. Cada grupo aporta como máximo una frase; se ordenan por prioridad y se
 * toman 3. Así nunca salen dos frases sobre reseñas que se contradigan.
 */
const RULES = [
  { id: "lider-resenas", group: "resenas", priority: 10, when: (S) => S.rankVis === 1 && S.mine > 0,
    text: (S, V) => `Es el negocio con más reseñas de ${S.scope.replace(/^\d+ negocios de /, "")}: ${S.mine} ${V.plural} lo recomendaron. Ese volumen es justo el que más se desordena cuando todo se anota a mano.` },
  { id: "sobre-promedio", group: "resenas", priority: 20, when: (S) => S.mine > S.avgRev && S.rankVis > 1,
    text: (S) => `Tiene ${S.mine} reseñas, ${Math.round(S.mine - S.avgRev)} más que el promedio de su zona (${Math.round(S.avgRev)}). Está en el puesto ${S.rankVis} de ${S.n}; el primero tiene ${S.top}.` },
  { id: "bajo-promedio", group: "resenas", priority: 30, when: (S) => S.mine <= S.avgRev && S.rankVis > 1,
    text: (S) => `Tiene ${S.mine} reseñas y el promedio de su zona es ${Math.round(S.avgRev)}. La diferencia no es de calidad: es que nadie pide la reseña después de atender. El sistema la pide solo, por WhatsApp.` },
  { id: "calidad-alta", group: "calidad", priority: 15, when: (S) => S.myR > 0 && S.avgR > 0 && S.myR >= S.avgR + 0.2,
    text: (S) => `Lo califican con ${S.myR.toFixed(1)} y a su zona con ${S.avgR.toFixed(1)}: la gente sale contenta. Lo que falta es que esa satisfacción se convierta en reseñas y en clientes que vuelven.` },
  { id: "calidad-baja", group: "calidad", priority: 25, when: (S) => S.myR > 0 && S.avgR > 0 && S.myR <= S.avgR - 0.2,
    text: (S, V) => `Su calificación es ${S.myR.toFixed(1)} y la de su zona ${S.avgR.toFixed(1)}. En este rubro casi toda la queja es por ${V.queja}: dos cosas que un sistema evita antes de que pasen.` },
  { id: "calidad-par", group: "calidad", priority: 40, when: (S) => S.myR > 0 && S.avgR > 0 && Math.abs(S.myR - S.avgR) < 0.2,
    text: (S) => `Su calificación (${S.myR.toFixed(1)}) está a la par de su zona (${S.avgR.toFixed(1)}). Quien se despegue va a ser el que deje de fallar en lo pequeño, y eso se ordena con sistema.` },
  { id: "competencia-sin-sistema", group: "competencia", priority: 22, when: (S) => S.pctNoWeb >= 50,
    text: (S) => `El ${S.pctNoWeb}% de los ${S.n} negocios de su rubro en su zona sigue sin sistema ni web propia: entrar ahora lo deja por delante de más de la mitad de su competencia directa.` },
  { id: "competencia-ordenandose", group: "competencia", priority: 35, when: (S) => S.pctNoWeb < 50,
    text: (S) => `Solo el ${S.pctNoWeb}% de su competencia sigue sin sistema: la mayoría ya se está ordenando, y quedarse con el cuaderno empieza a notarse en los ${100 - S.pctNoWeb}% restantes.` },
  { id: "sin-presencia", group: "presencia", priority: 28, when: (S, l) => !isOwnWebsite(l.website) && !hasSocial(l),
    text: () => `No encontramos web ni redes suyas: hoy el registro depende de la memoria y del cuaderno. Ahí es donde más dinero se escapa sin que se note.` },
  { id: "solo-redes", group: "presencia", priority: 32, when: (S, l) => !isOwnWebsite(l.website) && hasSocial(l),
    text: (S, V, l) => `Ya atiende por ${socialNames(l)}, así que los pedidos le llegan por chat y quedan sueltos entre mensajes. Un panel los junta con su estado: pendiente, entregado, pagado.` },
  { id: "canal-whatsapp", group: "canal", priority: 45, when: (S) => S.pctTel < 100 && S.pctTel > 0,
    text: (S) => `Solo el ${S.pctTel}% de esos negocios tiene un número por el que se pueda pedir por WhatsApp. Con sistema, su WhatsApp deja de ser un chat suelto y pasa a ser un canal de pedidos con registro.` },
];
function socialNames(l) {
  const s = l.social || {};
  return [s.fb && "Facebook", s.ig && "Instagram", s.tt && "TikTok"].filter(Boolean).join(", ");
}

function buildInsights(lead, S, max = 3) {
  const V = vocabOf(S.vertical);
  const used = new Set(), out = [];
  for (const r of RULES.slice().sort((a, b) => a.priority - b.priority)) {
    if (out.length >= max || used.has(r.group)) continue;
    if (!r.when(S, lead)) continue;
    used.add(r.group);
    out.push({ id: r.id, group: r.group, text: r.text(S, V, lead) });
  }
  return out;
}

/** Hecho real y corto (≤ 90 caracteres) para abrir un mensaje sin sonar a plantilla. */
function anchorFact(S) {
  if (!S) return null;
  if (S.rankVis === 1 && S.mine > 0) return `vi que son los más reseñados de su zona (${S.mine} reseñas en Google)`;
  if (S.focus === "visibilidad") return `vi que tienen ${S.mine} reseñas en Google, más que el promedio de su zona`;
  if (S.focus === "calidad" && S.myR) return `vi que los califican con ${S.myR.toFixed(1)} estrellas, por encima de su zona`;
  if (S.pctNoWeb >= 50) return `vi que el ${S.pctNoWeb}% de los negocios de su rubro en su zona sigue sin sistema`;
  return null;
}

/**
 * Análisis completo de un negocio contra su rubro y zona.
 * @param {object} lead
 * @param {object[]|{byKey:Map}} leadsOrIndex lista de leads o índice de createIndex()
 */
function analyze(lead, leadsOrIndex) {
  if (!lead) return { ok: false, stats: null, insights: [], anchor: null, reason: "sin negocio" };
  const index = leadsOrIndex && leadsOrIndex.byKey ? leadsOrIndex : createIndex(leadsOrIndex || []);
  const hit = index.memo.get(lead);
  if (hit) return hit;
  const f = findPeers(lead, index);
  let out;
  if (f.level === "none") out = { ok: false, stats: null, insights: [], anchor: null, reason: f.reason, cat: f.cat, candidates: f.peers.length };
  else {
    const stats = computeStats(lead, f);
    out = { ok: true, stats, insights: buildInsights(lead, stats), anchor: anchorFact(stats), cat: f.cat };
  }
  index.memo.set(lead, out);
  return out;
}

module.exports = { analyze, createIndex, findPeers, computeStats, buildInsights, anchorFact, haversineKm, cityOf, vocabOf, MIN_PEERS, RADII_KM, RULES };

"use strict";
/**
 * Taxonomía de rubros: categoría cruda de Google → rubro normalizado → vertical → grupo.
 * Una sola tabla para el backend (SQL, insights) y el panel (tarjetas, filtros, mensajes).
 * Puro: sin I/O. Se incluye en dashboard.html mediante el build (scripts/build-dashboard.js).
 */

/** Minúsculas, sin acentos ni signos raros: "Cafetería & Panadería" → "cafeteria & panaderia". */
function fold(s) {
  return String(s == null ? "" : s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
}
function slug(s) { return fold(s).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }

/** Verticales con sistema listo (las que tienen mensaje, beneficios y tabla hoy/con sistema). */
const VERTICALS = Object.freeze({
  farmacia:         { label: "Farmacia / botica",     sistema: "control de stock con alertas de vencimiento, ventas rápidas y recordatorios a clientes" },
  taller_celulares: { label: "Taller de celulares",   sistema: "órdenes de reparación con ticket, aviso por WhatsApp e inventario de repuestos" },
  restaurante:      { label: "Restaurante / comida",  sistema: "carta digital con QR, pedidos y reservas por WhatsApp, y control de caja" },
  dental:           { label: "Clínica / dental",      sistema: "agenda de citas con recordatorios por WhatsApp y ficha de pacientes" },
  inmobiliaria:     { label: "Inmobiliaria",          sistema: "cartera de propiedades, agenda de visitas y seguimiento de interesados" },
  gimnasio:         { label: "Gimnasio / fitness",    sistema: "membresías, control de asistencia y avisos de pago por WhatsApp" },
  bodega:           { label: "Bodega / minimarket",   sistema: "punto de venta (POS) con inventario y control de fiados" },
  ferreteria:       { label: "Ferretería",            sistema: "catálogo con cotizaciones rápidas y control de stock" },
  hotel:            { label: "Hotel / hospedaje",     sistema: "reservas con confirmación por WhatsApp y control de habitaciones" },
  belleza:          { label: "Salón / barbería",      sistema: "reservas online con recordatorios por WhatsApp" },
  veterinaria:      { label: "Veterinaria",           sistema: "citas, carnet de vacunas digital y recordatorios por WhatsApp" },
  contable:         { label: "Estudio contable",      sistema: "panel por cliente con documentos, vencimientos y cobros" },
  juridico:         { label: "Estudio jurídico",      sistema: "expedientes digitales con plazos, avances y estado de cuenta" },
});

const GROUPS = Object.freeze({
  comida: "Comida y bebida", salud: "Salud", belleza: "Belleza y cuidado", comercio: "Tiendas y comercio",
  servicios: "Servicios técnicos", profesionales: "Profesionales", hospedaje: "Hospedaje", educacion: "Educación",
  transporte: "Transporte", otros: "Otros",
});

/**
 * Reglas en orden de prioridad. Se evalúan sobre el texto "plegado" (sin acentos, minúsculas).
 * [patrón, rubro normalizado, vertical|null, grupo, servicio sugerido si no hay vertical]
 */
const RULES = [
  [/farmac|botica|droguer|drugstore/, "Farmacia / Botica", "farmacia", "salud"],
  [/cevich/, "Cevichería", "restaurante", "comida"],
  [/poller|\bpollo|broaster/, "Pollería", "restaurante", "comida"],
  [/chifa|chin[ao]\b|\bwok|sushi|japon/, "Chifa / Comida asiática", "restaurante", "comida"],
  [/pizzer|pizza/, "Pizzería", "restaurante", "comida"],
  [/\bcafe|coffee/, "Cafetería", "restaurante", "comida"],
  [/juguer|jugos|smoothie/, "Juguería", "restaurante", "comida"],
  [/panader|pasteler|reposter|bizcoch/, "Panadería / Pastelería", "restaurante", "comida"],
  [/hambur|sandwich|fast food|comida rapida|salchipap/, "Comida rápida", "restaurante", "comida"],
  [/\bbar\b|cervec|\bpub\b|licorer|discotec|karaoke/, "Bar / Licorería", "restaurante", "comida"],
  [/restaur|comida|\bmenu|parrill|cocina|marisc|pique|almuerz/, "Restaurante", "restaurante", "comida"],
  [/dental|dentist|odont/, "Clínica dental", "dental", "salud"],
  [/veterin|mascota|petshop|pet shop/, "Veterinaria", "veterinaria", "salud"],
  [/optic/, "Óptica", null, "salud", "caja"],
  [/laboratorio/, "Laboratorio clínico", null, "salud", "citas"],
  [/medic|clinic|consultorio|salud|hospital|psicolog|fisioterap/, "Consultorio / Clínica", null, "salud", "citas"],
  [/peluquer|barber|salon de belleza|belleza|estetic|\bunas\b|\bspa\b|manicur/, "Peluquería / Barbería", "belleza", "belleza"],
  [/gimnas|\bgym|fitness|crossfit/, "Gimnasio", "gimnasio", "belleza"],
  [/hotel|hostal|hosped|lodge|alojam|apart/, "Hotel / Hospedaje", "hotel", "hospedaje"],
  [/celular|phone|reparacion de|tecnic|electronic|informatic|computa/, "Taller de celulares / PC", "taller_celulares", "servicios"],
  [/ferret|construcci|materiales/, "Ferretería", "ferreteria", "comercio"],
  [/bodega|minimarket|abarrote|market|almacen|tienda de barrio/, "Bodega / Minimarket", "bodega", "comercio"],
  [/\bropa|boutique|textil|calzado|zapat|\bmoda/, "Ropa / Calzado", null, "comercio", "caja"],
  [/librer|papeler|utiles/, "Librería / Papelería", null, "comercio", "caja"],
  [/flor(er|ist)/, "Florería", null, "comercio", "caja"],
  [/juguet/, "Juguetería", null, "comercio", "caja"],
  [/lavander|tintorer/, "Lavandería", null, "servicios", "sistema"],
  [/cerrajer/, "Cerrajería", null, "servicios", "sistema"],
  [/imprent|grafic|serigraf|publicidad/, "Imprenta / Publicidad", null, "servicios", "sistema"],
  [/mecanic|automotr|llanter|lubricentro|taller/, "Taller mecánico", null, "servicios", "sistema"],
  [/contab|contador/, "Estudio contable", "contable", "profesionales"],
  [/abogad|juridic|legal|notari/, "Estudio jurídico", "juridico", "profesionales"],
  [/inmobili|bienes ra|propiedad/, "Inmobiliaria", "inmobiliaria", "profesionales"],
  [/viaje|turismo|agencia de/, "Agencia de viajes", null, "servicios", "citas"],
  [/escuela|colegio|instituto|academia|educa/, "Educación", null, "educacion", "sistema"],
  [/transport|courier|envios|logistic/, "Transporte / Envíos", null, "transporte", "sistema"],
];

const _memo = new Map();
/**
 * @returns {{raw:string, label:string, key:string, vertical:string|null, group:string, service:string, known:boolean}}
 */
function classifyCategory(raw) {
  const r = String(raw == null ? "" : raw).trim();
  if (_memo.has(r)) return _memo.get(r);
  const f = fold(r);
  let out = null;
  if (f) {
    for (const rule of RULES) {
      if (rule[0].test(f)) { out = { raw: r, label: rule[1], key: slug(rule[1]), vertical: rule[2], group: rule[3], service: rule[4] || "sistema", known: true }; break; }
    }
  }
  if (!out) out = { raw: r, label: r, key: r ? slug(r) : "", vertical: null, group: r ? "otros" : "", service: "sistema", known: false };
  Object.freeze(out);
  if (_memo.size < 5000) _memo.set(r, out);
  return out;
}

const normalizeCategory = (raw) => classifyCategory(raw).label;
const categoryKey = (raw) => classifyCategory(raw).key;
const verticalOf = (raw) => classifyCategory(raw).vertical;
const verticalLabel = (v) => (VERTICALS[v] ? VERTICALS[v].label : "");

module.exports = { fold, slug, classifyCategory, normalizeCategory, categoryKey, verticalOf, verticalLabel, VERTICALS, GROUPS, RULES };

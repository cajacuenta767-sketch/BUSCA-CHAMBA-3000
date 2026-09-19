"use strict";
/**
 * Motor de mensajes de prospección (WhatsApp y correo).
 *
 * Anatomía fija, textos variables:
 *   apertura personal (con un hecho real del negocio si lo hay) → problema del rubro en una frase
 *   → oferta en una línea → pregunta que se responde con "sí".
 * Tres variantes por vertical (A/B/C) repartidas de forma estable por negocio, secuencia de tres
 * pasos (día 0 → día 3 → día 7 con salida) y tope de 350 caracteres (vista previa de WhatsApp).
 * Puro: sin I/O. Se incluye en dashboard.html mediante el build.
 */
const T = require("./taxonomy");

const MAX_CHARS = 350;
const VARIANTS = ["A", "B", "C"];
/** Días de espera antes del siguiente paso. */
const STEP_DAYS = { 1: 3, 2: 4 };

/** Gancho: el problema del rubro en una frase (sin tecnicismos), tres variantes. */
const HOOKS = {
  farmacia: ["En las boticas lo que más duele es el vencido que se descubre en el estante.", "Casi toda botica pierde plata en vencidos y en productos que se acabaron sin aviso.", "Contar stock y revisar fechas una por una se lleva horas cada mes."],
  taller_celulares: ["En los talleres el problema es el papelito con el equipo que se pierde.", "El cliente llama tres veces a preguntar si su celular ya está.", "Reparaciones que se olvidan cobrar y repuestos que no aparecen: pasa en casi todo taller."],
  restaurante: ["En restaurantes los pedidos se cruzan y la caja no cuadra de noche.", "Cada cambio de precio termina en reimprimir la carta.", "Los pedidos por WhatsApp quedan sueltos entre mensajes y alguno se pierde."],
  dental: ["En consultorios lo que más cuesta son los pacientes que no llegan a su cita.", "Las historias en folder se demoran en aparecer justo cuando el paciente está sentado.", "Los tratamientos de varias fases se olvidan a mitad de camino."],
  inmobiliaria: ["En inmobiliarias el interesado se enfría cuando nadie le hace seguimiento.", "Las propiedades viven en Excel y en la cabeza de cada asesor.", "Las visitas se agendan por chat y a veces se cruzan."],
  gimnasio: ["En gimnasios el problema es perseguir al socio para que pague.", "Muchas membresías vencen sin que nadie avise.", "Nadie registra quién dejó de venir hasta que ya no vuelve."],
  bodega: ["En bodegas el cuaderno de fiados nunca cuadra.", "Se pide mercadería por costumbre y lo que más rota se acaba.", "Al cierre no se sabe cuánto se vendió ni cuánto le deben."],
  ferreteria: ["En ferreterías la cotización a mano se demora y se pierde la venta.", "Con miles de códigos, el stock se busca a ojo.", "Se vende sin saber si el precio cubre el costo del proveedor."],
  hotel: ["En hospedajes el cuaderno de reservas termina en sobreventa.", "Confirmar reservas una por una se come la mañana.", "Los consumos que nadie carga a la habitación se van sin cobrar."],
  belleza: ["En salones las horas se cruzan cuando se reservan por chat.", "Cada cliente que no llega es una hora que ya no se cobra.", "No queda registro del corte o color que llevó cada cliente."],
  veterinaria: ["En veterinarias el dueño se olvida de la siguiente vacuna.", "Un folder por mascota se demora en aparecer en la consulta.", "El medicamento clave se acaba sin aviso."],
  contable: ["En estudios contables el vencimiento que se pasa cuesta una multa.", "Perseguir documentos por WhatsApp se lleva horas cada mes.", "Facturar tarde es cobrar tarde."],
  juridico: ["En estudios jurídicos el cliente llama a preguntar cómo va el caso.", "Los plazos viven en la agenda personal de cada abogado.", "Los honorarios se cobran cuando alguien se acuerda."],
  generic: ["Lo que se anota en cuaderno o en la cabeza se pierde sin que se note.", "Cuadrar caja, contar y buscar anotaciones se lleva horas cada mes.", "Los pedidos por WhatsApp quedan sueltos entre mensajes."],
};

/** Oferta en una línea, por vertical o por servicio genérico. */
const OFFERS = {
  farmacia: { label: "Farmacia / botica", text: "Tengo un sistema para boticas (stock, vencimientos y caja) y lo estoy dando gratis a cambio de su opinión.", short: "el sistema para boticas" },
  taller_celulares: { label: "Taller de celulares", text: "Tengo un sistema para talleres (órdenes con ticket y aviso por WhatsApp) y lo doy gratis a cambio de su opinión.", short: "el sistema para talleres" },
  restaurante: { label: "Restaurante / comida", text: "Tengo un sistema para restaurantes (pedidos, carta con QR y caja) y lo doy gratis a cambio de su opinión.", short: "el sistema para restaurantes" },
  dental: { label: "Clínica / dental", text: "Tengo un sistema de citas con recordatorio por WhatsApp y ficha de pacientes, gratis a cambio de su opinión.", short: "el sistema de citas" },
  inmobiliaria: { label: "Inmobiliaria", text: "Tengo un panel para inmobiliarias (cartera, visitas y seguimiento) y lo doy gratis a cambio de su opinión.", short: "el panel para inmobiliarias" },
  gimnasio: { label: "Gimnasio / fitness", text: "Tengo un sistema para gimnasios (membresías y cobros con aviso por WhatsApp), gratis a cambio de su opinión.", short: "el sistema para gimnasios" },
  bodega: { label: "Bodega / minimarket", text: "Tengo un sistema simple para bodegas (ventas, stock y fiados) y lo doy gratis a cambio de su opinión.", short: "el sistema para bodegas" },
  ferreteria: { label: "Ferretería", text: "Tengo un sistema para ferreterías (cotizaciones rápidas y stock) y lo doy gratis a cambio de su opinión.", short: "el sistema para ferreterías" },
  hotel: { label: "Hotel / hospedaje", text: "Tengo un sistema de reservas con confirmación por WhatsApp y control de habitaciones, gratis a cambio de su opinión.", short: "el sistema de reservas" },
  belleza: { label: "Salón / barbería", text: "Tengo una agenda de reservas con recordatorio por WhatsApp para salones, gratis a cambio de su opinión.", short: "la agenda de reservas" },
  veterinaria: { label: "Veterinaria", text: "Tengo un sistema para veterinarias (citas, carnet de vacunas y recordatorios), gratis a cambio de su opinión.", short: "el sistema para veterinarias" },
  contable: { label: "Estudio contable", text: "Tengo un panel para estudios contables (clientes, documentos y vencimientos), gratis a cambio de su opinión.", short: "el panel para estudios contables" },
  juridico: { label: "Estudio jurídico", text: "Tengo un sistema de expedientes con plazos y estado de cuenta por caso, gratis a cambio de su opinión.", short: "el sistema de expedientes" },
  sistema: { label: "Sistema a medida (cualquier negocio)", text: "Tengo un sistema para {rubro} (ventas, stock y caja) y lo estoy dando gratis a cambio de su opinión.", short: "el sistema para su negocio" },
  caja: { label: "Control de caja e inventario", text: "Tengo un control de caja y ventas para {rubro} y lo doy gratis a cambio de su opinión.", short: "el control de caja" },
  citas: { label: "Sistema de citas / reservas", text: "Tengo un sistema de citas con avisos por WhatsApp y lo doy gratis a cambio de su opinión.", short: "el sistema de citas" },
  fiados: { label: "Control de fiados y cobros", text: "Tengo un control de fiados y cobranzas y lo doy gratis a cambio de su opinión.", short: "el control de fiados" },
};
const SERVICES = ["sistema", "caja", "citas", "fiados"];

const QUESTIONS = ["¿Le paso el acceso para que lo pruebe?", "¿Quiere que se lo envíe hoy?", "¿Le interesa verlo cuando tenga un minuto?"];

const SUBJECTS = { farmacia: "Vencimientos y stock de {biz}", taller_celulares: "Órdenes y avisos para {biz}", restaurante: "Pedidos y caja de {biz}", dental: "Citas sin ausencias para {biz}", inmobiliaria: "Seguimiento de interesados en {biz}", gimnasio: "Cobros al día en {biz}", bodega: "Fiados y stock de {biz}", ferreteria: "Cotizaciones rápidas para {biz}", hotel: "Reservas sin sobreventa en {biz}", belleza: "Agenda sin cruces para {biz}", veterinaria: "Vacunas que vuelven solas en {biz}", contable: "Vencimientos bajo control en {biz}", juridico: "Plazos y expedientes de {biz}", generic: "Una herramienta para {biz}" };

function hash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h; }
const leadKey = (l) => String((l && (l.place_id || l.link || (l.title + "|" + l.address))) || "");
/** Variante estable por negocio (el mismo negocio siempre recibe la misma variante; la base se reparte en tres). */
function variantFor(lead) { return VARIANTS[hash(leadKey(lead)) % VARIANTS.length]; }
const vIdx = (v) => Math.max(0, VARIANTS.indexOf(v));
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const firstName = (s) => String(s || "").trim().split(/\s+/)[0] || "";

/** Oferta a usar: vertical del rubro, o servicio genérico ("sistema" | "caja" | "citas" | "fiados"). */
function offerFor(lead, offerKey) {
  const cat = T.classifyCategory(lead && lead.category);
  const key = offerKey && OFFERS[offerKey] ? offerKey : (cat.vertical && OFFERS[cat.vertical] ? cat.vertical : (OFFERS[cat.service] ? cat.service : "sistema"));
  const o = OFFERS[key];
  const rubro = (cat.label || (lead && lead.category) || "su negocio").toLowerCase();
  return { key, label: o.label, text: o.text.replace(/\{rubro\}/g, rubro), short: o.short, vertical: cat.vertical, isVertical: !!OFFERS[key] && !SERVICES.includes(key) };
}

/**
 * Construye el mensaje de un paso de la secuencia.
 * @param {object} o { lead, sender, step (1|2|3), variant ("A"|"B"|"C"), anchor (hecho real, opcional), demo (url opcional), offer (clave opcional) }
 */
function buildMessage(o) {
  const lead = o.lead || {}, biz = String(lead.title || "su negocio").trim();
  const step = Math.min(3, Math.max(1, +o.step || 1));
  const variant = VARIANTS.includes(o.variant) ? o.variant : variantFor(lead);
  const i = vIdx(variant);
  const name = String(o.sender || "").trim() || "[tu nombre]";
  const off = offerFor(lead, o.offer);
  const hooks = HOOKS[off.vertical] || HOOKS.generic;
  const hook = hooks[i % hooks.length], question = QUESTIONS[i % QUESTIONS.length];
  let text;
  if (step === 1) {
    const anchor = o.anchor ? cap(String(o.anchor).trim().replace(/\.$/, "")) + ". " : "";
    const full = `Hola, ¿hablo con ${biz}? Soy ${name}. ${anchor}${hook} ${off.text} ${question}`;
    text = full.length <= MAX_CHARS ? full : `Hola, ¿hablo con ${biz}? Soy ${name}. ${hook} ${off.text} ${question}`;
    if (text.length > MAX_CHARS) text = `Hola, ¿hablo con ${biz}? Soy ${name}. ${off.text} ${question}`;
  } else if (step === 2) {
    text = [`Hola de nuevo, soy ${name}. Le escribí por ${off.short}: lo puede probar en ${biz} sin costo. ¿Alcanzó a verlo? Si quiere, le mando el acceso hoy mismo.`,
      `Hola, ${firstName(name)} otra vez. Hace unos días le comenté ${off.short}; sigue disponible sin costo para ${biz}. ¿Se lo envío?`,
      `Buenas, soy ${name}. Solo para no dejarlo colgado: ${off.short} sigue disponible para que ${biz} lo pruebe gratis. ¿Le interesa?`][i];
  } else {
    text = [`${name} otra vez. Último mensaje, prometido: si ${off.short} no le sirve a ${biz}, no le vuelvo a escribir. Si sí le interesa, respóndame un "sí" y se lo paso hoy.`,
      `Hola, soy ${name}. Cierro por aquí para no molestar: si en algún momento quiere probar ${off.short}, me escribe y se lo activo. Que le vaya muy bien con ${biz}.`,
      `Buenas, ${name}. No quiero ser pesado: este es mi último mensaje. Si ${off.short} le sirve a ${biz}, respóndame y se lo mando; si no, quedo a la orden.`][i];
  }
  if (o.demo && step < 3) text += `\n\nSi prefiere verlo antes: ${o.demo}`;
  return { text, step, variant, offer: off.key, chars: text.length, overLimit: text.split("\n")[0].length > MAX_CHARS };
}

/** Asunto de correo para el paso 1 (los siguientes reutilizan el hilo). */
function emailSubject(lead, step) {
  const biz = String((lead && lead.title) || "su negocio").trim();
  const v = T.classifyCategory(lead && lead.category).vertical;
  const base = (SUBJECTS[v] || SUBJECTS.generic).replace(/\{biz\}/g, biz);
  return step > 1 ? "Re: " + base : base;
}

/**
 * Siguiente paso según el historial [{ts, step, variant, channel}].
 * @returns {{step:number, dueTs:number|null, done:boolean, last:object|null}}
 */
function nextStep(history, now) {
  const h = (history || []).filter((x) => x && x.step).sort((a, b) => a.ts - b.ts);
  const last = h[h.length - 1] || null;
  if (!last) return { step: 1, dueTs: null, done: false, last: null };
  if (last.step >= 3) return { step: 3, dueTs: null, done: true, last };
  const days = STEP_DAYS[last.step] || 3;
  return { step: last.step + 1, dueTs: last.ts + days * 86400000, done: false, last };
}

/** Fecha (AAAA-MM-DD, local) del siguiente toque tras enviar `step` ahora. */
function followDateAfter(step, now) {
  const days = STEP_DAYS[step];
  if (!days) return "";
  const d = new Date((now || Date.now()) + days * 86400000);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

/** Métrica: enviados y respuestas por variante a partir de los metadatos de todos los leads. */
function variantStats(metas) {
  const out = {}; for (const v of VARIANTS) out[v] = { sent: 0, leads: 0, replied: 0 };
  for (const m of metas || []) {
    const msgs = (m && m.messages) || [];
    if (!msgs.length) continue;
    const v = msgs[0].variant && out[msgs[0].variant] ? msgs[0].variant : null;
    if (!v) continue;
    out[v].leads++; out[v].sent += msgs.length;
    if (["respondio", "propuesta", "cliente"].includes(m.state)) out[v].replied++;
  }
  for (const v of VARIANTS) out[v].rate = out[v].leads ? Math.round((100 * out[v].replied) / out[v].leads) : null;
  return out;
}

module.exports = { buildMessage, offerFor, variantFor, nextStep, followDateAfter, emailSubject, variantStats, HOOKS, OFFERS, SERVICES, QUESTIONS, VARIANTS, MAX_CHARS, STEP_DAYS };

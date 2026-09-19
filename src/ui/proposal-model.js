"use strict";
/**
 * Modelo de la propuesta: convierte un negocio + su análisis en DATOS listos para pintar.
 * Los dos renderizadores (PDF con jsPDF y HTML para imprimir) consumen este mismo modelo,
 * así nunca dicen cosas distintas. Aquí vive también todo el texto por rubro.
 * Puro: sin I/O. Se incluye en dashboard.html mediante el build.
 */
const T = require("../domain/taxonomy");
const { isOwnWebsite } = require("../domain/lead");

// ---------------------------------------------------------------- textos por rubro
const BENCH_GEN = [
  ["Ventas", "Cuaderno o Excel; el cierre de caja sale al tanteo", "Cada venta registrada; cierre de caja exacto en 1 clic"],
  ["Inventario", "Se cuenta a mano y se entera cuando ya faltó", "Stock al día, con aviso antes de quedarse sin producto"],
  ["Fiados y cobros", "Se apuntan en papel y algunos se olvidan", "Quién debe, cuánto y desde cuándo, con recordatorio por WhatsApp"],
  ["Clientes", "No sabe quién volvió ni qué compró", "Historial por cliente y mensaje de recompra automático"],
  ["Números del mes", "Los saca a fin de mes, si le alcanza el tiempo", "Reporte listo: lo que más deja, por día y por hora"],
];
const BENCH = {
  farmacia: [["Vencimientos", "Se descubren en el estante, ya vencidos", "Alerta 60 días antes: alcanza a rotarlo o devolverlo"], ["Stock", "Se pide lo que se ve que falta", "Aviso de stock bajo por producto y laboratorio"], ["Ventas", "Boleta a mano, caja al tanteo", "Venta rápida por código y cierre de caja exacto"], ["Clientes crónicos", "Se acuerdan (o no) de volver", "Recordatorio de recompra por WhatsApp en su fecha"]],
  taller_celulares: [["Órdenes", "Papelito con el equipo; se pierden", "Ticket con número, equipo, falla y fecha prometida"], ["Avisos", "El cliente llama a preguntar si ya está", "Aviso automático por WhatsApp cuando queda listo"], ["Repuestos", "No sabe cuántas pantallas le quedan", "Inventario de repuestos con costo y aviso de stock"], ["Garantías", "Depende de la memoria", "Historial por equipo e IMEI, con garantía y fecha"]],
  restaurante: [["Pedidos", "Se anotan en papel y se cruzan", "Pedido por mesa o por WhatsApp, con su estado"], ["Carta", "Se reimprime cada vez que cambia un precio", "Carta digital con QR: cambia el precio y listo"], ["Insumos", "Se compra por costumbre", "Consumo real por plato y aviso de insumo bajo"], ["Caja", "Se cuadra de noche y a veces no cuadra", "Cierre por turno, con propinas y delivery aparte"]],
  dental: [["Citas", "Agenda de papel; faltan pacientes", "Agenda con recordatorio por WhatsApp el día antes"], ["Fichas", "Historias en folder, difíciles de ubicar", "Ficha digital con tratamientos y radiografías"], ["Tratamientos", "Se olvida la siguiente fase", "Aviso de control y de tratamiento pendiente"], ["Pagos", "Se apuntan aparte", "Plan de pagos por paciente y saldo al día"]],
  gimnasio: [["Membresías", "Se anota en cuaderno quién pagó", "Vencimiento por socio y aviso antes de que caiga"], ["Asistencia", "Nadie la registra", "Control de ingreso y quién dejó de venir"], ["Cobros", "Hay que perseguir al socio", "Recordatorio de pago automático por WhatsApp"], ["Planes", "Todos pagan casi lo mismo", "Planes y promos por tipo de socio, con su reporte"]],
  bodega: [["Ventas", "Todo de memoria y calculadora", "POS por código o por nombre, con vuelto exacto"], ["Fiados", "Cuaderno de fiados que nadie cuadra", "Lista de deudores con saldo y recordatorio"], ["Stock", "Se pide lo que se ve vacío", "Aviso de stock bajo de lo que más rota"], ["Ganancia", "No sabe qué producto deja más", "Margen por producto: qué conviene tener"]],
  ferreteria: [["Cotizaciones", "A mano, y se demoran", "Cotización en minutos con precios al día"], ["Stock", "Miles de códigos, se busca a ojo", "Búsqueda por código o nombre, con stock real"], ["Proveedores", "Se pide por costumbre", "Historial de compras y costo por proveedor"], ["Obras", "Se pierde el hilo del cliente", "Cuenta por cliente u obra, con su saldo"]],
  hotel: [["Reservas", "Cuaderno o WhatsApp suelto", "Calendario de habitaciones, sin sobreventa"], ["Confirmaciones", "Se llama uno por uno", "Confirmación y recordatorio automático por WhatsApp"], ["Ocupación", "No conoce su ocupación real", "Ocupación por día, mes y temporada"], ["Consumos", "Se apuntan aparte", "Consumo cargado a la habitación, en una sola cuenta"]],
  belleza: [["Reservas", "Por chat; se cruzan las horas", "Reserva online por profesional, sin cruces"], ["Ausencias", "Se pierde la hora y el ingreso", "Recordatorio automático: bajan las faltas"], ["Fichas", "No sabe qué color o corte llevó", "Historial por cliente, con foto y producto usado"], ["Promos", "Se avisa a quien uno se acuerda", "Campaña por WhatsApp a quien no vuelve hace X días"]],
  veterinaria: [["Citas", "Agenda de papel", "Agenda con recordatorio por WhatsApp"], ["Vacunas", "El dueño se olvida de la siguiente", "Carnet digital y aviso de la próxima dosis"], ["Historial", "Un folder por mascota", "Ficha con peso, tratamientos y alergias"], ["Farmacia", "Se acaba el medicamento clave", "Stock con alerta y control de vencimientos"]],
  inmobiliaria: [["Cartera", "Propiedades en Excel y en la cabeza", "Cartera con fotos, estado y precio actualizado"], ["Visitas", "Se agendan por chat", "Agenda de visitas con recordatorio a ambas partes"], ["Seguimiento", "Se enfría el interesado", "Embudo por cliente: quién vio qué y cuándo"], ["Comisiones", "Se calculan a mano", "Comisión por operación y por asesor"]],
  contable: [["Clientes", "Carpetas y correos sueltos", "Panel por cliente, con documentos y estado"], ["Vencimientos", "Se revisan a mano en el cronograma", "Alerta de vencimiento por cliente y por tributo"], ["Cobros", "Se factura tarde", "Facturación recurrente con recordatorio"], ["Documentos", "El cliente los manda por WhatsApp", "El propio cliente los carga en su acceso"]],
  juridico: [["Expedientes", "Carpetas físicas y notas sueltas", "Expediente digital con toda su actuación"], ["Plazos", "Se llevan en la agenda personal", "Alerta de plazo por expediente"], ["Clientes", "Llaman a preguntar cómo va", "Acceso para que vean el avance ellos mismos"], ["Honorarios", "Se cobran cuando uno se acuerda", "Estado de cuenta por caso, con recordatorio"]],
};
const BEN_GEN = { t: "4 a 6 horas al mes que hoy se van en cuadrar caja, contar y buscar anotaciones.", d: "Lo que se escapa sin que se note: fiados olvidados, errores de conteo y productos que se acabaron.", e: "Cerrar el día sabiendo que cuadró, sin revisar cuadernos ni confiar en la memoria." };
const BEN = {
  farmacia: { t: "5 a 8 horas al mes contando stock y revisando fechas una por una.", d: "Lo que hoy se tira en vencidos y lo que se pierde cuando el cliente no encuentra su medicamento.", e: "Nunca más descubrir un vencido en la mano del cliente: el sistema avisa 60 días antes." },
  taller_celulares: { t: "4 a 6 horas al mes buscando equipos, papelitos y contestando si ya está listo.", d: "Ninguna reparación queda sin cobrar y ningún repuesto se pierde entre cajones.", e: "El cliente recibe el aviso solo cuando su equipo está listo; usted deja de dar explicaciones." },
  restaurante: { t: "6 a 10 horas al mes anotando pedidos, reimprimiendo cartas y cuadrando la caja de noche.", d: "Deja de comprar insumo que no rota y cobra lo que hoy se pierde en pedidos mal anotados.", e: "Servicio sin pedidos cruzados y cierre de caja en un clic, no a medianoche." },
  dental: { t: "4 a 6 horas al mes llamando para confirmar citas y buscando historias en el folder.", d: "Los tratamientos pendientes dejan de olvidarse: cada fase queda agendada y cobrada.", e: "Agenda llena y sin ausencias, con el recordatorio saliendo solo el día antes." },
  gimnasio: { t: "4 a 6 horas al mes revisando quién pagó y persiguiendo al socio.", d: "Ninguna membresía vence sin aviso: se cobra a tiempo y no se pierde el mes.", e: "Se acaba el papel de cobrador: el recordatorio lo manda el sistema, no usted." },
  bodega: { t: "5 a 8 horas al mes cuadrando caja de memoria y revisando el cuaderno de fiados.", d: "Recupera los fiados que hoy se olvidan y sabe qué producto le deja de verdad.", e: "Saber cuánto vendió y cuánto le deben, sin depender de la memoria." },
  ferreteria: { t: "5 a 8 horas al mes buscando precios y armando cotizaciones a mano.", d: "Cotiza en minutos y no pierde la venta por demorar ni por vender bajo costo.", e: "Miles de códigos bajo control, con el stock real a la vista." },
  hotel: { t: "4 a 7 horas al mes confirmando reservas una por una.", d: "Se acaba la sobreventa y los consumos que nadie cargó a la habitación.", e: "Ver la ocupación de un vistazo, sin cuaderno ni chats sueltos." },
  belleza: { t: "4 a 6 horas al mes coordinando horas por chat.", d: "Bajan las faltas: cada hora perdida es una hora que ya no se cobra.", e: "Agenda ordenada por profesional, sin cruces ni horas dobles." },
  veterinaria: { t: "3 a 5 horas al mes llamando para recordar vacunas y buscando fichas.", d: "Las dosis siguientes vuelven solas: el recordatorio trae al cliente de nuevo.", e: "Historial completo de cada mascota a la mano, sin folders." },
  inmobiliaria: { t: "5 a 8 horas al mes actualizando listas y persiguiendo interesados.", d: "Ningún interesado se enfría sin seguimiento, y la comisión queda clara por operación.", e: "Toda la cartera y cada visita en un solo lugar." },
  contable: { t: "6 a 10 horas al mes persiguiendo documentos y revisando vencimientos.", d: "Se factura a tiempo y no se pagan multas por un vencimiento que se pasó.", e: "Cada cliente con su estado a la vista, sin correos sueltos." },
  juridico: { t: "5 a 8 horas al mes revisando plazos y respondiendo cómo va el caso.", d: "Los honorarios quedan con estado de cuenta por caso, y se cobran cuando toca.", e: "Ningún plazo se pasa: el sistema avisa antes." },
};
/** Promesa de portada por vertical (una frase que el dueño entiende en 3 segundos). */
const PROMISE = {
  farmacia: "Que ningún producto venza en el estante y ningún cliente se vaya sin lo suyo.",
  taller_celulares: "Cada equipo con su ticket, y el cliente avisado solo cuando está listo.",
  restaurante: "Pedidos sin cruces, carta al día y caja que cuadra en un clic.",
  dental: "Agenda llena, pacientes recordados el día antes y fichas al alcance.",
  inmobiliaria: "Ningún interesado se enfría y cada comisión queda clara.",
  gimnasio: "Cobrar a tiempo sin perseguir a nadie: el aviso sale solo.",
  bodega: "Saber cuánto vendió y cuánto le deben, sin depender de la memoria.",
  ferreteria: "Cotizar en minutos y no vender nunca por debajo del costo.",
  hotel: "Reservas sin sobreventa y cada consumo cargado a su habitación.",
  belleza: "Horas sin cruces y menos faltas: cada hora perdida es dinero.",
  veterinaria: "Vacunas que vuelven solas y el historial de cada mascota a la mano.",
  contable: "Ningún vencimiento se pasa y cada cliente ve su estado.",
  juridico: "Plazos avisados antes y el cliente viendo el avance sin llamar.",
};
const PROMISE_GEN = "Todo lo que hoy lleva en la cabeza y en el cuaderno, lo lleva el sistema por usted.";

const benchOf = (v) => BENCH[v] || BENCH_GEN;
const benefOf = (v) => BEN[v] || BEN_GEN;

// ---------------------------------------------------------------- utilidades
function fmtDate(d, locale = "es-PE") {
  try { return d.toLocaleDateString(locale, { day: "2-digit", month: "long", year: "numeric" }); }
  catch (e) { return d.toISOString().slice(0, 10); }
}
function hash4(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return String(h % 10000).padStart(4, "0"); }
/** Folio estable por negocio y año: SKT-2026-0142. */
function folioFor(lead, date) { return "SKT-" + date.getFullYear() + "-" + hash4(String(lead.place_id || lead.link || lead.title || "")); }
const num = (n) => new Intl.NumberFormat("es-PE").format(Math.round(n));
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** QR de contacto: WhatsApp del asesor con el mensaje puesto; si no, correo. Nunca a la demo. */
function contactQr(contact, biz) {
  const c = String(contact || "").trim();
  const tel = (c.match(/\+?\d[\d\s().-]{7,}/) || [""])[0].replace(/\D/g, "");
  const txt = "Hola, vi la propuesta para " + (biz || "mi negocio") + " y quiero probar el sistema.";
  if (tel.length >= 8) return { url: "https://wa.me/" + tel + "?text=" + encodeURIComponent(txt), label: "Escanee y escríbame por WhatsApp" };
  const mail = (c.match(/[\w.+-]+@[\w-]+\.[\w.-]+/) || [""])[0];
  if (mail) return { url: "mailto:" + mail + "?subject=" + encodeURIComponent("Quiero probar el sistema — " + (biz || "")) + "&body=" + encodeURIComponent(txt), label: "Escanee y escríbame" };
  return null;
}

/** Proyección local en km (norte arriba) de los competidores alrededor del negocio, para el radar. */
function radarFor(lead, S) {
  if (!S || S.level !== "radius" || !S.peers || !lead.lat || !lead.lon) return null;
  const cos = Math.cos((lead.lat * Math.PI) / 180);
  const pts = S.peers.filter((p) => p.lat && p.lon).map((p) => ({ x: (p.lon - lead.lon) * 111 * cos, y: -(p.lat - lead.lat) * 111, reviews: p.reviews, me: p.me, title: p.title }));
  const top = Math.max(1, ...pts.map((p) => p.reviews));
  return { radiusKm: S.radiusKm, points: pts, top };
}

// ---------------------------------------------------------------- modelo
/**
 * @param {object} lead negocio
 * @param {object} ctx { analysis, sender, contact, demo, now, locale }
 */
function buildProposal(lead, ctx = {}) {
  const now = ctx.now || new Date();
  const A = ctx.analysis || { ok: false, stats: null, insights: [], anchor: null };
  const S = A.ok ? A.stats : null;
  const cat = T.classifyCategory(lead.category);
  const vertical = cat.vertical;
  const biz = String(lead.title || "su negocio").trim();
  const rubro = cat.label || lead.category || "su rubro";
  const city = (lead.city || (S && S.city) || "").trim();
  const reviews = +lead.reviews || 0, rating = +lead.rating || 0;
  const hasWeb = isOwnWebsite(lead.website);
  const valid = new Date(now.getTime() + 15 * 86400000);

  // KPIs de portada: siempre 3, con lo mejor que haya.
  const kpis = [];
  if (S) {
    if (S.rankVis === 1 && S.mine > 0) kpis.push({ value: "1.º", label: "en reseñas entre " + S.n + " de su zona", tone: "azul" });
    else if (S.focus === "calidad" && S.rankQual) kpis.push({ value: S.rankQual + ".º", label: "en calificación entre " + S.n + " de su zona", tone: "azul" });
    else kpis.push({ value: S.rankVis + ".º", label: "de " + S.n + " en reseñas en su zona", tone: "azul" });
    kpis.push({ value: S.pctNoWeb + "%", label: "de su competencia sigue sin sistema", tone: "ambar" });
    kpis.push(rating ? { value: "★ " + rating.toFixed(1), label: "su calificación · zona " + S.avgR.toFixed(1), tone: "verde" } : { value: num(S.mine), label: "reseñas en Google", tone: "verde" });
  } else {
    kpis.push({ value: reviews ? num(reviews) : "—", label: "reseñas en Google", tone: "azul" });
    kpis.push({ value: rating ? "★ " + rating.toFixed(1) : "—", label: "calificación en Google", tone: "verde" });
    kpis.push({ value: hasWeb ? "Sí" : "No", label: hasWeb ? "tiene web propia" : "tiene web propia todavía", tone: "ambar" });
  }

  let comparison = null;
  if (S) {
    const third = Math.ceil(S.n / 3);
    const useQual = S.focus === "calidad" && S.rankQual;
    const pos = useQual ? S.rankQual : S.rankVis;
    const grade = pos <= third ? "verde" : pos <= 2 * third ? "ambar" : "rojo";
    comparison = {
      scope: S.scope, n: S.n, level: S.level, radiusKm: S.radiusKm, city: S.city,
      title: useQual ? "Qué tan bien lo califican, comparado con su competencia" : "Cuántos clientes lo recomiendan, comparado con su competencia",
      note: useQual
        ? "Calificación en Google de " + S.scope + ". " + (S.myR > S.avgR + 0.05 ? "Cuando un negocio ya sale mejor calificado que su zona, lo que le falta es volumen." : "Está a la par de su zona: quien se despegue será el que deje de fallar en lo pequeño.")
        : "Reseñas en Google de " + S.scope + ". Más reseñas = más gente entrando = más que controlar.",
      bars: useQual
        ? [{ label: "USTED", value: S.myR, text: S.myR.toFixed(1), tone: "azul", strong: true }, { label: "Promedio de su zona", value: S.avgR, text: S.avgR.toFixed(1), tone: "gris" }, { label: "Tope (5 estrellas)", value: 5, text: "5.0", tone: "rojo" }]
        : [{ label: "USTED", value: S.mine, text: num(S.mine), tone: "azul", strong: true }, { label: "Promedio de su zona", value: S.avgRev, text: num(S.avgRev), tone: "gris" }, { label: S.rankVis === 1 ? "(usted es el primero)" : "El primero de su zona", value: S.top, text: num(S.top), tone: "rojo" }],
      max: useQual ? 5 : Math.max(S.top, S.mine, S.avgRev, 1),
      rank: { pos, n: S.n, label: "Puesto " + pos + " de " + S.n + (useQual ? " en calificación" : " en reseñas"), grade, focus: S.focus },
      chips: [
        { text: S.pctNoWeb + "% de su competencia todavía sin sistema", tone: "azul" },
        rating ? { text: "Lo califican " + rating.toFixed(1) + " y a su zona " + S.avgR.toFixed(1), tone: "ambar" } : { text: "Todavía sin calificación en Google", tone: "ambar" },
        { text: S.pctTel + "% ya recibe pedidos por WhatsApp", tone: "verde" },
      ],
      radar: radarFor(lead, S),
    };
  }

  const gains = benefOf(vertical);
  const sysLine = vertical && T.VERTICALS[vertical] ? T.VERTICALS[vertical].sistema : "";
  const includes = (sysLine ? ["Hecho para su rubro: " + sysLine + "."] : []).concat([
    "Registro de ventas y cierre de caja diario.",
    "Inventario con alertas de stock bajo y vencimiento.",
    "Control de cuentas y fiados, con los cobros al día.",
    "Avisos y recordatorios por WhatsApp a sus clientes.",
    "Se abre desde el celular o la computadora, sin instalar nada.",
  ]);
  const qr = ctx.qr !== undefined ? ctx.qr : contactQr(ctx.contact, biz);

  return {
    meta: { folio: folioFor(lead, now), date: fmtDate(now, ctx.locale), validUntil: fmtDate(valid, ctx.locale), sender: String(ctx.sender || "").trim(), contact: String(ctx.contact || "").trim(), demo: String(ctx.demo || "").trim(), qr },
    business: { name: biz, category: rubro, vertical, verticalLabel: vertical ? T.verticalLabel(vertical) : "", address: String(lead.address || "").trim(), city, phone: String(lead.phone || "").trim(), website: hasWeb ? lead.website : "", rating, reviews, thumb: lead.thumb || "", lat: +lead.lat || 0, lon: +lead.lon || 0 },
    cover: {
      kicker: "PROPUESTA PARA", title: biz,
      subtitle: [rubro, city || lead.address || "", fmtDate(now, ctx.locale)].filter(Boolean).join("  ·  "),
      promise: { headline: "Menos estrés y más dinero", body: PROMISE[vertical] || PROMISE_GEN },
      kpis,
    },
    comparison,
    insights: (A.insights || []).map((x) => (typeof x === "string" ? x : x.text)).slice(0, 3),
    anchor: A.anchor || null,
    gains: { time: gains.t, money: gains.d, calm: gains.e, note: "Las horas son una estimación conservadora para un negocio de su tamaño; las ajustamos con sus números en la reunión." },
    includes,
    beforeAfter: benchOf(vertical).map((r) => ({ topic: r[0], today: r[1], withSystem: r[2] })),
    plan: [
      { n: 1, title: "Le envío el acceso hoy", body: "Sin instalar nada: entra desde su celular o computadora." },
      { n: 2, title: "Lo prueba con sus datos reales", body: "Unos días de uso normal en su negocio, sin compromiso." },
      { n: 3, title: "Me dice qué le sirvió", body: "Si le gusta, seguimos. Si no le sirve, no paga nada." },
    ],
    cta: {
      headline: "Pruébelo sin compromiso",
      body: "Le doy acceso gratis. Lo usa unos días con sus ventas reales y, si le sirve, seguimos. Si no le sirve, no pasa nada.",
      steps: "1) acceso hoy · 2) lo prueba con sus datos · 3) me dice qué le sirvió",
      contactLine: [String(ctx.sender || "").trim(), String(ctx.contact || "").trim()].filter(Boolean).join("  ·  "),
      demo: String(ctx.demo || "").trim(), demoLabel: "Abrir la demo ahora", qr,
    },
  };
}

module.exports = { buildProposal, folioFor, contactQr, radarFor, benchOf, benefOf, BENCH, BEN, PROMISE, fmtDate, cap };

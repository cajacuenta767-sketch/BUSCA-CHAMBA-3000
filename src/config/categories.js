"use strict";
/**
 * Rubros agrupados en "grupos selectos" (limpio, sin repetidos ni nombres sueltos).
 * El frontend usa los mismos grupos; aquí se aplanan para el modo "Todo el área".
 */
const CATEGORY_GROUPS = Object.freeze([
  { name: "Comida y bebida", items: ["restaurante", "pollería", "chifa", "cevichería", "cafetería", "juguería", "panadería", "pizzería"] },
  { name: "Salud", items: ["farmacia", "botica", "clínica dental", "consultorio médico", "veterinaria", "óptica"] },
  { name: "Belleza y cuidado", items: ["peluquería", "barbería", "spa", "gimnasio"] },
  { name: "Tiendas y comercio", items: ["bodega", "minimarket", "tienda de ropa", "zapatería", "librería", "ferretería", "florería", "juguetería"] },
  { name: "Servicios técnicos", items: ["taller de celulares", "cerrajería", "lavandería", "imprenta", "taller mecánico"] },
  { name: "Profesionales", items: ["estudio contable", "estudio jurídico", "inmobiliaria", "agencia de viajes"] },
  { name: "Hospedaje", items: ["hotel", "hostal"] },
]);

const CATEGORIES = Object.freeze([...new Set(CATEGORY_GROUPS.flatMap((g) => g.items))]);

/** 15 consultas paraguas de alta densidad para modo "Todo el área" (3x más rápido que 37 micro-consultas). */
const CORE_ALL_CATEGORIES = Object.freeze([
  "restaurante", "pollería", "chifa", "cevichería",
  "cafetería panadería", "farmacia botica", "clínica dental consultorio médico",
  "peluquería barbería spa", "gimnasio", "bodega minimarket",
  "tienda de ropa zapatería", "ferretería librería",
  "taller mecánico servicio técnico", "estudio contable jurídico", "hotel hostal",
]);

module.exports = { CATEGORY_GROUPS, CATEGORIES, CORE_ALL_CATEGORIES };

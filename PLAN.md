# PLAN — BUSCA-CHAMBA-3000 (~77 mejoras)

Sistema de generación de leads freelance a partir de Google Maps: escanea negocios,
los muestra en un panel, y ayuda a contactarlos por WhatsApp con mensajes por rubro.

## Corazón del sistema
- **Escaneo TOTAL por cuadrícula (por defecto):** se elige un área, se parte en celdas
  (tamaño configurable) y se barre **celda por celda capturando TODOS los negocios**.
  Solo si el usuario especifica un rubro, se limita a ese.
- **Mapa que se pinta en vivo:** cada celda cambia de color según su estado
  (⬜ pendiente → 🟡 escaneando → 🟢 con negocios / ⚪ vacía / 🔴 error), con barra de
  progreso, pausar/reanudar y cobertura guardada.
- **El servidor orquesta la cuadrícula** (una celda = un trabajo) para saber en vivo
  qué celda va y poder pausar/reanudar sin repetir ni saltarse zonas.

## Fase 1 — Inicio, escaneo total y mapa en vivo
1. Pantalla de Inicio con botón ▶️ Iniciar grande.
2. Por defecto escaneo TOTAL; interruptor "Acotar por rubro" opcional, auto-seleccionado en "Todo".
3. Mapa que se pinta en vivo (celda por celda) con conteo por celda.
4. Leads capturados en una sección aparte ("Resultados").
5. Servidor que orquesta la cuadrícula (una celda = un trabajo).
6. Barra de progreso (celdas X/Y, % área, leads, tiempo estimado).
7. Estimador previo (celdas, minutos, búsquedas) antes de iniciar.
8. Lista de categorías editable para el modo Todo; opción de excluir rubros.
9. Pausar / Reanudar / Detener.
10. Reintento de celdas con error; saltar celdas.
11. Subdivisión adaptativa de celdas topadas (~120 resultados).
12. Dedupe entre celdas.
13. Áreas guardadas con nombre.
14. Concurrencia/velocidad configurable.
15. Aviso al terminar + historial de escaneos.

## Fase 2 — Cerrar clientes (CRM / outreach)
16. Pipeline drag-and-drop (Nuevo → Contactado → Respondió → Propuesta → Cliente).
17. Recordatorios de seguimiento + lista "para contactar hoy".
18. Plantillas de 2º y 3er mensaje por rubro.
19. Historial de mensajes por lead.
20. Score de prospecto automático (sin web + rating + reseñas).
21. Precios/paquetes sugeridos por rubro.
22. Etiquetas/tags por lead.
23. Nota rápida en la tarjeta.
24. Lista "No contactar".

## Fase 3 — Interfaz / UX
25. Vista de tabla. 26. Selección múltiple + acciones en lote. 27. Atajos de teclado.
28. Modo compacto. 29. Móvil pulido. 30. Buscador global (teléfono/correo/dominio).
31. Pines por color según estado. 32. Filtro por zona/distancia. 33. Calidad de dato.
34. Heatmap de densidad de negocios.

## Fase 4 — Datos y analítica
35. Panel de métricas. 36. Embudo. 37. Exportar por segmento. 38. Importar/mezclar CSV con dedupe.
39. Enriquecimiento de redes (IG/FB). 40. Normalizar teléfonos +51. 41. Detectar "solo Facebook".
42. Respaldo completo.

## Fase 5 — Integraciones / automatización
43. Telegram (lead nuevo → chat). 44. Escaneo programado (cron). 45. Envío asistido WhatsApp.
46. Google Sheets. 47. LeadsDB. 48. Webhooks. 49. Multiusuario.

## Fase 6 — Robustez / despliegue / seguridad
50. Docker Compose (todo junto). 51. Proxies configurables. 52. Errores visibles.
53. Login básico. 54. Guía de uso responsable (Ley 29733). 55. Logs descargables.

## Fase 7 — Geografía y ubicación (Perú)
56. Selector Departamento → Provincia → Distrito (centra el escaneo).
57. Filtrar leads por departamento/ciudad/distrito.
58. "Ir a un lugar" (buscador en el mapa).
59. Cobertura por distrito.
60. Barrido ajustado al límite del distrito (avanzado).
61. Presets de zonas.

## Fase 8 — Más funciones útiles
62. Vista "Para contactar hoy". 63. Dedupe por teléfono. 64. Móvil vs fijo.
65. Días desde último contacto. 66. Registro de llamada. 67. Plantillas propias.
68. Segmentos/vistas guardadas. 69. Competencia en la zona. 70. Horario / abierto ahora.
71. Paquete del día a Excel. 72. Filtro por rating/reseñas.

## Fase 9 — Mapa enriquecido (fotos + ficha)
73. Vista previa al pasar el mouse (foto + datos).
74. Clic en pin → ficha completa (galería, descripción, botones).
75. Pines inteligentes (color por estado, resaltado sin web).
76. Captura de fotos y descripción activada en el scraper.
77. Clúster de pines en zonas densas.

## Orden de construcción
Fase 1 (escaneo total + mapa en vivo + fichas) → Fase 2 (CRM) → Fase 7 (geografía)
→ Telegram + cron → resto.

## Nota técnica honesta
La captura real de Google Maps corre en la máquina del usuario (PC/VPS con internet
abierto), no en el sandbox. El panel y el servidor incluyen un **modo Demo** para ver
todo funcionando sin escanear.

# Plan de rediseño — propuesta PDF, lógica de comparación, logo, mensajes y panel

> **Estado: las cinco fases están implementadas** (ver `README.md` → "Propuesta, mensajes y marca").
> Decisiones tomadas al ejecutar: logo refinado sobre el concepto actual (C3); PDF con jsPDF y sistema
> de diseño propio (opción 1); fuentes de marca incrustadas cuando hay servidor; oferta "acceso gratis a
> cambio de feedback"; foto del negocio con proxy y caché; en vez de mini-mapa con tiles (sin dependencias
> externas ni internet) un **radar vectorial** de competidores dibujado con los propios datos.

Objetivo: que cada propuesta que sale del sistema **se vea profesional, diga algo verdadero sobre
ese negocio y consiga respuesta**. El plan parte de lo que hay hoy en `dashboard.html`
(`statsFor`, `insightsFor`, `drawProposal`, `PITCHES`, `skyBadge`) y se organiza en 6 frentes y
5 fases. Cada fase se entrega completa, probada y usable por separado.

---

## 0. Diagnóstico (lo que hay hoy y por qué se queda corto)

### 0.1 Lógica de comparación que alimenta el PDF (`statsFor`, `insightsFor`)

| Hallazgo | Consecuencia en la propuesta |
|---|---|
| Los "competidores" se buscan en cascada: mismo rubro **y** ciudad (≥5) → mismo rubro en toda la base → misma ciudad **cualquier rubro** → **toda la base**. | Una farmacia de Cusco puede salir comparada contra restaurantes de Lima ("Puesto 8 de 300 en negocios de su base"). El dueño lo nota y pierde credibilidad. |
| El rubro se normaliza con una lista de regex (`CATNORM`/`VR`); lo que no matchea queda con la categoría cruda de Google ("Farmacia", "Botica", "Farmacia y perfumería" son 3 grupos). | Grupos de competidores fragmentados y pequeños → muchas propuestas sin sección de comparación o con "5 de 5". |
| El "puesto" es solo por número de reseñas. | Un negocio nuevo con 4.9 ★ y 12 reseñas sale "último"; el mensaje lo desmotiva en vez de venderle. |
| Los insights son frases fijas encadenadas; pueden contradecirse ("hoy encabeza la lista" + "le faltan X para el promedio") y repiten "el sistema" cinco veces. | Texto que suena a plantilla. |
| Todo se calcula en el navegador con los leads cargados. | Con paginación (ya soportada por el backend) la comparación se rompería; no es testeable. |
| La ciudad viene del último tramo de la dirección; sin lat/lon no hay noción de "zona" real. | "Su zona" = una ciudad entera. En Lima, una bodega de Comas se compara con Miraflores. |

### 0.2 El PDF (`drawProposal`, 1 090 líneas dentro de un archivo de 183 KB)

- Dibujo procedural con coordenadas a mano en jsPDF; **dos renderizadores** (jsPDF y la versión HTML para imprimir) que ya no dicen lo mismo.
- Solo Helvetica (sin la tipografía de marca), sin foto del negocio (aunque `thumb` viene de Google), sin mapa, sin número de página, sin fecha de validez ni folio.
- Bien resuelto y hay que conservar: paleta validada para daltonismo, QR incrustado sin internet, gráfica de barras y "cuadritos" de posición, tabla hoy/con sistema por rubro, cierre sin precio.
- Legibilidad en celular (donde se abre el 90 % de las veces por WhatsApp): cuerpo de 8–8.8 pt en A4 es pequeño; hay 7 secciones en 2 páginas.

### 0.3 Logo Sky Tech

- Nube de tres círculos + rectángulo, con un rayo. Concepto correcto (nube = sistema en la nube, rayo = energía) pero ejecución genérica: los círculos no comparten curvatura, el rayo es pequeño y desaparece a 24 px, el wordmark es Helvetica (no la fuente del panel).
- Está dibujado **dos veces** (SVG en `marca/` y a mano en `skyBadge` del PDF): cualquier cambio hay que hacerlo en los dos.

### 0.4 Mensajes (`PITCHES`, `FOLLOWUP`)

- Los 17 mensajes siguen la **misma fórmula**: "Hola 👋 ¿hablo con X? Soy N. [Verbo] un sistema para [rubro] (…) 100% gratis. Solo buscamos su feedback… ¿Le paso el acceso?". Con 20 envíos seguidos parece spam y WhatsApp lo penaliza.
- "100% gratis" aparece hasta 3 veces por mensaje y 6 en el PDF: repetido pierde credibilidad.
- No usan ningún dato real del negocio aunque están calculados (reseñas, calificación, puesto).
- Un solo seguimiento genérico; no hay secuencia (día 0 → día 3 → día 7) ni cierre con salida ("si no le interesa, no le vuelvo a escribir"), que además exige la Ley 29733 citada en el README.
- Sin variantes → no se puede saber qué mensaje consigue respuestas.

### 0.5 Diseño del panel

- Buena base (Sora + IBM Plex, modo oscuro, chips, kanban), pero el acento es **violeta** (`#5b54e6`) mientras la marca es azul marino + celeste: el panel y la propuesta no parecen del mismo producto.
- Un solo archivo de 1 741 líneas; sin sistema de tokens compartido con el PDF; sin estados vacíos ni guía en el primer uso.

---

## 1. Frente A — Lógica de comparación ("inteligencia" de la propuesta)

**Meta:** comparar siempre a un negocio con **su rubro real en su zona real**, y si no hay datos suficientes, decirlo con honestidad en vez de inventar un ranking.

1. **Taxonomía de rubros compartida** (`src/config/taxonomy.js`, servida en `GET /api/taxonomy`):
   categoría de Google → rubro normalizado → vertical (farmacia, restaurante…) → grupo. Con
   normalización de acentos/plurales y sinónimos ("botica", "farmacia", "drugstore"). El panel y
   el backend usan la misma tabla (hoy hay dos listas distintas).
2. **Zona por distancia, no por nombre de ciudad**: competidores = mismo rubro dentro de 2 km;
   si hay < 8, ampliar a 5 km, luego al distrito/ciudad. Nunca cruzar de rubro. Se dice en el PDF
   qué radio se usó ("12 farmacias a menos de 2 km").
3. **Dos rankings, no uno**: *visibilidad* (reseñas) y *calidad* (calificación con promedio
   bayesiano, mínimo 10 reseñas). El PDF muestra el que **favorece o motiva** al negocio: si es
   nuevo pero bien calificado, se le habla de calidad; si tiene volumen, de visibilidad.
4. **Motor de insights por reglas** con prioridad y exclusión mutua (máximo 3, nunca
   contradictorios), vocabulario por vertical, y un "hecho ancla" que se reutiliza en el mensaje
   de WhatsApp ("vi que tienen 120 reseñas, más que el promedio de su zona").
5. **Cálculo en el backend** (`GET /api/leads/:id/insights`) con SQL sobre los índices que ya
   existen; caché por (rubro, celda); tests con casos fijos (negocio líder, nuevo, sin rubro,
   zona con 3 competidores).

**Entrega:** endpoint + tests + panel usando el endpoint; el PDF actual ya mejora sin tocar su diseño.

## 2. Frente B — La propuesta PDF

**Meta:** un documento que el dueño entienda en 15 segundos desde el celular y que parezca hecho
por un estudio de diseño, sin depender de internet ni de servicios externos.

**Decisión de arquitectura (recomendada: opción 1):**

| Opción | Pros | Contras |
|---|---|---|
| 1. **Modelo de documento + renderizador jsPDF con sistema de diseño** | Sigue sin dependencias, funciona offline y en modo archivo; una sola fuente de verdad para PDF e impresión. | Hay que construir el mini-sistema de layout (columnas, tarjetas, tablas). |
| 2. HTML → PDF con Chromium en el servidor (Playwright) | Fidelidad total: CSS, fuentes, gráficas, fotos. | +300 MB de dependencia; no funciona en modo archivo; el usuario corre en Windows con scripts `.ps1`. |

Plan con la opción 1:

1. **Modelo de documento** (`proposal-model.js`): la propuesta como datos
   (`{cover, kpis[], chart, comparison[], plan[], cta}`) generados por el Frente A. Los dos
   renderizadores (jsPDF y HTML) consumen el mismo modelo: ya no pueden divergir.
2. **Sistema de diseño del documento**: retícula de 4 pt, escala tipográfica (30/18/12/10.5/9),
   márgenes, tarjetas, tablas, chips, iconos vectoriales (los actuales, unificados), y la paleta
   validada. **Fuente de marca incrustada** (Sora 700 + IBM Plex Sans 400/600, subconjunto latino,
   ~90 KB cada una en base64) para que PDF y panel sean el mismo producto.
3. **Nueva estructura**: *portada de una página* (foto del negocio si existe, nombre, la promesa,
   3 números grandes, QR) + *página de detalle* (gráfica, tabla hoy/con sistema, plan de 3 pasos,
   cierre). Versión **"1 página para WhatsApp"** y versión completa. Cuerpo mínimo 10 pt.
4. **Foto y mapa**: miniatura de Google servida por el backend (`GET /api/img?u=` con caché en
   `data/cache/`) para evitar CORS; mini-mapa estático con los competidores como puntos (tiles OSM
   cacheadas; si no hay internet, se omite sin romper).
5. **Detalles de documento serio**: folio (`SKT-2026-0142`), fecha, validez 15 días, número de
   página, nombre y contacto del asesor en cada página, enlace de demo tocable.
6. **Pruebas visuales**: script Playwright que genera 6 propuestas fijas (líder, nuevo, sin
   rubro, sin foto, nombre largo, sin QR) y guarda PNG de referencia; el CI avisa si cambian.

## 3. Frente C — Logo e identidad Sky Tech

**Meta:** un distintivo que se reconozca a 16 px y se vea premium a 200 px, dibujado **una sola vez**.

1. **Brief**: cielo/nube = sistema en la nube, siempre disponible; tech = precisión y energía.
   Tono: sobrio, confiable, para dueños de negocio (no para desarrolladores).
2. **Tres conceptos en SVG** para elegir (los entrego en la siguiente iteración):
   - **C1 "Nube-S"**: una sola curva continua que forma nube y "S" con una flecha ascendente.
   - **C2 "Horizonte"**: monograma ST en cuadrado redondeado con línea de horizonte y punto de sol.
   - **C3 "Nube + rayo refinado"**: el concepto actual, con una sola trayectoria de nube (radios
     coherentes) y rayo en negativo, más grande, que sobrevive a 16 px.
3. **Sistema**: isotipo, logo horizontal, logo apilado, versión monocroma, versión sobre oscuro;
   wordmark en Sora 700 ("SKY" en marino, "TECH" en celeste); zona de protección y tamaños mínimos.
4. **Una sola fuente de verdad**: el `path` SVG se guarda en `marca/logo.json` y un convertidor
   pequeño (`svgPathToJsPdf`) lo dibuja en el PDF. Se elimina `skyBadge` dibujado a mano.
5. **Entregables**: `marca/` regenerado, favicon 16/32/180, icono 512 para acceso directo en
   celular, `MARCA.md` actualizado, y el panel usando el nuevo logo.

## 4. Frente D — Mensajes que consiguen respuesta

**Meta:** mensajes cortos, personales y distintos entre sí, con secuencia y medición.

1. **Anatomía fija, textos variables**: *apertura personal con un hecho real* (del Frente A) →
   *problema del rubro en una frase* → *oferta en una línea* → *pregunta que se responde con "sí"*.
   ≤ 350 caracteres (cabe en la vista previa de WhatsApp). "Gratis" una sola vez, en minúscula.
2. **3 variantes por vertical** (13 verticales × 3 = 39 aperturas) rotadas automáticamente, y
   **secuencia de 3 mensajes**: inicial (día 0) → recordatorio suave (día 2–3) → cierre con salida
   (día 7: "si no es para usted, no le vuelvo a escribir"). Cumple la Ley 29733 y baja bloqueos.
3. **Historial por lead** (`meta.messages[]`: fecha, variante, canal) y vista "para contactar
   hoy" con el siguiente paso de la secuencia; métrica **respuestas por variante** en Métricas.
4. **Guía de tono** (documento corto): usted, sin tecnicismos, sin mayúsculas gritadas, sin
   emojis en cada frase, sin prometer números que no salen de sus datos.
5. **Correo**: asuntos por vertical y firma con logo; el mismo motor genera WhatsApp y correo.

## 5. Frente E — Diseño del panel

**Meta:** que panel, PDF y logo se vean como un mismo producto, y que el flujo diario (escanear →
filtrar → escribir → seguir) tenga menos clics.

1. **Tokens de marca compartidos** (`public/css/tokens.css` + `SKY` en JS): acento = celeste
   Sky Tech, marino para cabeceras; modo oscuro revisado con la misma paleta.
2. **Separar el panel** en `public/` (CSS, JS por módulos: `api.js`, `state.js`, `views/*`,
   `pdf/*`), manteniendo el modo archivo (doble clic) con un `build` que vuelve a incrustar todo
   en un solo HTML.
3. **Tarjeta y ficha del negocio rediseñadas**: foto, rubro, puesto y hecho ancla arriba; botones
   de acción (WhatsApp, PDF, llamar) siempre visibles; estados del pipeline como segmento.
4. **Estados vacíos y primer uso**: qué hacer cuando no hay leads, cuando no hay binario, cuando
   el escaneo está en pausa por bloqueo.
5. **Móvil**: el panel se usa desde el celular para escribir; barra de acciones inferior.

## 6. Frente F — Lo demás (de `PROPUESTA-MEJORAS.md`)

Seguimientos con aviso Telegram, importar CSV con dedupe, escaneo programado, normalizar
teléfonos (móvil vs fijo antes de abrir WhatsApp). Entran en la fase 5 o antes si se necesitan.

---

## 7. Orden de ejecución

| Fase | Contenido | Por qué en este orden | Entregable verificable |
|---|---|---|---|
| **1** | Frente A completo (taxonomía, zona por distancia, dos rankings, insights, endpoint) | Es la base: el PDF y los mensajes nuevos consumen estos datos. Mejora el PDF actual sin tocar el diseño. | `/api/leads/:id/insights` con tests; el PDF actual deja de comparar entre rubros. |
| **2** | Frente C (logo, 3 conceptos → elección → sistema completo) + tokens de marca (E.1) | Es corto, desbloquea el PDF nuevo (portada) y el panel (colores). | `marca/` nuevo, favicon, panel con el logo y acento de marca. |
| **3** | Frente B (modelo de documento, renderizador, fuentes, foto, 1 página + completa, pruebas visuales) | Con datos correctos y marca definida, el PDF se hace una sola vez bien. | 6 propuestas de referencia en PNG; QR y demo funcionando offline. |
| **4** | Frente D (motor de mensajes, variantes, secuencia, historial, métrica) | Usa el hecho ancla de A y el PDF nuevo como adjunto. | Vista "para contactar hoy" + respuestas por variante en Métricas. |
| **5** | Frente E (separación en `public/`, tarjeta/ficha, móvil, estados vacíos) + Frente F | Cambio grande de estructura; mejor con todo lo anterior estable. | Panel modular, `build` a un solo archivo, misma suite de tests en verde. |

Cada fase termina con: tests en verde, prueba en navegador real (Chromium) y PR actualizado.

## 8. Decisiones que necesito de ti

1. **Logo**: ¿te entrego los 3 conceptos para elegir, o refinamos el actual (C3) directamente?
2. **PDF**: ¿opción 1 (jsPDF con sistema de diseño, sin dependencias, offline) o opción 2
   (Chromium en el servidor)? Recomiendo la 1.
3. **Fuentes incrustadas** en el PDF (+~180 KB en el HTML) sí / no. Recomiendo sí.
4. **Mensajes**: ¿mantenemos la oferta "acceso gratis a cambio de feedback" o pasamos a
   "prueba gratis 14 días"? El plan funciona con ambas; cambia el texto.
5. **Foto del negocio y mini-mapa** en la portada (requieren internet al generar): sí / no.

## 9. Riesgos y cómo se controlan

- **Romper el PDF actual mientras se hace el nuevo**: el nuevo vive en `pdf/v2` con un
  interruptor en Ajustes; el viejo se retira cuando el nuevo pasa las pruebas visuales.
- **Comparaciones sin datos**: la regla es explícita: < 5 competidores reales → el PDF muestra
  la sección de rubro sin ranking y el mensaje no cita cifras.
- **WhatsApp**: variantes + secuencia + salida bajan el riesgo de bloqueo; se documenta en el README.
- **Tamaño del HTML**: las fuentes y el logo van en archivos aparte en `public/` (fase 5); en el
  modo archivo se incrustan con el `build`.

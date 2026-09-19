# Revisión de la base de código — hallazgos y decisiones

Auditoría hecha al incorporarse al proyecto (server.js de 834 líneas + dashboard.html de 1741
líneas), con el criterio de un ingeniero senior: entender primero, cambiar después, y **no
alterar el comportamiento** salvo para corregir fallos claros. Cada punto dice qué se encontró,
por qué importa y qué se hizo.

## 1. Problemas estructurales

| # | Hallazgo | Impacto | Qué se hizo |
|---|---|---|---|
| S1 | Un solo archivo con ~40 variables globales mutables (`scan`, `child`, `curCell`, `pollT`, `db`, `cfg`…) compartidas por 60 funciones. | Imposible de testear; cualquier función puede romper el estado de otra. | `Scanner` es una clase con todo su estado como campos y dependencias por constructor (`store`, `bus`, `runner`, `settings`, `timers`). |
| S2 | Acceso directo a la forma del JSON (`db.leads[id]`, `db.order.push`) desde escáner, enriquecedor, rutas y `stats.js`. | Cambiar el almacenamiento obligaba a tocar todo. | Interfaz de almacén (`insertLead`, `updateLeadMeta`, `addScanned`…) con dos implementaciones intercambiables (JSON y SQLite) y un contrato de tests compartido. |
| S3 | HTTP, orquestación, parsing, notificaciones y proxies en el mismo módulo. | Sin fronteras: un cambio en Telegram podía romper el escaneo. | Capas `config/ domain/ infra/ services/ http/`; `app.js` como única raíz de composición. |
| S4 | `process.env` leído en cualquier punto. | No se puede arrancar dos instancias (tests) con configuración distinta. | `config/env.js` inmutable, inyectado. |
| S5 | Sin tests de ningún tipo. | Cada "mejora" de las 77 del plan era a ciegas. | 34 tests (dominio, almacenes, escáner con runner simulado, HTTP end-to-end, SSE). |

## 2. Código duplicado

- `testProxy` y `testProxyFast` (dos copias del mismo test con distinto timeout) → una función con
  `{timeout}`.
- Normalización de proxies repetida en tres sitios (`getBackendProxies`, `startScan`, `seedProxies`)
  → `domain/proxy.parseProxyList`.
- Escritura de headers CORS/JSON en cada rama del `if` gigante → `sendJson` / `sendText`.
- Tres bloques casi idénticos de limpiar timers + matar hijo + `finishCell` (timeout de celda,
  `exit`, watchdog) → un flujo con guardas `this.child !== child`.
- Los dos reintentos de celda (con y sin proxies) → `_retryCell(cell, waitMs, msg)`.

## 3. Cuellos de botella de rendimiento

| # | Hallazgo | Medida |
|---|---|---|
| P1 | `save()` serializaba **toda** la base (`JSON.stringify(db)`) y la reescribía en disco cada 200 ms mientras llegaban leads: O(N) por lead, decenas de MB/min con 20k leads. | SQLite: una fila por lead, sentencias preparadas, WAL. El driver JSON sigue disponible con la misma lógica de antes. |
| P2 | `statusObj()` llamaba a `getBackendProxies()` que leía dos archivos del disco (sync) en cada `broadcast("status")` — varias veces por segundo durante el escaneo. | Caché de 5 s en `ProxyService`. |
| P3 | `/api/leads` devuelve todo siempre. | Se mantiene por compatibilidad; se añade `?limit&offset` para que el panel pueda paginar. |
| P4 | `db.scanned.includes(key)` en un array de hasta 5000 elementos por cada celda. | `scanned_cells` con clave primaria (O(log n)); en JSON se mantiene igual. |
| P5 | `ingestCell` releía y reparseaba **todo** el CSV de la celda cada 300 ms (O(filas²) por celda). | Lectura incremental por offset + `splitCompleteRows`; inserciones por lote. |
| P6 | Una sola celda a la vez: pausas antibaneo y timeouts de celdas vacías se sumaban en serie. | Trabajadores en paralelo (`workers` 1–4, defecto 1). Detalle y medidas en `PROPUESTA-MEJORAS.md`. |

## 4. Riesgos de mantenibilidad

- Líneas de 300+ caracteres con varias sentencias (`function x(){a;b;c;if(d)e;}`) → formateo normal.
- Nombres que ocultan intención (`nextT`, `curEmitted`, `lastLogB`) → conservados donde el
  panel los conoce, documentados donde no.
- Comentarios en mayúsculas sobre "NUNCA SE PARA" sin tests que lo garanticen → ahora hay tests
  para bloqueo → reintento → error, pausa/reanudar, stop, binario ausente y auto-reanudación.
- `README` describe Docker para el scraper pero no cómo correr el panel en producción →
  `Dockerfile` + servicio `panel` en `docker-compose.yml`.

## 5. Errores encontrados (modo depuración)

| # | Síntoma | Causa raíz | Corrección |
|---|---|---|---|
| B1 | Tras pausar y reanudar rápido, aparecían dos scrapers a la vez y el mapa "saltaba" celdas. | `resume()` llamaba a `processNext()` aunque hubiera un hijo en curso (la pausa no mata el proceso). | `resume()` solo relanza si no hay celda en curso; si la hay, su fin encadena la siguiente. Test: *"pausar y reanudar… no lanza un segundo scraper"*. |
| B2 | Después de un corte por watchdog, a veces se saltaba la siguiente celda o se contaba dos veces. | `cellStart` no se ponía a 0 al cerrar una celda; durante la pausa entre celdas (hasta 25 s en enfriamiento) el watchdog volvía a disparar sobre la celda ya cerrada → doble `advance()`. | `_finishCell` pone `cellStart = 0`. |
| B3 | Si faltaba el binario `gms`, el servidor mostraba el error pero **en cada arranque** intentaba auto-reanudar y fallaba otra vez. | `runCell` ponía `running=false` sin limpiar `db.activeScan`. | Se limpia el escaneo activo al fallar el lanzamiento. Test: *"sin binario del scraper…"*. |
| B4 | `POST /api/reset` durante un escaneo dejaba el scraper corriendo y provocaba `TypeError: scan is null` en `finishCell`. | Se hacía `scan = null` sin detener el proceso ni los timers. | `scanner.discard()` detiene todo antes de vaciar. |
| B5 | Un reintento programado (`setTimeout(runCell)`) podía ejecutarse después de `stop()`. | El timer de reintento se guardaba en `nextT` pero `runCell` no comprobaba si el escaneo seguía vivo. | Guarda `if (!scan || !scan.running) return` en `_runCell` y en el callback del reintento. |
| B6 | Un cuerpo JSON de cualquier tamaño se acumulaba en memoria. | `body()` sin límite. | Límite de 1 MB → `413`, drenando el cuerpo para responder limpio. |
| B7 | Comparación de credenciales con `===`. | Vulnerable a timing (menor, pero gratis de arreglar). | `crypto.timingSafeEqual` con longitudes comprobadas. |
| B9 | Un reintento de celda que vencía mientras el escaneo estaba en pausa dejaba la celda en amarillo para siempre (y al reanudar se saltaba). | El callback del reintento no hacía nada si estaba en pausa. | El trabajo queda `waiting` y `resume()` lo relanza. |
| B10 | Las celdas con error reintentadas al final nunca se cerraban por `exit`, solo por timeout. | `finish()` copiaba la celda entera, incluido `_timedout: true`, y el handler de `exit` lo respetaba. | Los reintentos crean una celda limpia; el timeout vive en el trabajo, no en la celda. |
| B8 | (Introducido y cazado en la refactorización) `bus.emit("error")` sin oyente tumba el proceso. | Semántica especial de `error` en `EventEmitter`. | `broadcast` solo emite `error` si hay oyentes; test lo cubre. |

### Casos límite ahora cubiertos por tests
Área inválida · doble inicio · zona ya barrida al 100 % · CSV parcial (última fila sin `\n`) ·
fila repetida en la misma celda · exclusión por nombre · tope de leads · bloqueo persistente
(3 intentos con proxies, 2 en directo) · `stop` con hijo vivo · JSON corrupto con `.bak` ·
migración repetida · body demasiado grande · JSON inválido · auth incorrecta.

### Comportamientos conservados a propósito (aunque discutibles)
- El **tope de leads** es blando: pausa el escaneo pero la celda en curso termina de ingerir sus filas.
- El **watchdog de 100 s** manda sobre `cellMax` cuando este supera 1 min 40 s (el ajuste
  permite hasta 2.5 min). Se documenta; unificarlo es decisión de producto.
- `/api/leads` sigue devolviendo todo por defecto (el panel lo espera así).

## 6. Estrategias de refactorización aplicadas

1. **Caracterizar antes de mover**: se leyeron los 18 eventos SSE y 16 endpoints que usa el
   panel y se fijaron como contrato (docs/API.md); los tests HTTP los verifican.
2. **Extraer lo puro primero** (`domain/`): sin riesgo y con tests inmediatos.
3. **Introducir la interfaz de almacén** y probarla con un contrato compartido antes de
   cambiar el driver.
4. **Encapsular el estado** del escáner en una clase; inyectar `timers` para que los backoffs de
   segundos se prueben en milisegundos.
5. **Componer en un solo sitio** (`app.js`) y dejar `server.js` como shim retrocompatible.

## 7. Comentarios de revisión (Revisor → Ingeniero) y respuesta

- *"¿Por qué JSON en `data` y no columnas para todo?"* — El panel consume el lead como documento
  y el scraper añade campos con el tiempo (36 columnas). Proyectar solo lo que se filtra evita
  migraciones por cada campo nuevo y mantiene el contrato intacto.
- *"`node:sqlite` es experimental."* — Sí (aviso al arrancar). Por eso el driver JSON sigue vivo
  con `DB_DRIVER=json` y la migración es idempotente y conserva el JSON. Cuando `better-sqlite3`
  se justifique, `SqliteStore` es el único archivo a tocar.
- *"El panel sigue siendo un archivo de 183 KB."* — Correcto; fuera del alcance de esta entrega
  para no arriesgar el PDF/QR/mapa. Camino en docs/ARQUITECTURA.md §6.
- *"Los tests de escáner usan tiempos reales."* — Solo el de demo (≈3 s); el de bloqueos usa
  temporizadores acelerados 50×. Suite completa: ~15 s.

## 8. Versión final optimizada (Optimizador)

- Escrituras O(1) por lead (SQLite) frente a O(N).
- Cero lecturas de disco en el camino caliente de `status`.
- Índices para los filtros del panel (categoría, ciudad, país, teléfono) y para el enriquecedor
  (`enriched = 0`).
- `EventBus` con un solo `stringify` por evento para todos los clientes.
- Apagado limpio (`SIGINT/SIGTERM`): mata el scraper, cierra SSE y SQLite.

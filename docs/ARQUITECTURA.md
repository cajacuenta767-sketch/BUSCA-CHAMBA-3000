# Arquitectura — BUSCA-CHAMBA-3000 v2

Sistema de generación de leads para freelancers: barre Google Maps por cuadrícula, guarda cada
negocio, lo muestra en un panel en vivo y ayuda a cerrarlo (WhatsApp, propuesta PDF, pipeline).

Este documento describe la arquitectura **tal como quedó tras la refactorización** de `server.js`
(un archivo de 834 líneas con estado global) a módulos con responsabilidades separadas. El
comportamiento visible (API, eventos SSE, panel) es el mismo; cambia la estructura, el
almacenamiento y la testabilidad.

---

## 1. Vista general

```
┌──────────────────────────────── navegador ────────────────────────────────┐
│  dashboard.html  (SPA sin framework: tabs Inicio · Resultados · Métricas · │
│  Herramientas; Leaflet para el mapa; jsPDF/xlsx para exportar)             │
│        │ fetch /api/*            ▲ EventSource /api/stream (SSE)           │
└────────┼─────────────────────────┼────────────────────────────────────────┘
         ▼                         │
┌──────────────────────────── Node 22 (sin npm deps) ───────────────────────┐
│ http/        router · middleware (auth, CORS, body) · routes               │
│ services/    Scanner (máquina de estados) · Enricher · Notifier · Proxies  │
│              EventBus (SSE + EventEmitter)                                  │
│ domain/      grid · lead · csv · proxy   (funciones puras)                  │
│ infra/       storage (SQLite | JSON) · ScraperRunner · http-client · logger │
│ config/      env · settings · categories                                    │
└────────┬───────────────────────────────────────────┬──────────────────────┘
         ▼                                            ▼
  data/busca-chamba.sqlite  (o data/db.json)     proceso hijo: gms / docker
                                                 gosom/google-maps-scraper
                                                        │ CSV por celda
                                                        ▼
                                                  Google Maps (público)
```

Principios:

- **Dependencias hacia adentro.** `domain/` no conoce nada; `services/` conocen `domain/` y reciben
  la infraestructura por constructor; `http/` solo traduce HTTP ↔ servicios; `app.js` es la única
  raíz de composición.
- **Cero dependencias npm.** SQLite viene con Node (`node:sqlite`, Node ≥ 22.13). Si no está,
  se usa el JSON original de forma transparente.
- **Todo lo que cambia se emite.** Los servicios no saben qué es SSE: publican en el `EventBus`
  y el bus lo reparte a los clientes conectados y a cualquier suscriptor interno (tests, Telegram).

---

## 2. Estructura de archivos

```
BUSCA-CHAMBA-3000/
├── server.js                    # shim retrocompatible → require("./src/server")
├── stats.js                     # CLI: resumen de leads (usa el mismo almacén)
├── dashboard.html               # panel (sin cambios funcionales)
├── package.json                 # scripts: start · dev · test · stats · migrate
├── Dockerfile · docker-compose.yml
├── scripts/
│   └── migrate-json-to-sqlite.js
├── src/
│   ├── server.js                # arranque: env → createApp → listen → autoResume
│   ├── app.js                   # raíz de composición (inyección de dependencias)
│   ├── config/
│   │   ├── env.js               # process.env → objeto inmutable con rutas
│   │   ├── settings.js          # ajustes del usuario (config.json) validados
│   │   └── categories.js        # rubros y consultas paraguas
│   ├── domain/                  # puro, sin I/O, 100 % testeable
│   │   ├── grid.js              # celdas, auto-ajuste, subdivisión, "ya barrida"
│   │   ├── lead.js              # fila CSV → lead, identidad, correos, redes
│   │   ├── csv.js               # parser RFC-4180
│   │   └── proxy.js             # normalización de proxies
│   ├── infra/
│   │   ├── storage/
│   │   │   ├── index.js         # createStore(): elige driver
│   │   │   ├── sqlite-store.js  # node:sqlite, migraciones versionadas
│   │   │   ├── json-store.js    # formato original (atómico + .bak)
│   │   │   └── migrate.js       # db.json → SQLite (idempotente)
│   │   ├── scraper-runner.js    # binario/docker: argumentos, spawn, kill
│   │   ├── http-client.js       # GET/POST/fetchPage/testProxy
│   │   └── logger.js            # anillo de 400 líneas
│   ├── services/
│   │   ├── scanner.js           # orquestador de celdas (corazón)
│   │   ├── enricher.js          # correos y redes desde la web propia
│   │   ├── notifier.js          # Telegram (cola) + webhook
│   │   ├── proxies.js           # backend, semilla, listas públicas
│   │   ├── event-bus.js         # SSE + EventEmitter
│   │   └── demo.js              # leads de ejemplo
│   └── http/
│       ├── router.js            # método+ruta → handler
│       ├── middleware.js        # JSON, auth constante, CORS, límite de cuerpo
│       └── routes/index.js      # todos los endpoints
├── test/                        # node:test, sin dependencias
│   ├── helpers.js               # env temporal, FakeRunner, temporizadores acelerados
│   ├── domain.test.js · storage.test.js · scanner.test.js · http.test.js · settings.test.js
└── docs/
    ├── ARQUITECTURA.md          # este archivo
    ├── API.md                   # endpoints y eventos SSE
    └── REVISION.md              # auditoría: problemas encontrados y qué se hizo
```

---

## 3. Flujo de datos

### 3.1 Escaneo (camino caliente)

```
POST /api/scan/start {area, cellKm, mode, rubros, proxies, exclude, maxLeads, demo}
   │
   ▼  Scanner.start()
   ├─ grid.fitCells()        → celdas (≤ 550, sube km si hace falta)
   ├─ grid.sortFromCenter()  → del centro hacia afuera
   ├─ grid.markScanned()     → celdas ya barridas en verde (store.scannedKeys)
   ├─ proxies.anyAlive()     → proxies o "modo directo seguro"
   ├─ store.setActiveScan()  → sobrevive a reinicios (autoResume)
   └─ bus: cells, status     → el mapa se pinta
   │
   ▼  _processNext()  ──────────────────────────────────────────┐
   ├─ runner.start(job)  → proceso hijo escribe data/cell.csv    │
   ├─ cada 300 ms: _ingestCell() → csv.parseCSV → lead.rowToLead │
   │       └─ ingestLead(): exclude → leadId → store.insertLead  │
   │             └─ bus "lead" · notifier.notifyLead · maxLeads  │
   ├─ stderr: BLOCK_RE → cell._blocked · QUOTA_RE → sin proxies  │
   ├─ exit / ventana (cellMax) / watchdog 100 s → _finishCell()  │
   │       ├─ reintentos si bloqueada (3 con proxies, 2 directo) │
   │       ├─ store.addScanned(key)  (persistencia inmediata)    │
   │       ├─ consecBlocks ≥ maxBlocks → enfriar 15/25 s         │
   │       ├─ found ≥ subdivideAt → splitCell ×4 (bus cellsadd)  │
   │       └─ _advance() → pausa aleatoria (pauseMin..pauseMax) ─┘
   │
   ▼  _finish(): reintenta celdas "error" una vez → history · done · Telegram
```

### 3.2 Lectura del panel

`GET /api/leads` devuelve todo (status + leads + celdas + historial) para el primer pintado;
después el panel solo escucha SSE. Con `?limit=&offset=` se pagina (nuevo, opcional).

### 3.3 Enriquecimiento

`POST /api/enrich` → `Enricher` toma los leads con web propia y sin `_enr`, 4 en paralelo,
`fetchPage` (300 KB, 9 s), extrae correos y redes, `store.saveLead`, emite `leadup`/`enrich`.

---

## 4. Esquema de base de datos (SQLite)

Modelo **documento + proyecciones**: el lead completo va en `data` (JSON, lo que consume el
panel) y las columnas de consulta se extraen para indexar y filtrar en SQL sin cambiar el
contrato del frontend.

```sql
CREATE TABLE leads (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,  -- orden de llegada (= db.order)
  id         TEXT    NOT NULL UNIQUE,            -- place_id | link | tel:NNN | título|dirección
  title      TEXT    NOT NULL,
  category   TEXT, city TEXT, country TEXT, phone TEXT, website TEXT,
  rating     REAL    NOT NULL DEFAULT 0,
  reviews    INTEGER NOT NULL DEFAULT 0,
  lat REAL, lon REAL,
  data       TEXT    NOT NULL,   -- JSON del lead (sin _meta/_enr)
  meta       TEXT,               -- JSON: {state, notes, follow, ...} (pipeline CRM)
  enriched   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX idx_leads_category ON leads(category);
CREATE INDEX idx_leads_city     ON leads(city);
CREATE INDEX idx_leads_country  ON leads(country);
CREATE INDEX idx_leads_phone    ON leads(phone);
CREATE INDEX idx_leads_enriched ON leads(enriched);

CREATE TABLE scanned_cells (key TEXT PRIMARY KEY, scanned_at INTEGER NOT NULL);
CREATE TABLE scan_history  (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL,
                            found INTEGER, cells INTEGER, mode TEXT, area TEXT /* JSON */);
CREATE TABLE kv            (key TEXT PRIMARY KEY, value TEXT);   -- activeScan, migrated_from_json
CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
```

- `PRAGMA journal_mode=WAL` (lecturas no bloquean escrituras) y `synchronous=NORMAL`.
- Migraciones versionadas en `MIGRATIONS[]` (`sqlite-store.js`); cada una corre en transacción.
- **Migración desde `db.json`**: automática en el primer arranque, idempotente (marca en `kv`),
  y el JSON se conserva como respaldo. También manual: `npm run migrate`.
- Elección de driver: `DB_DRIVER=auto|sqlite|json` (auto = SQLite si `node:sqlite` existe).

Interfaz común de almacenamiento (ambos drivers): ver cabecera de `src/infra/storage/index.js`.

---

## 5. API

Detalle completo en [`API.md`](API.md). Resumen:

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/` , `/dashboard.html` | Panel (sin caché) |
| GET | `/api/health` | Salud: driver, leads, escaneo activo, uptime |
| GET | `/api/status` | Estado del escaneo (misma forma en reposo y en marcha) |
| GET | `/api/leads?limit&offset` | Leads + celdas + categorías + historial |
| GET | `/api/stream` | SSE: `status cells cell cellsadd progress lead leadup update enrich notice log error done reset` |
| GET | `/api/logs` | Últimas 400 líneas de log (texto) |
| POST | `/api/scan/start` · `pause` · `resume` · `stop` | Control del escaneo |
| POST | `/api/lead/update` | `{id, patch}` → mezcla en `_meta` (pipeline, notas) |
| POST | `/api/reset` | Borra leads (conserva historial y celdas) y detiene el escaneo |
| GET/POST | `/api/config` | Ajustes (vista pública sin secretos / parche validado) |
| POST | `/api/test-telegram` | Guarda token y envía mensaje de prueba |
| POST | `/api/proxies/fetch` | Descarga listas públicas y prueba cuáles viven |
| POST | `/api/enrich` · `/api/enrich/stop` | Enriquecedor |

Seguridad: `BASIC_AUTH="usuario:clave"` protege todo (comparación en tiempo constante); cuerpo
JSON limitado a 1 MB (`MAX_BODY_BYTES`); CORS abierto como antes (uso local/VPS propio).

---

## 6. Arquitectura de la interfaz (dashboard.html)

El panel es una SPA de un solo archivo, sin framework, organizada así:

| Capa | Dónde | Responsabilidad |
|---|---|---|
| Estado | variables de módulo (`leads`, `meta`, `cells`, `scan`) | fuente de verdad en memoria; `meta` (pipeline/notas) se sincroniza con `/api/lead/update` |
| Transporte | `loadAll()` (`/api/leads`) + `connectSSE()` (`/api/stream`) | carga inicial + actualizaciones incrementales; reconexión automática por `retry:` |
| Vistas (tabs) | `#tab-inicio` (mapa Leaflet + control) · `#tab-resultados` (tarjetas/kanban) · `#tab-metricas` · `#tab-tools` | cada tab se renderiza con `render*()` a partir del estado |
| Componentes | `card()`, `renderKanban()`, `openModal()` (ficha), `toast()`, `buildMsg()` | plantillas por string HTML; sin virtual DOM, con carga progresiva (`appendChunk`) |
| Documentos | `proposalPDF()` (jsPDF) · `openProposalPrint()` (impresión) · `exportExcel()` (xlsx) · `qrSVG()` (QR incrustado) | generación local, sin backend |
| Modo archivo | `importCSV()` | funciona sin servidor (doble clic) |

Contrato con el backend: solo `/api/*` y los eventos SSE listados; por eso la refactorización
del servidor no tocó el panel. Camino de evolución recomendado (no incluido en esta entrega):

1. Extraer CSS y JS a `public/` servidos estáticos (cacheables) manteniendo el modo archivo.
2. Dividir el JS en módulos ES: `api.js` (fetch/SSE), `state.js`, `views/*.js`, `pdf.js`.
3. Paginación real en Resultados usando `?limit&offset` (ya soportado por el backend).

---

## 7. Estrategia de caché

| Qué | Dónde | Por qué |
|---|---|---|
| Lista de proxies del backend | `ProxyService` (5 s) | antes se leían archivos en cada `status` (varias veces por segundo durante el escaneo) |
| Sentencias SQL | `SqliteStore._prepare()` | preparadas una vez; escrituras por fila en vez de reescribir todo el JSON |
| Celdas barridas | `scanned_cells` + `markScanned()` | evita repetir zonas entre sesiones ("continuar donde se quedó") |
| Panel | `Cache-Control: no-store` | el HTML cambia con cada versión; los CDN (Leaflet, jsPDF) sí se cachean en el navegador |
| Estado del escaneo | memoria (`Scanner.scan`) + `kv.activeScan` | lo caliente en RAM; lo necesario para reanudar en disco |

Lo que **no** se cachea a propósito: `/api/leads` (el panel lo pide una vez por carga) y el
estado SSE (siempre fresco).

---

## 8. Escalabilidad: qué cambiaría y qué no

- **Hoy (1 usuario, 1 máquina):** un proceso Node, SQLite, un scraper a la vez. Suficiente para
  decenas de miles de leads (medido: escritura por fila, lecturas indexadas).
- **Siguiente escalón (varios usuarios / VPS):** el `Scanner` ya es una clase con dependencias
  inyectadas: instanciar uno por "cuenta" y añadir `account_id` a las tablas. `EventBus` puede
  respaldarse en Redis Pub/Sub sin tocar los servicios. `ScraperRunner` es el único lugar que
  conoce el binario: cambiarlo por una cola (BullMQ/SQS) no toca el orquestador.
- **Lo que no hace falta aún:** framework HTTP, ORM, contenedores para todo. Se añaden cuando
  el dolor sea real (YAGNI).

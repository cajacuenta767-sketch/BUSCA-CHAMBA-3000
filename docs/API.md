# API HTTP y eventos SSE

Base: `http://localhost:8090`. Todas las respuestas JSON llevan `Access-Control-Allow-Origin: *`.
Con `BASIC_AUTH` definido, toda ruta exige `Authorization: Basic …`.

## Estado

### `GET /api/health`
```json
{ "ok": true, "driver": "sqlite", "leads": 1240, "scanning": false, "uptime": 812 }
```

### `GET /api/status`
En reposo:
```json
{ "running": false, "backendProxies": 0, "totalDbLeads": 1240, "dbScannedCount": 318 }
```
En marcha:
```json
{ "running": true, "paused": false, "mode": "all", "cellsTotal": 96, "cellsDone": 12,
  "overallTotal": 96, "overallDone": 12, "skipped": 4, "found": 87, "sessionSeen": 130,
  "totalDbLeads": 1327, "cellIdx": 13, "cellFound": 6, "cellSecs": 41, "scanSecs": 930,
  "lastLeadSecs": 3, "queries": 15, "backendProxies": 0, "workers": 2, "activeCells": 2 }
```

### `GET /api/leads?limit=0&offset=0`
```json
{ "status": {…}, "leads": [Lead…], "total": 1240, "cells": [{key,bbox,state,found}…],
  "categories": ["restaurante", …], "history": [{ts,found,cells,mode,area}…] }
```
`limit=0` (por defecto) devuelve todo, como antes.

**Lead**
```json
{ "title": "Botica Sol", "category": "Farmacia", "address": "Av. Sol 123, Cusco", "city": "Cusco",
  "country": "PE", "phone": "+51 987 654 321", "website": "", "emails": [], "social": {"fb": "…"},
  "rating": 4.6, "reviews": 1234, "lat": -13.52, "lon": -71.97, "link": "https://maps…",
  "place_id": "ChIJ…", "thumb": "https://…", "about": "Delivery · Wifi", "images": [],
  "_meta": { "state": "contactado", "notes": "…", "follow": "2026-10-01" }, "_enr": 1 }
```

### `GET /api/stream` (SSE)
Envía `retry: 3000`, un `status` inicial y luego:

| Evento | Payload | Cuándo |
|---|---|---|
| `status` | objeto de `/api/status` | cambia el estado del escaneo |
| `cells` | `{cells:[{key,bbox,state}], area, total, doneCount}` | al iniciar |
| `cell` | `{key, state, found}` | una celda cambia (`scanning`/`done`/`empty`/`error`) |
| `cellsadd` | `{cells:[…]}` | subdivisión de una celda densa |
| `progress` | `{cellsDone, cellsTotal, found}` | termina una celda |
| `lead` | Lead + `lastLeadAt` | lead nuevo guardado |
| `leadup` | Lead | el enriquecedor añadió correo/redes |
| `update` | `{id, meta}` | `POST /api/lead/update` |
| `enrich` | `{total, done, mails, socs, running}` | progreso del enriquecedor |
| `notice` | `{msg}` | aviso para el usuario (antibaneo, tope, ajuste de celda) |
| `log` | `{line}` | línea relevante del scraper (máx. 1 cada 4 s) |
| `error` | `{message}` | error fatal (falta el binario) |
| `done` | `{found, cells}` | escaneo terminado o detenido |
| `reset` | `{}` | `POST /api/reset` |

### `GET /api/logs` → texto plano, últimas 400 líneas.

## Escaneo

### `POST /api/scan/start`
```json
{ "area": [sur, oeste, norte, este], "cellKm": 1, "mode": "all" | "rubros", "rubros": ["farmacia"],
  "proxies": "ip:puerto\n…", "exclude": "casino, banco", "maxLeads": 0, "skipScanned": true,
  "email": false, "demo": false }
```
Respuesta: `{ok, cells, mode, cellKm, adjusted, askedKm, skipped, pending, proxies, workers}` o `{error}`.

Reglas: máximo 550 celdas (sube `cellKm` solo hasta que quepa); celdas ya barridas se saltan si
`skipScanned` ≠ false; sin binario del scraper → evento `error` y el escaneo no queda "activo".

### `POST /api/scan/pause` · `/resume` · `/stop` → `{ok:true}`
`pause` deja terminar la celda en curso. `resume` no lanza un segundo scraper si hay uno en curso.
`stop` mata el proceso hijo y borra el escaneo activo (no se auto-reanuda).

## Leads

### `POST /api/lead/update` `{ "id": "…", "patch": { "state": "propuesta" } }`
Mezcla `patch` en `_meta`. `{ok:true}` o `{error:"no existe"}`.

### `POST /api/reset`
Detiene el escaneo, borra todos los leads; conserva historial y celdas barridas.

## Ajustes e integraciones

### `GET /api/config`
```json
{ "telegramChat": "", "hasToken": false, "webhookUrl": "", "proxies": "", "notify": false, "leadsdb": false,
  "safeMode": true, "pauseMin": 3, "pauseMax": 8, "exclude": "", "maxLeads": 0, "retryFailed": true,
  "conc": 1, "inactivity": 20, "cellMax": 6, "workers": 1 }
```
### `POST /api/config`
Acepta: strings `telegramToken telegramChat webhookUrl proxies leadsdbKey exclude`; números ≥ 0
`pauseMin pauseMax depth maxBlocks subdivideAt maxLeads cellMax conc inactivity workers` (workers se acota a 1–4); booleanos
`notify safeMode subdivide retryFailed`. Lo demás se ignora.

### `POST /api/test-telegram` `{telegramToken?, telegramChat?}` → respuesta de la API de Telegram.
### `POST /api/proxies/fetch` → `{total, working, proxies}` (guarda las vivas en Ajustes).
### `POST /api/enrich` → `{ok}` o `{error:"Ya se está enriqueciendo."}` · `POST /api/enrich/stop`.

## Errores
- `404 {error:"not found"}` · `405 {error:"método no permitido"}` · `413 {error:"Cuerpo demasiado grande"}`
- `401` con `WWW-Authenticate: Basic` si falta o falla la autenticación.
- `500 {error:"error interno"}` (detalle en `/api/logs`).

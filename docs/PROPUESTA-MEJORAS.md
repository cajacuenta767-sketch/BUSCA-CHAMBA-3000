# Propuesta de mejoras — velocidad y funciones

Diagnóstico hecho con el código en la mano y medido con el escaneo demo. Primero lo que ya está
hecho en esta entrega, después lo que propongo, ordenado por impacto ÷ esfuerzo.

## 0. Dónde se iba el tiempo (antes)

Un escaneo de 100 celdas a 1 km, en serie, costaba aproximadamente:

| Tramo | Por celda | En 100 celdas |
|---|---|---|
| Scraper (15 consultas, profundidad 3, hasta 100 s por watchdog) | 40–100 s | 65–165 min |
| Pausa antibaneo entre celdas (`pauseMin..pauseMax`, defecto 3–8 s) | ~5.5 s | ~9 min de espera pura |
| Celdas vacías (mar, campo): esperan el `inactivity` completo | 25–60 s | depende de la zona |
| Releer y reparsear TODO el CSV de la celda cada 300 ms | O(filas²) | CPU, no reloj |

La primera fila es el scraper y no depende de nosotros. Lo que sí depende: **todo corría en serie**
y **la ingesta era cuadrática**.

## 1. Hecho en esta entrega

| Mejora | Qué cambia | Ganancia |
|---|---|---|
| **Celdas en paralelo** (`workers`, 1–4, ajuste "Celdas a la vez" en el panel; perfil Turbo = 2) | Cada trabajador lleva su propio proceso y su propio CSV (`cell.csv`, `cell-1.csv`…). Las pausas antibaneo y los timeouts de celdas vacías ya no frenan a las demás. Lanzamientos escalonados 1.5 s; enfriamiento antibaneo global para todos. | ×2 con 2 trabajadores (medido en demo: 25 celdas en 10 s vs 19 s). ×3–4 con proxies residenciales. |
| **Ingesta incremental del CSV** | Se leen solo los bytes nuevos desde el último offset; se parsean solo filas completas (respetando comillas con saltos de línea); decodificación UTF-8 segura entre trozos. | O(nuevo) por lectura en vez de O(archivo). Celdas densas de 300+ filas dejan de comer CPU. |
| **Inserciones por lote** | Cada lectura guarda sus filas en una sola transacción SQLite (`store.batch`). | Una sincronización de disco por lote en vez de una por lead. |
| **Consultas escritas una vez** | `q.txt` solo se reescribe si cambia (antes en cada celda). | Menos I/O, evita carreras entre trabajadores. |
| Con `workers = 1` (defecto) | El orden y las pausas son exactamente los de antes. | Sin riesgo para quien ya está escaneando. |

Corregidos de paso (ver `REVISION.md`): un reintento que vencía en pausa dejaba la celda en amarillo
para siempre; las celdas reintentadas al final heredaban `_timedout` y nunca se cerraban por `exit`.

## 2. Propuestas de velocidad (siguientes)

### 2.1 Saltar celdas sin negocios antes de escanearlas — impacto alto, esfuerzo medio
Muchas celdas de una ciudad son mar, cerro o campo y cuestan 25–60 s cada una. Dos fuentes gratis:
- **Densidad de OpenStreetMap** (Overpass API o un extracto `.pbf` local): si una celda no tiene
  ni calles ni edificios, se marca `empty` sin lanzar el scraper.
- **Vecindad**: si las 4 celdas vecinas ya salieron vacías, bajar prioridad (no saltar) a la celda.
Ganancia esperada: 20–40 % del tiempo total en ciudades costeras o andinas.

### 2.2 Profundidad adaptativa — impacto medio, esfuerzo bajo
`-depth 3` siempre. Si una celda devuelve < 20 negocios con profundidad 1, no vale la pena
profundizar; si devuelve 90+, subdividir (ya existe). Propuesta: primera pasada con `depth 1`;
solo repetir con `depth 3` las celdas que superen 40 resultados. Menos scrolls = menos tiempo y
menos bloqueos.

### 2.3 Consultas por rubro según la zona — impacto medio, esfuerzo bajo
Las 15 consultas paraguas se lanzan en todas las celdas. En una celda residencial "hotel hostal"
o "estudio contable" casi nunca devuelven nada. Con el histórico de `scanned_cells` + categorías
por celda se puede aprender qué consultas producen en cada zona y saltar las estériles
(lista blanca por ciudad, editable en Ajustes).

### 2.4 Pausa antibaneo inteligente — impacto medio, esfuerzo bajo
Hoy la pausa es aleatoria fija (3–8 s). Propuesta: **pausa adaptativa**: empieza en el mínimo y solo
sube cuando aparece un aviso de bloqueo (ya existe el backoff); si llevan 20 celdas limpias, baja
otra vez. Con proxies residenciales, pausa 0.5–1.5 s.

### 2.5 Cola de trabajos persistente — impacto alto para VPS, esfuerzo medio
Guardar el estado de cada celda (`pending/scanning/done`) en `scanned_cells` con `status`, de modo
que un reinicio retome **la celda exacta** y que dos máquinas (o dos procesos) puedan repartirse la
misma área sin coordinarse (cada una toma la siguiente `pending` con `UPDATE … RETURNING`).

### 2.6 Panel: lista virtualizada y paginación — impacto medio, esfuerzo medio
Con 20k leads el panel pinta miles de tarjetas. El backend ya soporta `?limit&offset`; falta que el
panel pida por páginas y use una lista virtual (solo pinta lo visible). Carga inicial de segundos
a milisegundos.

## 3. Propuestas de funciones (del PLAN.md, priorizadas)

| Prioridad | Función | Por qué ahora | Esfuerzo |
|---|---|---|---|
| 1 | **Seguimientos y "para contactar hoy"** (PLAN 17, 62) | Es lo que convierte leads en clientes; el pipeline ya guarda `follow`. Falta la vista y un aviso por Telegram a las 9:00. | bajo |
| 2 | **Importar/mezclar CSV con dedupe** (38) | Reutilizar escaneos viejos y los de `scrape.sh`; `leadId` ya es la clave. | bajo |
| 3 | **Historial de mensajes por lead** (19) | Saber qué se le dijo y cuándo; guardar en `meta.history[]`. | bajo |
| 4 | **Escaneo programado** (44) | Dejar el VPS barriendo de noche por zonas guardadas. Un `cron` interno + `POST /api/scan/start`. | medio |
| 5 | **Vista tabla + selección múltiple + acciones en lote** (25, 26) | Marcar 50 como "no contactar" o exportar un segmento. | medio |
| 6 | **Normalizar teléfonos (+51/+591) y móvil vs fijo** (40, 64) | WhatsApp solo sirve con móviles; hoy se abren enlaces a fijos. | bajo |
| 7 | **Google Sheets / webhook enriquecido** (46, 48) | Ya hay webhook; falta plantilla para Sheets vía Apps Script. | bajo |
| 8 | **Login básico + multiusuario** (49, 53) | `BASIC_AUTH` ya protege; multiusuario = `account_id` en tablas (el diseño lo permite). | alto |
| 9 | **Fotos y clúster de pines** (73–77) | Vistoso, pero no vende más. Después de lo anterior. | medio |

## 4. Cómo medir que mejora

Añadir a `scan_history`: `duration_ms`, `cells_empty`, `cells_blocked`, `leads_per_min`. Con eso
el panel de Métricas puede mostrar "negocios por minuto" por escaneo y comparar perfiles
(Sigiloso / Normal / Turbo) con datos reales en vez de a ojo.

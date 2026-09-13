# BUSCA-CHAMBA-3000 — Generación de leads con Google Maps

Setup listo para usar del scraper open-source **[gosom/google-maps-scraper](https://github.com/gosom/google-maps-scraper)** (licencia MIT, gratis), orientado a **conseguir clientes freelance**: sacas una lista de negocios locales (con teléfono, web y correo) y les ofreces tus servicios de desarrollo de software / ciberseguridad.

> Esto **no** automatiza ninguna cuenta personal tuya. Extrae datos **públicos** que los negocios publican en Google Maps para que los contacten. Aun así, léete la sección **[Uso responsable](#uso-responsable)** antes de escribirle a nadie.

---

## Qué extrae

Nombre del negocio, categoría, dirección, teléfono, sitio web, horario, rating y número de reseñas, coordenadas, y **correos** (con el flag `-email`, visitando la web del negocio). En total 36 campos. Salida en **CSV** o **JSON**.

---

## Panel de Leads (`dashboard.html` + `server.js`)

Panel visual para trabajar los leads. Funciona de **dos formas**:

**A) Modo en vivo (recomendado)** — con un servidor local (Node, sin dependencias):

```bash
node server.js      # abre http://localhost:8090
```

En la pantalla de **Inicio**, ordenada en **2 pasos** (elige la ciudad → inicia), el **único filtro es la ciudad**: eliges **país → ciudad** (empieza en **Bolivia** y **Perú**, y se expande a Colombia, Ecuador, Chile, Argentina, México y demás países de habla hispana, más el mercado hispano de **EE. UU.**) y pulsas **▶️ Iniciar**. Siempre **barre TODOS los negocios del área, cuadrícula por cuadrícula** (no hay que activar nada) y cada negocio se archiva en su **categoría normalizada**, para que no se repitan decenas de variantes del mismo rubro. El **mapa se pinta en vivo** celda por celda (⬜ pendiente → 🟡 escaneando → 🟢 con negocios) y **los leads aparecen al instante**; puedes **pausar/reanudar**. El servidor **guarda todo** (leads, estados, notas) aunque cierres. Para escanear necesita el binario `gms` (o `SCRAPER_MODE=docker`).

**B) Modo archivo** — abres `dashboard.html` con doble clic y cargas un `resultados.csv` a mano (sin escaneo en vivo).

En ambos modos tienes:

- Buscador, filtros por rubro y orden por rating / número de reseñas.
- Botones directos de **WhatsApp**, **correo**, **llamar** y **web** por cada negocio.
- **Mensaje de venta listo para copiar** — **por rubro** (farmacia, taller de celulares, restaurante, dental, gimnasio, bodega, etc., cada uno con el sistema ideal para venderle) o por servicio general. Detecta el rubro automáticamente y arma el mensaje con el nombre del negocio; botón directo para abrir **WhatsApp** con el texto puesto.
- Marca de "contactado" que se recuerda entre sesiones y tema claro/oscuro.
- **🗺️ Mapa y cobertura**: dibuja una **cuadrícula por celdas (km)** sobre el área que elijas; las celdas con negocios ya escaneados salen en verde (y puedes marcar/desmarcar con clic) para **no saltarte ninguna zona**. Muestra tus leads como pines y **genera el comando `-grid-bbox` exacto** para barrer esa área celda por celda.
- **🛠️ Herramientas**: copiar todos los teléfonos/correos, abrir WhatsApp Web, reiniciar contactados.
- **📊 Exportar Excel `.xlsx`** con encabezados y columnas correctas (si abres sin internet, baja un CSV compatible con Excel).

Además: **mapa que se colorea celda por celda** con pines de negocios (pasa el mouse por un pin y ves **foto + datos**; clic para la ficha completa), **badges** por negocio (🌐 web / 💬 WhatsApp / ✉️ correo), aviso **🔥 SIN WEB** (prospecto ideal), **filtros rápidos**, filtro por **ciudad**, **pipeline** con estados (Nuevo → Contactado → Respondió → Propuesta → Cliente), **notas** y **score de prospecto**, mensajes por rubro y **de seguimiento**.

> El plan completo de mejoras está en [`PLAN.md`](PLAN.md).

El panel solo muestra **datos reales** que escaneas (o un CSV que cargues); no hay datos de ejemplo. La pestaña de mapa necesita internet (usa OpenStreetMap). En modo en vivo, el scraper debe poder correr en esa máquina (binario `gms` o Docker).

## Requisitos

- **Docker** (recomendado) — la imagen ya trae el navegador incluido, no instalas nada más.
- *Alternativa sin Docker:* Go 1.26+ para compilar desde el código fuente.

---

## Opción A — Interfaz web (recomendada para empezar)

Levanta la interfaz gráfica en tu navegador y lánzalo/monitoréalo desde ahí. Ideal para dejarlo corriendo en un VPS 24/7 (`restart: unless-stopped`).

```bash
docker compose up -d
```

Abre **http://localhost:8080** (o `http://IP-DE-TU-VPS:8080`). Crea un job, pon tus búsquedas y descarga el CSV.
Los datos quedan en la carpeta `gmapsdata/`. Para apagarlo: `docker compose down`.

> Los resultados tardan mínimo ~3 minutos en aparecer (tiempo mínimo de corrida).

---

## Opción B — Línea de comandos (scrapes puntuales)

1. Edita **`queries.txt`** (una búsqueda por línea; ya trae ejemplos de Perú).
2. Corre:

```bash
./scrape.sh                # usa queries.txt, profundidad 1
./scrape.sh queries.txt 2  # más resultados por búsqueda
```

El resultado queda en **`salidas/resultados.csv`**. El script ya activa `-email` (extrae correos) y `-lang es` (resultados en español).

---

## Flags útiles

| Necesitas | Flag |
|---|---|
| Extraer correos de las webs | `-email` |
| Salida JSON | `-json -results /out/resultados.json` |
| Más resultados por búsqueda | `-depth 2` (o más) |
| Más velocidad (más CPU/RAM) | `-c 4`, `-c 8` |
| Idioma | `-lang es` |
| Usar proxies | `-proxies 'http://user:pass@host:port'` |
| Salir tras inactividad | `-exit-on-inactivity 3m` |

Lista completa: `docker run --rm gosom/google-maps-scraper -h`

---

## Proxies (importante para volumen)

Google **bloquea o limita** las IP de datacenter (como las de un VPS barato). Para pocas búsquedas puede que funcione sin proxy, pero para volumen vas a necesitar **proxies residenciales**. Se pasan con `-proxies` o `-proxies-file`. El README del proyecto original lista proveedores.

---

## Alternativa sin Docker (compilar)

```bash
git clone https://github.com/gosom/google-maps-scraper.git
cd google-maps-scraper
go mod download
go build -o gms .
./gms -input ../BUSCA-CHAMBA-3000/queries.txt -results resultados.csv -email -lang es -exit-on-inactivity 3m
```

---

## Anti-baneo (Modo seguro)

Activado por defecto en **⚙️ Ajustes**. Para que Google no bloquee tu IP al escanear:

- **Pausas aleatorias entre celdas** (3–8 s, configurables) + concurrencia baja (`-c 1`), para no martillar.
- **Rotación de proxies (round-robin)**: el escáner **baraja y usa una distinta por celda**, dando la vuelta a toda la lista antes de repetir (así **no quema ninguna**) y **cambia de proxy si detecta bloqueo**. Acepta `ip:puerto:usuario:clave` o `http://usuario:clave@ip:puerto`. Los logs enmascaran el usuario/clave.
- **Proxies desde el backend (recomendado, no hace falta el panel):** crea un archivo **`proxies.txt`** junto a `server.js` (copia [`proxies.example.txt`](proxies.example.txt)) con **una proxy por línea**, o define la variable de entorno **`PROXIES`**. El servidor las carga solas al arrancar. `proxies.txt` está en `.gitignore` → **tus credenciales de pago NUNCA se suben a GitHub** (si el repo se filtra, no te las roban). También puedes pegarlas en **⚙️ Ajustes → Proxies**; se guardan en `data/` (tampoco se versiona). El botón **🌐 Traer proxies gratis** trae listas públicas y **prueba cuáles funcionan**. ⚠️ Las proxies gratis son poco confiables y de terceros que podrían ver tu tráfico; para volumen serio usa **residenciales de pago**.
- **Área grande = auto-ajuste**: si eliges una zona muy amplia, el escáner **sube solo el tamaño de celda** hasta que el área entre (en vez de bloquearte con "demasiadas celdas"), y te avisa a cuántos km la ajustó. Para más detalle, baja el tamaño de celda y escanea por partes.
- **Detección de bloqueos** (ERR_TUNNEL, 429, 403, captcha) con **backoff exponencial** y **auto-pausa**: si varias celdas seguidas salen bloqueadas, el escaneo se **pausa solo** y te avisa. Configura proxies o espera un rato y pulsa **Reanudar**.
- **Empieza suave**: celdas de 2–3 km y modo "Por rubro" generan menos búsquedas y menos bloqueos que "Todo el área".

## Uso responsable

- Extraer datos de Google Maps va **contra los Términos de Servicio de Google**. El riesgo aquí no es tu cuenta (no usas login), sino bloqueos de IP: úsalo con mesura y con proxies si haces volumen.
- Los teléfonos/correos son datos personales. En Perú aplica la **Ley 29733 de Protección de Datos Personales**. No hagas spam masivo: contacta de forma personalizada, relevante y ofrece siempre una forma de que no los vuelvas a contactar.
- Respeta los límites: no es para inundar a nadie, es para encontrar clientes potenciales y escribirles bien.

---

## Créditos

Herramienta original: **[github.com/gosom/google-maps-scraper](https://github.com/gosom/google-maps-scraper)** — licencia MIT. Este repo solo agrega configuración y documentación para usarla.

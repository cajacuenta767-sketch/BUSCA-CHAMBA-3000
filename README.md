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

El botón **▶️ Iniciar** lanza el scraper y **los leads van apareciendo en vivo** en el panel; el servidor **guarda todo** (leads, estados, notas) aunque cierres. Para escanear necesita el binario `gms` (o define `SCRAPER_MODE=docker` para usar la imagen). Botón **Demo** para verlo funcionar sin escanear.

**B) Modo archivo** — abres `dashboard.html` con doble clic y cargas un `resultados.csv` a mano (sin escaneo en vivo).

En ambos modos tienes:

- Buscador, filtros por rubro y orden por rating / número de reseñas.
- Botones directos de **WhatsApp**, **correo**, **llamar** y **web** por cada negocio.
- **Mensaje de venta listo para copiar** — **por rubro** (farmacia, taller de celulares, restaurante, dental, gimnasio, bodega, etc., cada uno con el sistema ideal para venderle) o por servicio general. Detecta el rubro automáticamente y arma el mensaje con el nombre del negocio; botón directo para abrir **WhatsApp** con el texto puesto.
- Marca de "contactado" que se recuerda entre sesiones y tema claro/oscuro.
- **🗺️ Mapa y cobertura**: dibuja una **cuadrícula por celdas (km)** sobre el área que elijas; las celdas con negocios ya escaneados salen en verde (y puedes marcar/desmarcar con clic) para **no saltarte ninguna zona**. Muestra tus leads como pines y **genera el comando `-grid-bbox` exacto** para barrer esa área celda por celda.
- **🛠️ Herramientas**: copiar todos los teléfonos/correos, abrir WhatsApp Web, reiniciar contactados.
- **📊 Exportar Excel `.xlsx`** con encabezados y columnas correctas (si abres sin internet, baja un CSV compatible con Excel).

Además: **badges** por negocio (🌐 web / 💬 WhatsApp / ✉️ correo), aviso **🔥 SIN WEB** (prospecto ideal), **filtros rápidos**, **pipeline** con estados (Nuevo → Contactado → Respondió → Propuesta → Cliente) y **notas** por lead, y **mensajes de seguimiento**.

El botón **Ejemplo** carga datos de muestra para ver el panel sin datos propios. La pestaña de mapa necesita internet (usa OpenStreetMap). En modo en vivo, el scraper debe poder correr en esa máquina (binario `gms` o Docker).

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

## Uso responsable

- Extraer datos de Google Maps va **contra los Términos de Servicio de Google**. El riesgo aquí no es tu cuenta (no usas login), sino bloqueos de IP: úsalo con mesura y con proxies si haces volumen.
- Los teléfonos/correos son datos personales. En Perú aplica la **Ley 29733 de Protección de Datos Personales**. No hagas spam masivo: contacta de forma personalizada, relevante y ofrece siempre una forma de que no los vuelvas a contactar.
- Respeta los límites: no es para inundar a nadie, es para encontrar clientes potenciales y escribirles bien.

---

## Créditos

Herramienta original: **[github.com/gosom/google-maps-scraper](https://github.com/gosom/google-maps-scraper)** — licencia MIT. Este repo solo agrega configuración y documentación para usarla.

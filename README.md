# BUSCA-CHAMBA-3000 — Generación de leads con Google Maps

Setup listo para usar del scraper open-source **[gosom/google-maps-scraper](https://github.com/gosom/google-maps-scraper)** (licencia MIT, gratis), orientado a **conseguir clientes freelance**: sacas una lista de negocios locales (con teléfono, web y correo) y les ofreces tus servicios de desarrollo de software / ciberseguridad.

> Esto **no** automatiza ninguna cuenta personal tuya. Extrae datos **públicos** que los negocios publican en Google Maps para que los contacten. Aun así, léete la sección **[Uso responsable](#uso-responsable)** antes de escribirle a nadie.

---

## Qué extrae

Nombre del negocio, categoría, dirección, teléfono, sitio web, horario, rating y número de reseñas, coordenadas, y **correos** (con el flag `-email`, visitando la web del negocio). En total 36 campos. Salida en **CSV** o **JSON**.

---

## Panel de Leads (`dashboard.html`)

Después de scrapear, abre **`dashboard.html`** en tu navegador (doble clic) y carga el `salidas/resultados.csv`. Es un panel visual, **100% local** (tus datos no se suben a ningún lado), con:

- Buscador, filtros por rubro y orden por rating / número de reseñas.
- Botones directos de **WhatsApp**, **correo**, **llamar** y **web** por cada negocio.
- **Mensaje de oferta listo para copiar** — eliges el servicio (web, e-commerce, app, ciberseguridad, automatización) y lo arma personalizado con el nombre del negocio.
- Marca de "contactado" que se recuerda entre sesiones, tema claro/oscuro y exportación a CSV.

No instala nada: es un solo archivo HTML. Ábrelo con **Datos de ejemplo** para ver cómo se ve sin datos propios.

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

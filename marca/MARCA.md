# Sky Tech — marca

**Una sola fuente de verdad:** el logo está definido como primitivas en [`src/ui/logo.js`](../src/ui/logo.js).
De ahí salen los SVG de esta carpeta (`npm run build:brand`), el logo del panel, el favicon y el
dibujo vectorial dentro del PDF de la propuesta. Para cambiar el logo se edita ese archivo y se
vuelve a generar; nunca se retocan los SVG a mano.

## Concepto

Una **nube** (el sistema vive en la nube: se abre desde cualquier celular, sin instalar nada)
atravesada por un **rayo** (la energía que le pone al negocio). Caja de 48 × 48 con esquinas de
radio 12. La nube es una silueta continua (tres curvas y base con extremos redondeados) y el rayo
es grande a propósito: se reconoce desde 16 px.

## Archivos

| Archivo | Cuándo usarlo |
|---|---|
| `skytech-isotipo.svg` | Distintivo sobre fondo claro. Avatar, sello, cabecera del panel. |
| `skytech-isotipo-blanco.svg` | Distintivo sobre fondo oscuro (azul Sky Tech, fotos). Es el de la cabecera del PDF. |
| `skytech-isotipo-mono.svg` | Un solo color (rayo en negativo). Impresión en blanco y negro, grabado, sellos. |
| `skytech-logo.svg` | Logo horizontal sobre claro: documentos, firma de correo, web. |
| `skytech-logo-blanco.svg` | Logo horizontal sobre oscuro. |
| `skytech-logo-mono.svg` | Logo horizontal en un solo color. |
| `skytech-apilado.svg` / `-blanco.svg` | Versión apilada (cuadrada) para redes y perfiles. |
| `favicon.svg` | Favicon (el panel lo lleva incrustado). |
| `skytech-icon-512.png` · `-180.png` · `-32.png` | Iconos rasterizados: acceso directo en celular, Apple touch icon, pestañas antiguas. |

Tamaño mínimo del isotipo: **16 px** (favicon). Del logo horizontal: **24 px** de alto.
Zona de protección: la mitad del ancho del isotipo alrededor de todo el logo.

## Tipografía

Wordmark en **Sora 700** («SKY» en azul marino, «TECH» en celeste), lema en Sora 600 con
interletrado abierto. En el panel y el PDF se usa Sora para títulos e **IBM Plex Sans** para texto
(licencias OFL en `public/fonts/`).

## Colores

| Uso | Hex |
|---|---|
| Azul Sky Tech (fondo del isotipo, cabeceras, cierre del PDF) | `#0B3C68` |
| Celeste (rayo, acentos, «TECH») | `#1FA2FF` |
| Acento de interfaz sobre fondo claro (botones, enlaces; contraste ≥ 4.5:1) | `#0F6FC6` |
| Acento de interfaz en modo oscuro | `#5CB9FF` |
| Tinta (texto) | `#11253A` |
| Gris (texto secundario) | `#5C7183` |
| Línea / fondo de barra | `#D7E2EE` |

### Colores de las gráficas (primarios)

| Significado | Hex |
|---|---|
| **Usted** (el negocio al que se le propone) | `#1D4ED8` |
| **El primero de su zona** / «hoy, a mano» | `#D92D20` |
| **Con el sistema** / dinero ganado | `#0E9F6E` |
| **Tranquilidad** / avisos | `#B7791F` |

Los cuatro pasan los seis chequeos de color (banda de luminosidad, croma mínimo, separación bajo
daltonismo protan/deutan, separación a vista normal y contraste ≥ 3:1 sobre blanco).
Versiones suaves para fondos: `#E5ECFC` (azul), `#FDE8E6` (rojo), `#E0F6EE` (verde),
`#FAF1E1` (ámbar), `#E8F0F9` (azul Sky Tech).

#!/usr/bin/env bash
#
# Scrape por linea de comandos usando la imagen Docker oficial.
# Uso:
#   ./scrape.sh [archivo_consultas] [profundidad]
# Ejemplos:
#   ./scrape.sh                 # usa queries.txt, profundidad 1
#   ./scrape.sh queries.txt 2   # profundidad 2 (mas resultados por busqueda)
#
set -euo pipefail

QUERIES="${1:-queries.txt}"
DEPTH="${2:-1}"

if [ ! -f "$QUERIES" ]; then
  echo "No existe el archivo de consultas: $QUERIES" >&2
  exit 1
fi

mkdir -p salidas

docker run --rm \
  -v gmaps-playwright-cache:/opt \
  -v "$PWD/$QUERIES:/queries.txt:ro" \
  -v "$PWD/salidas:/out" \
  gosom/google-maps-scraper \
  -input /queries.txt \
  -results /out/resultados.csv \
  -depth "$DEPTH" \
  -email \
  -lang es \
  -exit-on-inactivity 3m

echo ""
echo "Listo. Resultados en: salidas/resultados.csv"

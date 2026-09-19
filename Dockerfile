# Panel + orquestador de BUSCA-CHAMBA-3000 (sin dependencias npm).
# El scraper corre como imagen aparte (gosom/google-maps-scraper) vía SCRAPER_MODE=docker,
# o montando el binario `gms` en /app/gms.
FROM node:22-alpine
WORKDIR /app
COPY package.json server.js stats.js dashboard.html ./
COPY src ./src
COPY scripts ./scripts
ENV NODE_ENV=production PORT=8090 DATA_DIR=/app/data
VOLUME ["/app/data"]
EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8090/api/health || exit 1
CMD ["node", "server.js"]

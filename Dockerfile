# syntax=docker/dockerfile:1
# ============================================================
# Maison de Famille : une seule image.
#
# Le backend sert l'API et l'application Angular compilée : un conteneur, un
# port, un reverse-proxy à configurer. Il n'y a rien à orchestrer entre un front
# et un back, et un redémarrage redémarre tout.
# ============================================================

# ---- 1. L'application Angular ----
FROM node:22-alpine AS frontend
ENV NG_CLI_ANALYTICS=false
WORKDIR /build/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- 2. Le backend ----
FROM node:22-alpine AS backend
WORKDIR /build/backend
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build

# ---- 3. L'exécution ----
# Debian-slim (glibc) : les binaires précompilés de better-sqlite3 et d'argon2
# se chargent sans compilation. Sur Alpine (musl), il faudrait un compilateur
# dans l'image finale, ce qui la triple et ajoute une surface inutile.
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY backend/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=backend /build/backend/dist ./dist
COPY --from=frontend /build/frontend/dist/frontend/browser ./public

ENV PORT=8099
ENV MDF_DATA_DIR=/data
ENV MDF_STATIC_DIR=/app/public
ARG MDF_VERSION=
ENV MDF_VERSION=${MDF_VERSION}

# Le processus tourne sans privilèges. L'ordre compte : ce chown doit précéder
# VOLUME, car une modification faite après la déclaration du volume est perdue,
# le volume étant initialisé depuis l'état de l'image à ce moment-là. Le premier
# démarrage ne saurait alors pas écrire sa base, et le message serait un EACCES
# sans contexte.
RUN mkdir -p /data && chown -R node:node /data /app
USER node

VOLUME ["/data"]
EXPOSE 8099

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8099/api/sante').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]

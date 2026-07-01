# Imagem única: frontend (Vite) + backend (Express) — Railway em 2 blocos (Postgres + este serviço).
# Build: docker build -t bratecc .
# API em /api, SPA em /* (VITE_API_URL=/api no build).

FROM node:20-alpine AS frontend-build

WORKDIR /frontend

COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install --no-audit --no-fund

COPY frontend/ ./
ENV VITE_API_URL=/api
RUN npm run build

FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache openssl netcat-openbsd

COPY backend/package.json backend/package-lock.json* ./
# Usamos `npm install` em vez de `npm ci` para evitar quebra quando o lock
# está dessincronizado (acontece após adicionar uma dep sem regerar o lock).
RUN npm install --omit=dev --no-audit --no-fund \
  && npm install prisma@5.22.0 --no-save

COPY backend/prisma ./prisma
RUN npx prisma generate

COPY backend/src ./src
COPY backend/scripts ./scripts
COPY backend/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

COPY --from=frontend-build /frontend/dist ./src/public

EXPOSE 3001

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "src/index.js"]

# ══════════════════════════════════════════
# BRATECC Connect AI - Backend Dockerfile
# ══════════════════════════════════════════

FROM node:20-alpine

WORKDIR /app

# Instalar openssl para Prisma
RUN apk add --no-cache openssl netcat-openbsd

COPY package.json package-lock.json* ./
# Usamos `npm install` em vez de `npm ci` porque o `npm ci` é estrito e quebra
# o build sempre que adicionamos uma nova dependência sem regerar o lock.
# `npm install --omit=dev --no-audit --no-fund` é levemente mais lento mas
# resolve dependências em runtime e sincroniza o lock automaticamente.
RUN npm install --omit=dev --no-audit --no-fund

# Copiar Prisma schema e gerar client
COPY prisma ./prisma
RUN npx prisma generate

# Copiar código e script usado por src/index.js (sync opcional de schema)
COPY src ./src
COPY scripts ./scripts

# Script de entrypoint
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 3001

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "src/index.js"]

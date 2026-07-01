# ══════════════════════════════════════════
# BRATECC Connect AI - Frontend Dockerfile
# ══════════════════════════════════════════

# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# IMPORTANTE: VITE_API_URL é embutido no bundle JS no momento do build.
# Use URL relativa "/api" para que o browser chame o mesmo host+protocolo
# da página (resolvido pelo nginx via proxy_pass para o backend:3001).
# Isso evita mixed content quando o frontend é servido via HTTPS.
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL

COPY package.json package-lock.json* ./
RUN npm install

COPY . .
RUN npm run build

# Stage 2: Serve com Nginx
FROM nginx:1.25-alpine

# Copiar build
COPY --from=builder /app/dist /usr/share/nginx/html

# Copiar config do nginx para SPA (React Router)
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]

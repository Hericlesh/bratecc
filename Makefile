# ══════════════════════════════════════════════════════════════
# BRATECC Connect AI - Makefile
# ══════════════════════════════════════════════════════════════
#
# Comandos rápidos:
#   make up        → Sobe tudo
#   make down      → Para tudo
#   make logs      → Ver logs
#   make restart   → Reinicia tudo
#   make clean     → Remove tudo (inclusive dados)
#   make seed      → Roda seed no banco
#   make studio    → Abre Prisma Studio
#   make shell-api → Acessa terminal do backend
#   make shell-db  → Acessa terminal do postgres
#
# ══════════════════════════════════════════════════════════════

.PHONY: up down logs restart clean build seed seed-minimal studio shell-api shell-db status

# Subir todos os serviços
up:
	docker compose up -d
	@echo ""
	@echo "╔═══════════════════════════════════════════════╗"
	@echo "║  🚀 BRATECC Connect AI - Rodando!            ║"
	@echo "║                                               ║"
	@echo "║  Frontend:  http://localhost                   ║"
	@echo "║  API:       http://localhost:3001              ║"
	@echo "║  Health:    http://localhost:3001/health       ║"
	@echo "║                                               ║"
	@echo "║  Logs: make logs                              ║"
	@echo "╚═══════════════════════════════════════════════╝"

# Parar serviços
down:
	docker compose down

# Ver logs em tempo real
logs:
	docker compose logs -f

# Logs só do backend
logs-api:
	docker compose logs -f backend

# Logs só do frontend
logs-front:
	docker compose logs -f frontend

# Reiniciar tudo
restart:
	docker compose restart

# Build das imagens
build:
	docker compose build --no-cache

# Rebuild e subir
rebuild: build up

# Limpar tudo (CUIDADO: apaga dados do banco!)
clean:
	docker compose down -v --rmi local
	@echo "🗑️  Tudo limpo! Dados do banco foram removidos."

# Rodar seed COMPLETO no banco (com dados demo)
seed:
	docker compose exec backend node prisma/seed.js

# Rodar seed MÍNIMO (apaga tudo, cria só o admin) — para deploy zerado
seed-minimal:
	docker compose exec backend node prisma/seed-minimal.js
	@echo ""
	@echo "✅ Banco zerado · admin@bratecc.com / admin123 (ou ADMIN_EMAIL/ADMIN_PASSWORD do env)"

# Abrir Prisma Studio (porta 5555)
studio:
	docker compose exec backend npx prisma studio

# Terminal do backend
shell-api:
	docker compose exec backend sh

# Terminal do postgres
shell-db:
	docker compose exec postgres psql -U bratecc -d bratecc_db

# Status dos containers
status:
	docker compose ps

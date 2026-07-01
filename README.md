# 🎯 BRATECC Connect AI - Deploy com Docker

Sistema Inteligente de Conexões Comerciais — Texas × Brasil

---

## 📋 Pré-requisitos

- [Docker](https://docs.docker.com/get-docker/) (v20+)
- [Docker Compose](https://docs.docker.com/compose/install/) (v2+)
- Git (opcional)

---

## 🚀 Deploy Rápido (3 comandos)

```bash
# 1. Extrair o zip e entrar na pasta
unzip bratecc-docker-deploy.zip
cd bratecc-docker

# 2. Copiar e ajustar as variáveis de ambiente
cp .env.example .env
# Edite o .env se necessário (senhas, chaves, etc.)

# 3. Subir tudo
docker compose up -d
```

**Pronto!** Acesse:
- 🌐 **Frontend:** http://localhost
- 🔧 **API:** http://localhost:3001
- ❤️ **Health:** http://localhost:3001/health

---

## 🔐 Credenciais Padrão

| Usuário | Email | Senha | Perfil |
|---------|-------|-------|--------|
| Admin | admin@bratecc.com | admin123 | Administrador |
| FinTech Brasil | fintech@bratecc.com | fintech123 | Associado |
| Global Logistics | logistics@bratecc.com | logistics123 | Associado |
| Legal Partners | legal@bratecc.com | legal123 | Associado |
| TechBR Solutions | tech@bratecc.com | tech123 | Associado |

---

## 📁 Estrutura do Projeto

```
bratecc-docker/
├── docker-compose.yml          # Orquestração dos serviços
├── .env                        # Variáveis de ambiente
├── .env.example                # Template de variáveis
├── Makefile                    # Atalhos de comandos
├── README.md                   # Este arquivo
│
├── frontend/                   # React + Vite
│   ├── Dockerfile              # Build multi-stage (Node → Nginx)
│   ├── nginx.conf              # Proxy reverso → API
│   ├── src/
│   │   ├── main.jsx
│   │   └── bratecc-connect-ai.jsx  # App principal (8456 linhas)
│   ├── public/
│   │   ├── bratecc_logo.png
│   │   └── atlantyx_logo.jpeg
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
│
└── backend/                    # Node.js + Express + Prisma
    ├── Dockerfile
    ├── docker-entrypoint.sh    # Migrations + Seed automático
    ├── prisma/
    │   ├── schema.prisma       # Schema do banco (12 models)
    │   └── seed.js             # Dados iniciais
    └── src/
        ├── index.js            # Entry point
        ├── config/database.js
        ├── middleware/auth.js
        ├── routes/index.js
        ├── controllers/        # authController, empresaController, etc.
        └── services/aiService.js
```

---

## 🐳 Serviços Docker

| Serviço | Container | Porta | Descrição |
|---------|-----------|-------|-----------|
| **postgres** | bratecc-db | 5432 | PostgreSQL 16 Alpine |
| **backend** | bratecc-backend | 3001 | API Node.js + Prisma |
| **frontend** | bratecc-frontend | 80 | React + Nginx |

---

## ⚙️ Comandos Úteis

### Com Make (recomendado)
```bash
make up          # Inicia todos os serviços
make down        # Para todos os serviços
make logs        # Logs em tempo real
make logs-api    # Logs só do backend
make restart     # Reinicia tudo
make build       # Rebuild das imagens
make rebuild     # Rebuild + up
make seed        # Roda seed novamente
make status      # Status dos containers
make shell-api   # Terminal no backend
make shell-db    # Terminal no PostgreSQL
make clean       # Remove TUDO (inclusive dados!)
```

### Com Docker Compose
```bash
docker compose up -d              # Iniciar
docker compose down               # Parar
docker compose logs -f             # Logs
docker compose logs -f backend     # Logs do backend
docker compose exec backend sh     # Terminal
docker compose down -v             # Parar + apagar dados
docker compose build --no-cache    # Rebuild
```

---

## 🌍 Deploy em Produção

### Opção 1: VPS (DigitalOcean, AWS EC2, etc.)

```bash
# No servidor
git clone <seu-repo> bratecc-docker
cd bratecc-docker

# Configurar variáveis de produção
cp .env.example .env
nano .env  # Ajustar senhas, JWT_SECRET, etc.

# Subir
docker compose up -d
```

### Opção 2: Com domínio e HTTPS (Traefik)

Adicione um serviço Traefik no `docker-compose.yml` para SSL automático com Let's Encrypt.

### Opção 3: Railway / Render

1. Suba o código no GitHub
2. Conecte ao Railway ou Render
3. Configure as variáveis de ambiente
4. Deploy automático

---

## 🔧 Variáveis de Ambiente

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `POSTGRES_USER` | bratecc | Usuário do banco |
| `POSTGRES_PASSWORD` | bratecc2026 | Senha do banco |
| `POSTGRES_DB` | bratecc_db | Nome do banco |
| `DB_PORT_EXTERNAL` | 5432 | Porta externa do banco |
| `JWT_SECRET` | (gerado) | Chave secreta JWT |
| `JWT_EXPIRES_IN` | 7d | Expiração do token |
| `NODE_ENV` | production | Ambiente |
| `APP_PORT` | 80 | Porta do frontend |
| `FRONTEND_URL` | http://localhost | URL do frontend |
| `GEMINI_API_KEY` | (vazio) | API Key do Google Gemini |
| `GEMINI_MODEL` | gemini-2.5-flash | Modelo do Gemini |

---

## 🔄 Atualizações

```bash
# Baixar nova versão
git pull

# Rebuild e restart
docker compose build --no-cache
docker compose up -d
```

---

## 🛠️ Troubleshooting

**Erro "port already in use":**
```bash
# Mudar porta no .env
APP_PORT=8080
DB_PORT_EXTERNAL=5433
```

**Resetar banco de dados:**
```bash
docker compose down -v
docker compose up -d
# O seed roda automaticamente
```

**Ver logs de erro:**
```bash
docker compose logs -f backend
```

**Reconstruir do zero:**
```bash
make clean
make rebuild
```

# BRATECC Connect AI - Backend

API REST para o sistema BRATECC Connect AI com PostgreSQL.

## 🚀 Instalação

### Pré-requisitos

- Node.js 18+
- PostgreSQL 14+
- npm ou yarn

### 1. Instalar dependências

```bash
npm install
```

### 2. Configurar variáveis de ambiente

```bash
cp .env.example .env
```

Edite o arquivo `.env` com suas configurações:

```env
DATABASE_URL="postgresql://usuario:senha@localhost:5432/bratecc_db?schema=public"
JWT_SECRET="sua-chave-secreta-aqui"
JWT_EXPIRES_IN="7d"
PORT=3001
NODE_ENV=development
FRONTEND_URL="http://localhost:3000"
```

### 3. Criar o banco de dados

```bash
# Criar banco no PostgreSQL
createdb bratecc_db

# Ou via psql
psql -U postgres -c "CREATE DATABASE bratecc_db;"
```

### 4. Executar migrations

```bash
npm run db:push
# ou
npm run db:migrate
```

### 5. Popular o banco com dados iniciais

```bash
npm run db:seed
```

### 6. Iniciar o servidor

```bash
# Desenvolvimento
npm run dev

# Produção
npm start
```

## 📚 Endpoints da API

### Autenticação

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| POST | `/api/auth/login` | Login |
| GET | `/api/auth/me` | Dados do usuário logado |
| POST | `/api/auth/users` | Criar usuário (admin) |

### Empresas

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| GET | `/api/empresas` | Listar empresas |
| GET | `/api/empresas/:id` | Buscar empresa |
| POST | `/api/empresas` | Criar empresa |
| POST | `/api/empresas/import` | Importar empresas em lote |
| PUT | `/api/empresas/:id` | Atualizar empresa |
| DELETE | `/api/empresas/:id` | Excluir empresa |
| GET | `/api/empresas/stats` | Estatísticas |

### Associados

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| GET | `/api/associados` | Listar associados |
| GET | `/api/associados/:id` | Buscar associado |
| POST | `/api/associados` | Criar associado |
| PUT | `/api/associados/:id` | Atualizar associado |
| DELETE | `/api/associados/:id` | Excluir associado |
| GET | `/api/associados/stats` | Estatísticas |

### Eventos

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| GET | `/api/eventos` | Listar eventos |
| GET | `/api/eventos/:id` | Buscar evento |
| POST | `/api/eventos` | Criar evento |
| PUT | `/api/eventos/:id` | Atualizar evento |
| PATCH | `/api/eventos/:id/toggle-status` | Alternar status |
| DELETE | `/api/eventos/:id` | Excluir evento |
| POST | `/api/eventos/:id/participantes` | Adicionar participante |
| POST | `/api/eventos/:id/associados` | Adicionar associado |
| GET | `/api/eventos/stats` | Estatísticas |

### Matches

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| GET | `/api/matches` | Listar matches |
| GET | `/api/matches/:id` | Buscar match |
| POST | `/api/matches` | Criar match |
| PATCH | `/api/matches/:id/status` | Atualizar status |
| DELETE | `/api/matches/:id` | Excluir match |
| POST | `/api/matches/generate/:empresaId` | Gerar matches automáticos |
| GET | `/api/matches/stats` | Estatísticas |

### Dashboard

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| GET | `/api/dashboard/stats` | Estatísticas gerais |

## 🗄️ Estrutura do Banco

### Entidades principais

- **User** - Usuários do sistema (admin/associado)
- **Empresa** - Empresas importadoras/exportadoras
- **Associado** - Associados BRATECC
- **Evento** - Feiras e eventos
- **Match** - Matches entre empresas e associados
- **MatchB2B** - Matches entre associados

### Diagrama

```
User ─────┐
          │
Associado ◄┘
    │
    ├─── Match ───► Empresa
    │
    ├─── MatchB2B ───► Associado
    │
    └─── EventoAssociado ───► Evento ◄─── EventoParticipante ───► Empresa
```

## 🔧 Scripts disponíveis

```bash
npm run dev          # Iniciar em desenvolvimento
npm start            # Iniciar em produção
npm run db:migrate   # Executar migrations
npm run db:push      # Push do schema
npm run db:seed      # Popular banco
npm run db:studio    # Abrir Prisma Studio
npm run db:reset     # Resetar banco e popular
npm run db:generate  # Gerar Prisma Client
```

## 📁 Estrutura de pastas

```
bratecc-backend/
├── prisma/
│   ├── schema.prisma    # Schema do banco
│   └── seed.js          # Seed inicial
├── src/
│   ├── config/
│   │   └── database.js  # Configuração Prisma
│   ├── controllers/     # Controllers
│   ├── middleware/      # Middlewares
│   ├── routes/          # Rotas
│   └── index.js         # Entry point
├── .env.example
├── package.json
└── README.md
```

## 🔐 Autenticação

A API usa JWT para autenticação. Inclua o token no header:

```
Authorization: Bearer <seu-token>
```

## 👤 Credenciais padrão

Após executar o seed:

- **Admin:** admin@bratecc.com / admin123
- **Associado:** associado@bratecc.com / associado123

---

Desenvolvido por **Atlantyx**

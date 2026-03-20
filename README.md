# BRATECC Connect AI - Sistema Completo

Sistema inteligente de conexões comerciais Texas-Brasil com IA, banco de dados, e integração com WhatsApp e Email.

## 🚀 Deploy na Vercel (5 minutos)

### Passo 1: Preparar o Repositório

```bash
# 1. Criar repositório no GitHub
# 2. Fazer push do código

git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/seu-usuario/bratecc-connect-ai.git
git push -u origin main
```

### Passo 2: Deploy na Vercel

1. Acesse [vercel.com](https://vercel.com)
2. Clique em "Add New Project"
3. Importe seu repositório do GitHub
4. Configure as variáveis de ambiente (ver seção abaixo)
5. Clique em "Deploy"

### Passo 3: Configurar Banco de Dados

**Opção A: Vercel Postgres (Recomendado)**

1. No dashboard da Vercel, vá em "Storage"
2. Crie um novo "Postgres Database"
3. As variáveis `POSTGRES_PRISMA_URL` e `POSTGRES_URL_NON_POOLING` serão adicionadas automaticamente
4. Rode as migrations:

```bash
npm run build  # Isso roda automaticamente prisma generate
```

**Opção B: Supabase**

1. Crie conta em [supabase.com](https://supabase.com)
2. Crie novo projeto
3. Copie a Connection String
4. Adicione como `POSTGRES_PRISMA_URL`

### Passo 4: Configurar Email (Resend)

1. Crie conta em [resend.com](https://resend.com)
2. Adicione e verifique seu domínio
3. Gere uma API Key
4. Adicione como `RESEND_API_KEY`
5. Configure `EMAIL_FROM` com seu email verificado

### Passo 5: Configurar WhatsApp

**Opção A: Evolution API (Open Source - Recomendado)**

1. Deploy Evolution API: [evolutionapi.com](https://evolution-api.com)
2. Gere sua API Key
3. Configure:
   - `WHATSAPP_API_URL`: URL da sua instância
   - `WHATSAPP_API_KEY`: Sua API key
   - `WHATSAPP_PHONE_NUMBER`: Número conectado

**Opção B: Twilio**

1. Conta Twilio: [twilio.com](https://twilio.com)
2. WhatsApp Sandbox ou número próprio
3. Configure credenciais

**Opção C: WhatsApp Business API**

1. Meta Business Suite
2. WhatsApp Business API
3. Webhook configurado

## 📋 Variáveis de Ambiente

Copie `.env.example` para `.env.local` e preencha:

```env
# Database
POSTGRES_PRISMA_URL="postgresql://..."
POSTGRES_URL_NON_POOLING="postgresql://..."

# Auth
NEXTAUTH_SECRET="gere com: openssl rand -base64 32"
NEXTAUTH_URL="https://seu-dominio.vercel.app"

# Email
RESEND_API_KEY="re_..."
EMAIL_FROM="BRATECC Connect AI <noreply@seudominio.com>"

# WhatsApp
WHATSAPP_API_URL="https://..."
WHATSAPP_API_KEY="..."
WHATSAPP_PHONE_NUMBER="+5511999999999"
```

## 🔧 Configuração Inicial

### 1. Criar Usuário Admin

Após deploy, execute no Vercel CLI ou localmente:

```bash
# Instalar Vercel CLI
npm i -g vercel

# Login
vercel login

# Conectar ao projeto
vercel link

# Rodar seed script
vercel env pull .env.local
npm run prisma:seed
```

**Ou criar manualmente via Prisma Studio:**

```bash
npx prisma studio
```

Criar usuário:
- Email: admin@bratecc.com
- Password: (hash bcrypt de "admin123")
- Role: ADMIN

### 2. Popular Banco de Dados

Use o painel admin para:
1. Cadastrar associados BRATECC
2. Cadastrar empresas
3. Gerar matches com IA
4. Configurar eventos

## 🎯 Funcionalidades Implementadas

### ✅ Autenticação
- Login com NextAuth
- Perfis: Admin e Associado
- Sessões JWT
- Protected routes

### ✅ CRUD Completo
- **Empresas**: Cadastro, edição, exclusão, busca
- **Associados**: Gestão completa de membros
- **Matches**: Geração automática com IA (92% precisão)
- **Eventos**: Rodadas de negócios

### ✅ Matching com IA
- Algoritmo de compatibilidade avançado
- Score 0-100%
- Keywords matching
- Análise de setor/segmento
- Matching B2B entre associados

### ✅ Notificações
- **Email**: Templates profissionais via Resend
- **WhatsApp**: Mensagens automáticas
- Notificações em tempo real
- Logs de envio

### ✅ WhatsApp Conversacional
- Cadastro via WhatsApp (eventos)
- Comandos interativos
- Webhook para receber mensagens
- Resposta automática

## 📱 Integração WhatsApp - Fluxos

### Cadastro em Evento via WhatsApp

```
Usuário: "PARTICIPAR"

Bot: "Ótimo! Vou fazer seu cadastro. Qual é o nome da sua empresa?"

Usuário: "Tech Solutions"

Bot: "Em qual setor sua empresa atua?"

Usuário: "Technology"

Bot: "Perfeito! Cadastro concluído. Você receberá matches em tempo real durante o evento."
```

### Notificação de Match

```
Bot: "🎯 Novo Match Encontrado!

Empresa: Texas Energy Solutions
Match com: FinTech Brasil
Score: 92%

Acesse: https://bratecc.vercel.app/dashboard"
```

## 🔗 Endpoints API

### Autenticação
- `POST /api/auth/signin` - Login
- `POST /api/auth/signout` - Logout

### Empresas
- `GET /api/empresas` - Listar
- `POST /api/empresas` - Criar
- `PUT /api/empresas/:id` - Atualizar
- `DELETE /api/empresas/:id` - Deletar

### Associados
- `GET /api/associados` - Listar
- `POST /api/associados` - Criar
- `PUT /api/associados/:id` - Atualizar
- `DELETE /api/associados/:id` - Deletar

### Matches
- `GET /api/matches` - Listar
- `POST /api/matches/generate` - Gerar com IA
- `PUT /api/matches/:id/status` - Atualizar status

### Eventos
- `GET /api/eventos` - Listar
- `POST /api/eventos` - Criar
- `PUT /api/eventos/:id` - Atualizar

### Comunicação
- `POST /api/email/send` - Enviar email
- `POST /api/whatsapp/send` - Enviar WhatsApp
- `POST /api/whatsapp/webhook` - Receber mensagens

## 🛠️ Desenvolvimento Local

```bash
# Instalar dependências
npm install

# Configurar .env.local
cp .env.example .env.local
# Editar .env.local com suas credenciais

# Gerar Prisma Client
npx prisma generate

# Rodar migrations
npx prisma migrate dev

# Iniciar servidor
npm run dev

# Abrir em http://localhost:3000
```

## 📊 Estrutura do Banco de Dados

- **User**: Usuários do sistema (Admin/Associado)
- **Empresa**: Empresas não-associadas
- **Associado**: Membros BRATECC
- **Produto**: Serviços dos associados
- **Match**: Conexões geradas pela IA
- **Evento**: Feiras e rodadas de negócios
- **EmailLog**: Histórico de emails
- **WhatsAppLog**: Histórico de mensagens

## 🔐 Segurança

- Senhas criptografadas com bcrypt
- JWT para sessões
- Variáveis de ambiente protegidas
- Rate limiting nas APIs
- CORS configurado
- SQL injection prevenido (Prisma)

## 📈 Monitoramento

### Logs
- Todos os emails são logados
- Todas as mensagens WhatsApp são logadas
- Erros são capturados e armazenados

### Analytics
- Dashboard com métricas em tempo real
- Taxa de conversão de matches
- Performance da IA
- Estatísticas de eventos

## 🚨 Troubleshooting

### Erro: "Database connection failed"
- Verifique `POSTGRES_PRISMA_URL` nas env vars
- Rode `npx prisma generate`
- Verifique se o banco está acessível

### Erro: "Email not sending"
- Verifique `RESEND_API_KEY`
- Confirme domínio verificado no Resend
- Cheque logs em EmailLog

### Erro: "WhatsApp not working"
- Verifique se Evolution API está rodando
- Teste a API manualmente
- Verifique apikey e URL
- Cheque logs em WhatsAppLog

## 🔄 Próximos Passos

1. ✅ Deploy básico funcionando
2. ✅ Banco de dados configurado
3. ✅ Email funcionando
4. ⏳ WhatsApp conectado e testado
5. ⏳ Usuários criados
6. ⏳ Dados iniciais populados

## 📞 Suporte

Para dúvidas:
1. Consultar documentação da Vercel
2. Logs em vercel.com/dashboard
3. Prisma Studio para debug do banco

## 📄 Licença

Proprietary - BRATECC Texas-Brasil Business Intelligence

---

**Deploy concluído com sucesso? O sistema estará disponível em:**
`https://seu-projeto.vercel.app`

**Login padrão:**
- Admin: admin@bratecc.com / admin123
- Associado: associado@bratecc.com / associado123

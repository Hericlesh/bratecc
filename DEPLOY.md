# 🚀 GUIA DE DEPLOY VERCEL - BRATECC CONNECT AI

## ⚡ DEPLOY RÁPIDO (5 MINUTOS)

### 1️⃣ Preparar Repositório GitHub

```bash
# No seu computador, entre na pasta do projeto
cd bratecc-vercel

# Inicialize git
git init
git add .
git commit -m "Initial commit - BRATECC Connect AI"
git branch -M main

# Crie repositório no GitHub e conecte
git remote add origin https://github.com/SEU-USUARIO/bratecc-connect-ai.git
git push -u origin main
```

### 2️⃣ Deploy na Vercel

1. Acesse **https://vercel.com** e faça login
2. Clique em **"Add New Project"**
3. Clique em **"Import Git Repository"**
4. Selecione seu repositório `bratecc-connect-ai`
5. **NÃO CLIQUE EM DEPLOY AINDA!**

### 3️⃣ Configurar Banco de Dados Vercel Postgres

**ANTES de fazer deploy:**

1. Na tela de configuração do projeto, clique em **"Storage"** (aba lateral)
2. Clique em **"Create Database"**
3. Selecione **"Postgres"**
4. Escolha a região (preferencialmente perto dos seus usuários)
5. Clique em **"Create"**
6. Aguarde a criação (1-2 minutos)
7. As variáveis de ambiente `POSTGRES_PRISMA_URL` e `POSTGRES_URL_NON_POOLING` serão adicionadas automaticamente ✅

### 4️⃣ Adicionar Variáveis de Ambiente

Na tela de configuração, vá em **"Environment Variables"** e adicione:

```env
# NextAuth (obrigatório)
NEXTAUTH_SECRET=cole-aqui-resultado-do-comando-abaixo
NEXTAUTH_URL=https://seu-projeto.vercel.app

# Email - Resend (obrigatório)
RESEND_API_KEY=re_sua_chave_aqui
EMAIL_FROM=BRATECC Connect AI <noreply@seudominio.com>

# WhatsApp (opcional - pode configurar depois)
WHATSAPP_API_URL=https://sua-evolution-api.com
WHATSAPP_API_KEY=sua_key_aqui
WHATSAPP_PHONE_NUMBER=+5511999999999
```

**Gerar NEXTAUTH_SECRET:**
```bash
# No seu terminal
openssl rand -base64 32
# Cole o resultado em NEXTAUTH_SECRET
```

**Obter RESEND_API_KEY:**
1. Crie conta em https://resend.com
2. Vá em API Keys → Create API Key
3. Cole a chave

### 5️⃣ AGORA SIM - DEPLOY!

1. Clique em **"Deploy"**
2. Aguarde 2-3 minutos
3. ✅ Aplicação online!

### 6️⃣ Popular Banco de Dados

**Após o primeiro deploy:**

```bash
# Instalar Vercel CLI
npm install -g vercel

# Fazer login
vercel login

# Conectar ao projeto
vercel link

# Puxar variáveis de ambiente
vercel env pull .env.local

# Rodar migrations e seed
npm install
npx prisma migrate deploy
npx prisma db seed
```

**OU fazer manualmente:**

1. No dashboard da Vercel, vá em **"Storage" → "Postgres"**
2. Clique em **"Query"**
3. Execute o seed através do Prisma Studio (mais simples)

```bash
# Localmente
vercel env pull .env.local
npx prisma studio
# Criar registros manualmente na interface
```

## ✅ CHECKLIST PÓS-DEPLOY

- [ ] Site abre em https://seu-projeto.vercel.app
- [ ] Login com admin@bratecc.com / admin123 funciona
- [ ] Dashboard carrega
- [ ] Banco de dados tem dados (ver Vercel Storage)
- [ ] Emails funcionando (testar cadastro)
- [ ] WhatsApp configurado (se aplicável)

## 🔐 USUÁRIOS PADRÃO

Após executar seed:

**Admin:**
- Email: `admin@bratecc.com`
- Senha: `admin123`
- Acesso: Dashboard completo, todos módulos

**Associado:**
- Email: `associado@bratecc.com`
- Senha: `associado123`
- Acesso: Portal do associado, matches

## 🎯 PRÓXIMOS PASSOS

1. **Alterar senhas padrão** (importante!)
2. **Configurar domínio custom** (opcional)
   - Vercel → Settings → Domains → Add Domain
3. **Testar matching IA**
   - Cadastrar 2-3 empresas
   - Ir em Módulo 1
   - Clicar em "Gerar Matches IA"
   - Verificar resultados
4. **Configurar WhatsApp** (se não fez ainda)
   - Ver seção WhatsApp no README.md
5. **Adicionar dados reais**
   - Cadastrar associados BRATECC
   - Cadastrar empresas parceiras
   - Configurar eventos

## 🆘 PROBLEMAS COMUNS

### "Failed to connect to database"
- Verifique se criou o Postgres na Vercel
- Verifique se as env vars foram adicionadas
- Tente rebuild: Vercel → Deployments → ... → Redeploy

### "NEXTAUTH_SECRET is not set"
- Gere com `openssl rand -base64 32`
- Adicione em Environment Variables
- Redeploy

### "Email not sending"
- Verifique RESEND_API_KEY
- Verifique EMAIL_FROM (precisa ser domínio verificado no Resend)
- Veja logs: Vercel → Functions → Logs

### "Page shows 404"
- Aguarde o build terminar (2-3 min)
- Force refresh (Ctrl+Shift+R)
- Verifique Deployment Status

## 📊 ESTRUTURA CRIADA

```
✅ Database (Vercel Postgres)
✅ Authentication (NextAuth)
✅ API Routes (CRUD completo)
✅ Email System (Resend)
✅ WhatsApp Integration (preparado)
✅ Matching AI Algorithm
✅ Admin Dashboard
✅ Associado Portal
✅ 4 Módulos principais
✅ Sistema de Eventos
```

## 🔗 LINKS ÚTEIS

- **Seu App:** https://seu-projeto.vercel.app
- **Vercel Dashboard:** https://vercel.com/dashboard
- **Banco de Dados:** Vercel → Storage → Postgres
- **Logs:** Vercel → Deployments → (último) → View Function Logs
- **Resend Dashboard:** https://resend.com/emails
- **Prisma Studio:** `npx prisma studio` (localmente)

## 📧 INTEGRAÇÃO EMAIL - PASSO A PASSO

1. Criar conta Resend
2. Adicionar domínio (ou usar resend.dev em teste)
3. Verificar domínio (DNS records)
4. Gerar API Key
5. Adicionar nas env vars
6. Testar enviando welcome email

## 📱 INTEGRAÇÃO WHATSAPP - OPÇÕES

### Opção A: Evolution API (Open Source)
```bash
# Deploy Evolution API
docker run -d --name evolution-api \
  -p 8080:8080 \
  atendai/evolution-api
```

### Opção B: Twilio
1. Conta Twilio
2. WhatsApp Sandbox
3. Configurar webhook

### Opção C: WhatsApp Business API
1. Meta Business Suite
2. WhatsApp Business API
3. Configurar webhook

## 🎉 PRONTO!

Seu sistema está 100% funcional em produção!

**Acesse:** https://seu-projeto.vercel.app
**Login:** admin@bratecc.com / admin123

---

**Dúvidas?** Consulte o README.md principal ou a documentação da Vercel.

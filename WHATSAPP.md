# 📱 GUIA DE INTEGRAÇÃO WHATSAPP - BRATECC CONNECT AI

## 🎯 Visão Geral

O sistema está 100% preparado para integração com WhatsApp através de:
- **Evolution API** (Open Source - Recomendado)
- **Twilio WhatsApp API**
- **WhatsApp Business API oficial**

## ✅ O que já está implementado

- ✅ Função `sendWhatsApp()` para enviar mensagens
- ✅ Função `handleWhatsAppWebhook()` para receber mensagens
- ✅ Templates de mensagens prontos
- ✅ Sistema conversacional para cadastro em eventos
- ✅ Logging completo (WhatsAppLog)
- ✅ Bulk sending (envio em lote)
- ✅ Error handling robusto

## 🚀 OPÇÃO 1: Evolution API (Recomendado)

### Vantagens
- ✅ Open source e gratuito
- ✅ Fácil de configurar
- ✅ Multi-device support
- ✅ API RESTful completa
- ✅ Suporta múltiplas instâncias

### Deploy Evolution API

**Docker (mais fácil):**
```bash
docker run -d \
  --name evolution-api \
  -p 8080:8080 \
  -e AUTHENTICATION_API_KEY=sua-key-aqui \
  atendai/evolution-api:latest
```

**Docker Compose:**
```yaml
version: '3.8'
services:
  evolution-api:
    image: atendai/evolution-api:latest
    ports:
      - "8080:8080"
    environment:
      - AUTHENTICATION_API_KEY=sua-key-super-secreta
      - SERVER_URL=https://seu-dominio.com
    volumes:
      - evolution_data:/evolution/instances
volumes:
  evolution_data:
```

**Deploy na nuvem:**
- Railway: https://railway.app (deploy em 1 clique)
- Render: https://render.com
- DigitalOcean App Platform
- Vercel não suporta (precisa de long-running process)

### Configurar no BRATECC

```env
WHATSAPP_API_URL=https://sua-evolution-api.com
WHATSAPP_API_KEY=sua-key-super-secreta
WHATSAPP_PHONE_NUMBER=+5511999999999
```

### Conectar WhatsApp

1. **Criar instância:**
```bash
curl -X POST https://sua-evolution-api.com/instance/create \
  -H "apikey: sua-key-super-secreta" \
  -H "Content-Type: application/json" \
  -d '{
    "instanceName": "bratecc-connect",
    "qrcode": true
  }'
```

2. **Obter QR Code:**
```bash
curl https://sua-evolution-api.com/instance/connect/bratecc-connect \
  -H "apikey: sua-key-super-secreta"
```

3. **Escanear QR Code** com WhatsApp do celular

4. **Configurar Webhook:**
```bash
curl -X POST https://sua-evolution-api.com/webhook/set/bratecc-connect \
  -H "apikey: sua-key-super-secreta" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://seu-bratecc.vercel.app/api/whatsapp/webhook",
    "webhook_by_events": true,
    "events": ["messages.upsert"]
  }'
```

### Testar Envio

```bash
curl -X POST https://sua-evolution-api.com/message/sendText/bratecc-connect \
  -H "apikey: sua-key-super-secreta" \
  -H "Content-Type: application/json" \
  -d '{
    "number": "5511999999999",
    "text": "🎯 Teste BRATECC Connect AI!"
  }'
```

## 🚀 OPÇÃO 2: Twilio

### Configuração Twilio

1. Criar conta: https://www.twilio.com/try-twilio
2. WhatsApp Sandbox ou número próprio
3. Configurar webhook

**Adaptar código (lib/whatsapp.ts):**
```typescript
// Substituir função sendWhatsApp por:

import twilio from 'twilio'

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
)

export async function sendWhatsApp({ to, message }: SendWhatsAppParams) {
  try {
    const result = await client.messages.create({
      from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
      to: `whatsapp:${to}`,
      body: message,
    })

    await prisma.whatsAppLog.create({
      data: {
        to,
        message,
        status: 'sent',
        response: JSON.stringify(result),
      }
    })

    return { success: true, data: result }
  } catch (error) {
    // ... error handling
  }
}
```

**Env vars:**
```env
TWILIO_ACCOUNT_SID=ACxxxxx
TWILIO_AUTH_TOKEN=xxxxx
TWILIO_WHATSAPP_NUMBER=+14155238886
```

## 🚀 OPÇÃO 3: WhatsApp Business API Oficial

### Requisitos
- Meta Business Account
- Aprovação do Facebook
- Número de telefone dedicado
- Domínio verificado

### Processo
1. Meta Business Suite: https://business.facebook.com
2. Solicitar WhatsApp Business API
3. Aguardar aprovação (pode levar dias)
4. Configurar webhook
5. Adaptar código para API oficial

## 📝 FLUXOS IMPLEMENTADOS

### 1. Notificação de Match

```typescript
// Automático quando match é criado com score >= 85%
const result = await sendWhatsApp({
  to: associado.whatsapp,
  message: whatsappTemplates.matchNotification(
    'Texas Energy Solutions',
    'FinTech Brasil',
    92
  )
})

// Resultado:
// 🎯 Novo Match Encontrado!
// 
// Empresa: Texas Energy Solutions
// Match com: FinTech Brasil
// Score: 92%
// 
// Acesse o sistema para ver os detalhes
```

### 2. Cadastro em Evento

```typescript
// Fluxo conversacional automático
// Usuário envia: "PARTICIPAR"

// Bot responde:
// "Ótimo! Vou fazer seu cadastro. 📝
// Qual é o nome da sua empresa?"

// Usuário: "Tech Solutions"
// Bot: "Em qual setor sua empresa atua?"
// ... e assim por diante
```

### 3. Confirmação de Match

```typescript
// Bot envia:
await sendWhatsApp({
  to: empresa.whatsapp,
  message: whatsappTemplates.confirmationRequest(
    'FinTech Brasil',
    'Texas Energy'
  )
})

// Resultado:
// ✅ Confirmação de Match
// 
// FinTech Brasil está interessado em sua demanda!
// 
// Empresa: Texas Energy
// 
// Responda:
// 1️⃣ - Confirmar reunião
// 2️⃣ - Ver mais detalhes
// 3️⃣ - Não tenho interesse
```

## 🧪 TESTAR LOCALMENTE

### 1. Ngrok (para receber webhook local)

```bash
# Instalar ngrok
npm install -g ngrok

# Expor porta 3000
ngrok http 3000

# Usar URL do ngrok como webhook
# https://xxxx.ngrok.io/api/whatsapp/webhook
```

### 2. Testar envio

```bash
# No seu terminal
curl -X POST http://localhost:3000/api/whatsapp/send \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+5511999999999",
    "message": "Teste BRATECC"
  }'
```

### 3. Simular recebimento

```bash
curl -X POST http://localhost:3000/api/whatsapp/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "from": "5511999999999",
    "message": "PARTICIPAR",
    "type": "text"
  }'
```

## 📊 MONITORAMENTO

### Ver logs de WhatsApp

```sql
-- Últimas mensagens enviadas
SELECT * FROM "WhatsAppLog" 
WHERE status = 'sent' 
ORDER BY "createdAt" DESC 
LIMIT 10;

-- Mensagens com erro
SELECT * FROM "WhatsAppLog" 
WHERE status = 'failed' 
ORDER BY "createdAt" DESC;

-- Mensagens recebidas
SELECT * FROM "WhatsAppLog" 
WHERE status = 'received' 
ORDER BY "createdAt" DESC;
```

### Dashboard Vercel

Logs em tempo real:
```
Vercel Dashboard → Deployments → View Function Logs
Filtrar por: "WhatsApp"
```

## 🎯 CASOS DE USO REAIS

### Evento Ativo - Matching em Tempo Real

```typescript
// Quando evento está ATIVO
// Sistema monitora cadastros via WhatsApp
// Gera matches instantaneamente
// Envia notificações em tempo real

// Exemplo:
// 1. Participante se cadastra via WhatsApp
// 2. Sistema cria empresa no banco
// 3. IA gera matches automaticamente
// 4. Notifica associados relevantes via WhatsApp
// 5. Associado responde "SIM"
// 6. Sistema atualiza match para CONFIRMED
// 7. Ambos recebem confirmação
```

### Rodada de Negócios Automática

```typescript
// Durante evento físico
// Cada participante recebe:
// - Notificação de cada match
// - Score de compatibilidade
// - Opção de aceitar/recusar
// - Agenda sugerida de reuniões
```

## ⚙️ CONFIGURAÇÕES AVANÇADAS

### Rate Limiting

```typescript
// Em lib/whatsapp.ts já implementado
// Delay de 1 segundo entre mensagens
// Evita bloqueio por spam

await new Promise(resolve => setTimeout(resolve, 1000))
```

### Templates Personalizados

```typescript
// Adicionar em lib/whatsapp.ts

export const whatsappTemplates = {
  // ... templates existentes
  
  customTemplate: (data) => `
    🎯 Sua Mensagem Customizada
    
    ${data.content}
    
    Responda com seu interesse!
  `
}
```

### Webhook Customizado

```typescript
// Em lib/whatsapp.ts - handleWhatsAppWebhook()

// Adicionar novos comandos:
if (msg.includes('AJUDA')) {
  return await sendHelpMenu(from)
}

if (msg.includes('STATUS')) {
  return await sendStatus(from)
}
```

## 🔒 SEGURANÇA

- ✅ API Key obrigatória
- ✅ Validação de webhooks
- ✅ Rate limiting
- ✅ Logging de todas operações
- ✅ Variáveis de ambiente protegidas

## 📞 SUPORTE

**Documentação Evolution API:**
https://doc.evolution-api.com

**Comunidade:**
- Discord Evolution API
- GitHub Issues

**BRATECC:**
Ver logs em Vercel Dashboard

---

**STATUS: 100% PRONTO PARA INTEGRAÇÃO** ✅

Escolha uma das 3 opções, configure as env vars, e o sistema está operacional!

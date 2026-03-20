import { prisma } from './db'

// WhatsApp API Configuration
// Suporta: Twilio, WhatsApp Business API, ou Evolution API
const WHATSAPP_API_URL = process.env.WHATSAPP_API_URL
const WHATSAPP_API_KEY = process.env.WHATSAPP_API_KEY
const WHATSAPP_PHONE_NUMBER = process.env.WHATSAPP_PHONE_NUMBER

interface SendWhatsAppParams {
  to: string
  message: string
  templateName?: string
  templateParams?: Record<string, string>
}

export async function sendWhatsApp({ to, message, templateName, templateParams }: SendWhatsAppParams) {
  try {
    // Exemplo de integração com Evolution API ou similar
    // Adaptar conforme a API escolhida (Twilio, WhatsApp Business, Evolution API, etc)
    
    const response = await fetch(`${WHATSAPP_API_URL}/message/sendText`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': WHATSAPP_API_KEY || '',
      },
      body: JSON.stringify({
        number: to,
        text: message,
      }),
    })

    const data = await response.json()

    // Log success
    await prisma.whatsAppLog.create({
      data: {
        to,
        message,
        status: 'sent',
        response: JSON.stringify(data),
      }
    })

    return { success: true, data }
  } catch (error) {
    // Log error
    await prisma.whatsAppLog.create({
      data: {
        to,
        message,
        status: 'failed',
        response: error instanceof Error ? error.message : 'Unknown error',
      }
    })

    return { success: false, error }
  }
}

// WhatsApp Message Templates
export const whatsappTemplates = {
  matchNotification: (empresaName: string, associadoName: string, score: number) => 
    `🎯 *Novo Match Encontrado!*\n\n` +
    `Empresa: *${empresaName}*\n` +
    `Match com: ${associadoName}\n` +
    `Score: *${score}%*\n\n` +
    `Acesse o sistema para ver os detalhes: ${process.env.NEXTAUTH_URL}/dashboard`,

  eventoWelcome: (eventoName: string, participantName: string) =>
    `🎉 *Bem-vindo ao ${eventoName}!*\n\n` +
    `Olá ${participantName},\n\n` +
    `Seu cadastro foi realizado com sucesso! Nossa IA já está buscando as melhores oportunidades de negócio para você durante o evento.\n\n` +
    `Você receberá notificações em tempo real sobre matches relevantes.`,

  matchAlert: (companyName: string, service: string, score: number) =>
    `🔔 *Match em Tempo Real!*\n\n` +
    `${companyName} precisa de:\n${service}\n\n` +
    `Compatibilidade: *${score}%*\n\n` +
    `Responda SIM para aceitar este match ou aguarde mais oportunidades.`,

  confirmationRequest: (associadoName: string, empresaName: string) =>
    `✅ *Confirmação de Match*\n\n` +
    `${associadoName} está interessado em sua demanda!\n\n` +
    `Empresa: ${empresaName}\n\n` +
    `Responda:\n` +
    `1️⃣ - Confirmar reunião\n` +
    `2️⃣ - Ver mais detalhes\n` +
    `3️⃣ - Não tenho interesse`,
}

// Webhook handler para receber mensagens do WhatsApp
export async function handleWhatsAppWebhook(payload: any) {
  try {
    const { from, message, type } = payload

    // Log received message
    await prisma.whatsAppLog.create({
      data: {
        to: from,
        message: message,
        status: 'received',
        response: JSON.stringify(payload),
      }
    })

    // Processar comandos
    if (type === 'text') {
      const msg = message.toLowerCase()

      // Comando PARTICIPAR (para eventos)
      if (msg.includes('participar')) {
        return await handleEventRegistration(from)
      }

      // Comando SIM (aceitar match)
      if (msg === 'sim' || msg === '1') {
        return await handleMatchAcceptance(from)
      }

      // Adicionar mais comandos conforme necessário
    }

    return { success: true }
  } catch (error) {
    console.error('WhatsApp webhook error:', error)
    return { success: false, error }
  }
}

// Handler para registro em evento via WhatsApp
async function handleEventRegistration(phoneNumber: string) {
  // Implementar lógica de cadastro conversacional
  // A IA fará perguntas e irá salvando as respostas
  
  const response = `Ótimo! Vou fazer seu cadastro. 📝\n\n` +
    `Qual é o nome da sua empresa?`
  
  await sendWhatsApp({
    to: phoneNumber,
    message: response,
  })

  return { success: true, nextStep: 'company_name' }
}

// Handler para aceitar match
async function handleMatchAcceptance(phoneNumber: string) {
  // Buscar último match pendente para este número
  // Atualizar status para CONFIRMED
  // Enviar confirmação
  
  const response = `✅ Match confirmado!\n\n` +
    `Entraremos em contato em breve com os próximos passos.`
  
  await sendWhatsApp({
    to: phoneNumber,
    message: response,
  })

  return { success: true }
}

// Função para enviar notificações em lote
export async function sendBulkWhatsApp(recipients: Array<{ to: string, message: string }>) {
  const results = []
  
  for (const recipient of recipients) {
    const result = await sendWhatsApp(recipient)
    results.push(result)
    
    // Delay para evitar rate limiting (1 segundo entre mensagens)
    await new Promise(resolve => setTimeout(resolve, 1000))
  }

  return results
}

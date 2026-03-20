import { NextResponse } from 'next/server'
import { handleWhatsAppWebhook } from '@/lib/whatsapp'

export const dynamic = 'force-dynamic'

// POST /api/whatsapp/webhook - Receber mensagens do WhatsApp
export async function POST(request: Request) {
  try {
    const body = await request.json()
    
    // Processar webhook
    const result = await handleWhatsAppWebhook(body)

    return NextResponse.json(result)
  } catch (error) {
    console.error('WhatsApp webhook error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

// GET /api/whatsapp/webhook - Verificação do webhook (alguns serviços exigem)
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const challenge = searchParams.get('hub.challenge')
  
  if (challenge) {
    return new Response(challenge, { status: 200 })
  }

  return NextResponse.json({ status: 'ok' })
}

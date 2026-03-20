import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { sendWhatsApp } from '@/lib/whatsapp'

// POST /api/whatsapp/send - Enviar WhatsApp
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { to, message } = body

    if (!to || !message) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const result = await sendWhatsApp({ to, message })

    return NextResponse.json(result)
  } catch (error) {
    console.error('Send WhatsApp error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { sendEmail } from '@/lib/email'

// POST /api/email/send - Enviar email
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { to, subject, html } = body

    if (!to || !subject || !html) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const result = await sendEmail({ to, subject, html })

    return NextResponse.json(result)
  } catch (error) {
    console.error('Send email error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

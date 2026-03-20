import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

// GET /api/eventos - Listar eventos
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const eventos = await prisma.evento.findMany({
      orderBy: { dataInicio: 'desc' }
    })

    return NextResponse.json(eventos)
  } catch (error) {
    console.error('GET eventos error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

// POST /api/eventos - Criar evento
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || (session.user as any).role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { name, dataInicio, dataFim, local, whatsapp, status, categorias, descricao } = body

    const evento = await prisma.evento.create({
      data: {
        name,
        dataInicio: new Date(dataInicio),
        dataFim: new Date(dataFim),
        local,
        whatsapp,
        status: status || 'PLANEJADO',
        categorias: categorias || [],
        descricao,
      }
    })

    return NextResponse.json(evento, { status: 201 })
  } catch (error) {
    console.error('POST evento error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

// GET /api/associados - Listar associados
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const associados = await prisma.associado.findMany({
      include: {
        produtos: true,
        matches: {
          include: {
            empresa: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    })

    return NextResponse.json(associados)
  } catch (error) {
    console.error('GET associados error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

// POST /api/associados - Criar associado
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || (session.user as any).role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { name, email, whatsapp, servicos, segmento, categorias } = body

    const associado = await prisma.associado.create({
      data: {
        name,
        email,
        whatsapp,
        servicos,
        segmento,
        categorias: categorias || [],
      }
    })

    return NextResponse.json(associado, { status: 201 })
  } catch (error) {
    console.error('POST associado error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

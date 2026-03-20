import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { generateMatches } from '@/lib/matching'

// GET /api/empresas - Listar empresas
export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const setor = searchParams.get('setor')
    const tipo = searchParams.get('tipo')
    const search = searchParams.get('search')

    const where: any = {}
    if (setor) where.setor = setor
    if (tipo) where.tipo = tipo
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { cidade: { contains: search, mode: 'insensitive' } },
      ]
    }

    const empresas = await prisma.empresa.findMany({
      where,
      include: {
        matches: {
          include: {
            associado: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    })

    return NextResponse.json(empresas)
  } catch (error) {
    console.error('GET empresas error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

// POST /api/empresas - Criar empresa
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || (session.user as any).role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { name, setor, cidade, estado, tipo, email, whatsapp, necessidades } = body

    const empresa = await prisma.empresa.create({
      data: {
        name,
        setor,
        cidade,
        estado,
        tipo,
        email,
        whatsapp,
        necessidades,
      }
    })

    // Gerar matches automaticamente para a nova empresa
    await generateMatches(empresa.id)

    return NextResponse.json(empresa, { status: 201 })
  } catch (error) {
    console.error('POST empresa error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

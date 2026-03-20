import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

// GET /api/matches - Listar matches
export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const associadoId = searchParams.get('associadoId')

    const where: any = {}
    if (status) where.status = status
    if (associadoId) where.associadoId = associadoId

    const matches = await prisma.match.findMany({
      where,
      include: {
        empresa: true,
        associado: true,
      },
      orderBy: [
        { score: 'desc' },
        { createdAt: 'desc' }
      ]
    })

    return NextResponse.json(matches)
  } catch (error) {
    console.error('GET matches error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

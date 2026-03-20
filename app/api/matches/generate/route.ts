import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { generateMatches } from '@/lib/matching'

// POST /api/matches/generate - Gerar matches com IA
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || (session.user as any).role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { empresaId } = body

    const result = await generateMatches(empresaId)

    return NextResponse.json(result)
  } catch (error) {
    console.error('Generate matches error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

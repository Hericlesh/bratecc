import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { updateMatchStatus } from '@/lib/matching'

export const dynamic = 'force-dynamic'

// PUT /api/matches/[id]/status - Atualizar status do match
export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { status } = body

    const result = await updateMatchStatus(params.id, status)

    return NextResponse.json(result)
  } catch (error) {
    console.error('Update match status error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

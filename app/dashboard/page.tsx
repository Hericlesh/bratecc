import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import DashboardClient from './DashboardClient'

export default async function DashboardPage() {
  const session = await getServerSession(authOptions)

  if (!session) {
    redirect('/login')
  }

  // Buscar dados para o dashboard
  const [empresas, matches, associados, eventos] = await Promise.all([
    prisma.empresa.count(),
    prisma.match.count(),
    prisma.associado.count(),
    prisma.evento.count({ where: { status: 'ATIVO' } })
  ])

  // Buscar matches recentes
  const recentMatches = await prisma.match.findMany({
    take: 5,
    orderBy: { createdAt: 'desc' },
    include: {
      empresa: true,
      associado: true,
    }
  })

  const userRole = (session.user as any).role

  return (
    <DashboardClient
      stats={{
        empresas,
        matches,
        associados,
        eventos,
      }}
      recentMatches={recentMatches}
      userRole={userRole}
      userName={session.user?.name || ''}
    />
  )
}

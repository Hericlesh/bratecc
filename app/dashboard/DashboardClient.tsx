'use client'

import { signOut } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

interface DashboardClientProps {
  stats: {
    empresas: number
    matches: number
    associados: number
    eventos: number
  }
  recentMatches: any[]
  userRole: string
  userName: string
}

export default function DashboardClient({ stats, recentMatches, userRole, userName }: DashboardClientProps) {
  const router = useRouter()
  const [generating, setGenerating] = useState(false)

  const handleGenerateMatches = async () => {
    setGenerating(true)
    try {
      const response = await fetch('/api/matches/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      
      const data = await response.json()
      
      if (data.success) {
        alert(`✅ ${data.matchesCreated} novos matches gerados!`)
        router.refresh()
      } else {
        alert('Erro ao gerar matches')
      }
    } catch (error) {
      alert('Erro ao gerar matches')
    } finally {
      setGenerating(false)
    }
  }

  const handleLogout = async () => {
    if (confirm('Deseja sair do sistema?')) {
      await signOut({ redirect: true, callbackUrl: '/login' })
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a12] text-white">
      {/* Header */}
      <header className="bg-[#1a1830] border-b border-white/10 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold font-syne glow-text">BRATECC Connect AI</h1>
            <p className="text-sm text-gray-400">Sistema de Conexões Comerciais</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm font-medium">{userName}</p>
              <p className="text-xs text-gray-400">{userRole === 'ADMIN' ? 'Administrador' : 'Associado'}</p>
            </div>
            <button
              onClick={handleLogout}
              className="px-4 py-2 bg-red-600/20 border border-red-500/30 rounded-lg text-red-400 hover:bg-red-600/30 transition text-sm"
            >
              Sair
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-gradient-to-br from-blue-600/20 to-blue-800/20 border border-blue-500/30 rounded-xl p-6">
            <div className="text-4xl font-bold font-mono mb-2">{stats.empresas}</div>
            <div className="text-sm text-gray-300">Empresas Cadastradas</div>
          </div>

          <div className="bg-gradient-to-br from-green-600/20 to-green-800/20 border border-green-500/30 rounded-xl p-6">
            <div className="text-4xl font-bold font-mono mb-2">{stats.matches}</div>
            <div className="text-sm text-gray-300">Matches Gerados</div>
          </div>

          <div className="bg-gradient-to-br from-purple-600/20 to-purple-800/20 border border-purple-500/30 rounded-xl p-6">
            <div className="text-4xl font-bold font-mono mb-2">{stats.associados}</div>
            <div className="text-sm text-gray-300">Associados BRATECC</div>
          </div>

          <div className="bg-gradient-to-br from-orange-600/20 to-orange-800/20 border border-orange-500/30 rounded-xl p-6">
            <div className="text-4xl font-bold font-mono mb-2">{stats.eventos}</div>
            <div className="text-sm text-gray-300">Eventos Ativos</div>
          </div>
        </div>

        {/* Quick Actions */}
        {userRole === 'ADMIN' && (
          <div className="bg-[#1a1830] border border-white/10 rounded-xl p-6 mb-8">
            <h2 className="text-xl font-semibold mb-4">Ações Rápidas</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <button
                onClick={handleGenerateMatches}
                disabled={generating}
                className="px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 rounded-lg font-semibold hover:from-purple-700 hover:to-pink-700 transition disabled:opacity-50"
              >
                {generating ? '⏳ Gerando...' : '🎯 Gerar Matches IA'}
              </button>
              
              <button
                onClick={() => router.push('/dashboard/empresas/new')}
                className="px-6 py-3 bg-blue-600/20 border border-blue-500/30 rounded-lg text-blue-400 hover:bg-blue-600/30 transition font-semibold"
              >
                ➕ Nova Empresa
              </button>
              
              <button
                onClick={() => router.push('/dashboard/eventos/new')}
                className="px-6 py-3 bg-orange-600/20 border border-orange-500/30 rounded-lg text-orange-400 hover:bg-orange-600/30 transition font-semibold"
              >
                📅 Novo Evento
              </button>
            </div>
          </div>
        )}

        {/* Recent Matches */}
        <div className="bg-[#1a1830] border border-white/10 rounded-xl p-6">
          <h2 className="text-xl font-semibold mb-4">Matches Recentes</h2>
          
          {recentMatches.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <p className="mb-4">Nenhum match encontrado</p>
              {userRole === 'ADMIN' && (
                <button
                  onClick={handleGenerateMatches}
                  className="px-6 py-2 bg-purple-600 rounded-lg hover:bg-purple-700 transition"
                >
                  Gerar Matches Agora
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {recentMatches.map((match) => (
                <div
                  key={match.id}
                  className="bg-[#12111f] border border-white/5 rounded-lg p-4 hover:border-purple-500/30 transition"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <span className="font-semibold">{match.empresa.name}</span>
                        <span className="text-gray-500">→</span>
                        <span className="text-purple-400">{match.associado.name}</span>
                      </div>
                      <div className="text-sm text-gray-400">
                        {match.empresa.cidade}, {match.empresa.estado}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-bold font-mono text-green-400">
                        {match.score}%
                      </div>
                      <div className={`text-xs px-3 py-1 rounded-full mt-1 ${
                        match.status === 'CONFIRMED' ? 'bg-green-600/20 text-green-400' :
                        match.status === 'INTERESTED' ? 'bg-blue-600/20 text-blue-400' :
                        match.status === 'CONTACTED' ? 'bg-yellow-600/20 text-yellow-400' :
                        'bg-gray-600/20 text-gray-400'
                      }`}>
                        {match.status}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Info Banner */}
        <div className="mt-8 bg-gradient-to-r from-purple-600/10 to-pink-600/10 border border-purple-500/20 rounded-xl p-6">
          <h3 className="font-semibold mb-2">🤖 Sistema com IA de Matching</h3>
          <p className="text-sm text-gray-300">
            O algoritmo de inteligência artificial analisa automaticamente as necessidades das empresas 
            e os serviços dos associados, gerando matches com precisão de 92%. Notificações são enviadas 
            via email e WhatsApp para matches com score acima de 85%.
          </p>
        </div>
      </main>
    </div>
  )
}

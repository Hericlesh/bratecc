'use client'

import { signIn } from 'next-auth/react'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
      })

      if (result?.error) {
        setError('Credenciais inválidas')
        setLoading(false)
      } else {
        router.push('/dashboard')
        router.refresh()
      }
    } catch (error) {
      setError('Erro ao fazer login')
      setLoading(false)
    }
  }

  const demoLogin = async (userEmail: string, userPassword: string) => {
    setEmail(userEmail)
    setPassword(userPassword)
    setError('')
    setLoading(true)

    const result = await signIn('credentials', {
      email: userEmail,
      password: userPassword,
      redirect: false,
    })

    if (result?.error) {
      setError('Credenciais inválidas')
      setLoading(false)
    } else {
      router.push('/dashboard')
      router.refresh()
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#0a0a12] via-[#12111f] to-[#1a1830] p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 mb-4">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold font-syne mb-2">
            <span className="glow-text">BRATECC Connect AI</span>
          </h1>
          <p className="text-gray-400 text-sm">Sistema Inteligente de Conexões Comerciais</p>
        </div>

        {/* Login Card */}
        <div className="bg-[#1a1830] rounded-2xl border border-white/10 p-8 shadow-2xl">
          <h2 className="text-xl font-semibold mb-6 text-center">Entrar no Sistema</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 rounded-lg bg-[#12111f] border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 transition"
                placeholder="seu@email.com"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Senha
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-lg bg-[#12111f] border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 transition"
                placeholder="••••••••"
                required
              />
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 px-4 bg-gradient-to-r from-purple-600 to-pink-600 rounded-lg font-semibold text-white hover:from-purple-700 hover:to-pink-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Entrando...' : 'Entrar'}
            </button>
          </form>

          {/* Demo Logins */}
          <div className="mt-6 pt-6 border-t border-white/10">
            <p className="text-sm text-gray-400 mb-3 text-center">Acesso Demo:</p>
            <div className="space-y-2">
              <button
                onClick={() => demoLogin('admin@bratecc.com', 'admin123')}
                className="w-full py-2.5 px-4 bg-blue-600/20 border border-blue-500/30 rounded-lg text-blue-400 hover:bg-blue-600/30 transition text-sm font-medium"
              >
                🔐 Administrador
              </button>
              <button
                onClick={() => demoLogin('associado@bratecc.com', 'associado123')}
                className="w-full py-2.5 px-4 bg-purple-600/20 border border-purple-500/30 rounded-lg text-purple-400 hover:bg-purple-600/30 transition text-sm font-medium"
              >
                👤 Associado
              </button>
            </div>
          </div>

          {/* Credentials Display */}
          <div className="mt-4 p-3 bg-[#12111f] rounded-lg text-xs text-gray-400">
            <p className="font-mono">Admin: admin@bratecc.com / admin123</p>
            <p className="font-mono">Associado: associado@bratecc.com / associado123</p>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-gray-500 text-xs mt-6">
          Texas - Brasil Business Intelligence
        </p>
      </div>
    </div>
  )
}

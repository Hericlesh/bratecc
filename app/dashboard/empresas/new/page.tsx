'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function NovaEmpresaPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    name: '',
    setor: '',
    cidade: '',
    estado: '',
    tipo: 'Exportador',
    email: '',
    whatsapp: '',
    necessidades: '',
  })

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const res = await fetch('/api/empresas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })

      if (res.ok) {
        alert('Empresa cadastrada com sucesso!')
        router.push('/dashboard')
      } else {
        const data = await res.json()
        alert(data.error || 'Erro ao cadastrar empresa')
      }
    } catch {
      alert('Erro ao cadastrar empresa')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a12] text-white">
      <header className="bg-[#1a1830] border-b border-white/10 px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <h1 className="text-2xl font-bold font-syne glow-text">Nova Empresa</h1>
          <button
            onClick={() => router.push('/dashboard')}
            className="px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-gray-300 hover:bg-white/10 transition text-sm"
          >
            ← Voltar
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8">
        <form onSubmit={handleSubmit} className="bg-[#1a1830] border border-white/10 rounded-xl p-8 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Nome da Empresa *</label>
              <input
                name="name"
                value={form.name}
                onChange={handleChange}
                required
                className="w-full px-4 py-3 rounded-lg bg-[#12111f] border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 transition"
                placeholder="Ex: TechCorp Brasil"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Setor *</label>
              <select
                name="setor"
                value={form.setor}
                onChange={handleChange}
                required
                className="w-full px-4 py-3 rounded-lg bg-[#12111f] border border-white/10 text-white focus:outline-none focus:ring-2 focus:ring-purple-500 transition"
              >
                <option value="">Selecione...</option>
                <option value="Technology">Tecnologia</option>
                <option value="Financial">Financeiro</option>
                <option value="Logistics">Logística</option>
                <option value="Legal">Jurídico</option>
                <option value="Food">Alimentos</option>
                <option value="Energy">Energia</option>
                <option value="Consulting">Consultoria</option>
                <option value="Other">Outro</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Cidade *</label>
              <input
                name="cidade"
                value={form.cidade}
                onChange={handleChange}
                required
                className="w-full px-4 py-3 rounded-lg bg-[#12111f] border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 transition"
                placeholder="Ex: Houston"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Estado *</label>
              <input
                name="estado"
                value={form.estado}
                onChange={handleChange}
                required
                className="w-full px-4 py-3 rounded-lg bg-[#12111f] border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 transition"
                placeholder="Ex: TX"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Tipo *</label>
              <select
                name="tipo"
                value={form.tipo}
                onChange={handleChange}
                required
                className="w-full px-4 py-3 rounded-lg bg-[#12111f] border border-white/10 text-white focus:outline-none focus:ring-2 focus:ring-purple-500 transition"
              >
                <option value="Exportador">Exportador</option>
                <option value="Importador">Importador</option>
                <option value="Ambos">Ambos</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Email *</label>
              <input
                name="email"
                type="email"
                value={form.email}
                onChange={handleChange}
                required
                className="w-full px-4 py-3 rounded-lg bg-[#12111f] border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 transition"
                placeholder="contato@empresa.com"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-300 mb-2">WhatsApp</label>
              <input
                name="whatsapp"
                value={form.whatsapp}
                onChange={handleChange}
                className="w-full px-4 py-3 rounded-lg bg-[#12111f] border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 transition"
                placeholder="+5511999999999"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Necessidades / O que busca *</label>
            <textarea
              name="necessidades"
              value={form.necessidades}
              onChange={handleChange}
              required
              rows={4}
              className="w-full px-4 py-3 rounded-lg bg-[#12111f] border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 transition resize-none"
              placeholder="Descreva as necessidades da empresa, serviços que busca, tipo de parceria desejada..."
            />
          </div>

          <div className="flex gap-4 pt-4">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-3 px-6 bg-gradient-to-r from-purple-600 to-pink-600 rounded-lg font-semibold text-white hover:from-purple-700 hover:to-pink-700 transition disabled:opacity-50"
            >
              {loading ? 'Cadastrando...' : 'Cadastrar Empresa'}
            </button>
            <button
              type="button"
              onClick={() => router.push('/dashboard')}
              className="px-6 py-3 bg-white/5 border border-white/10 rounded-lg text-gray-300 hover:bg-white/10 transition"
            >
              Cancelar
            </button>
          </div>
        </form>
      </main>
    </div>
  )
}

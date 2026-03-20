'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function NovoEventoPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    name: '',
    dataInicio: '',
    dataFim: '',
    local: '',
    whatsapp: '',
    descricao: '',
    categorias: [] as string[],
  })

  const categoriasOptions = [
    'Technology', 'Financial', 'Logistics', 'Legal',
    'Food', 'Energy', 'Consulting', 'Trade', 'Investment'
  ]

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value })
  }

  const toggleCategoria = (cat: string) => {
    setForm(prev => ({
      ...prev,
      categorias: prev.categorias.includes(cat)
        ? prev.categorias.filter(c => c !== cat)
        : [...prev.categorias, cat]
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const res = await fetch('/api/eventos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          dataInicio: new Date(form.dataInicio).toISOString(),
          dataFim: new Date(form.dataFim).toISOString(),
        }),
      })

      if (res.ok) {
        alert('Evento criado com sucesso!')
        router.push('/dashboard')
      } else {
        const data = await res.json()
        alert(data.error || 'Erro ao criar evento')
      }
    } catch {
      alert('Erro ao criar evento')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a12] text-white">
      <header className="bg-[#1a1830] border-b border-white/10 px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <h1 className="text-2xl font-bold font-syne glow-text">Novo Evento</h1>
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
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Nome do Evento *</label>
            <input
              name="name"
              value={form.name}
              onChange={handleChange}
              required
              className="w-full px-4 py-3 rounded-lg bg-[#12111f] border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 transition"
              placeholder="Ex: BRATECC Business Summit 2026"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Data Início *</label>
              <input
                name="dataInicio"
                type="datetime-local"
                value={form.dataInicio}
                onChange={handleChange}
                required
                className="w-full px-4 py-3 rounded-lg bg-[#12111f] border border-white/10 text-white focus:outline-none focus:ring-2 focus:ring-purple-500 transition"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Data Fim *</label>
              <input
                name="dataFim"
                type="datetime-local"
                value={form.dataFim}
                onChange={handleChange}
                required
                className="w-full px-4 py-3 rounded-lg bg-[#12111f] border border-white/10 text-white focus:outline-none focus:ring-2 focus:ring-purple-500 transition"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Local *</label>
              <input
                name="local"
                value={form.local}
                onChange={handleChange}
                required
                className="w-full px-4 py-3 rounded-lg bg-[#12111f] border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 transition"
                placeholder="Ex: Houston, TX - Convention Center"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">WhatsApp do Evento *</label>
              <input
                name="whatsapp"
                value={form.whatsapp}
                onChange={handleChange}
                required
                className="w-full px-4 py-3 rounded-lg bg-[#12111f] border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 transition"
                placeholder="+5511999999999"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Descrição</label>
            <textarea
              name="descricao"
              value={form.descricao}
              onChange={handleChange}
              rows={4}
              className="w-full px-4 py-3 rounded-lg bg-[#12111f] border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 transition resize-none"
              placeholder="Descreva o evento, objetivos, público-alvo..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-3">Categorias do Evento</label>
            <div className="flex flex-wrap gap-2">
              {categoriasOptions.map(cat => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => toggleCategoria(cat)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                    form.categorias.includes(cat)
                      ? 'bg-purple-600 text-white'
                      : 'bg-[#12111f] border border-white/10 text-gray-400 hover:border-purple-500/30'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-4 pt-4">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-3 px-6 bg-gradient-to-r from-purple-600 to-pink-600 rounded-lg font-semibold text-white hover:from-purple-700 hover:to-pink-700 transition disabled:opacity-50"
            >
              {loading ? 'Criando...' : 'Criar Evento'}
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

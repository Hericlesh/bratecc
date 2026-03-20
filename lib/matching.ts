import { prisma } from './db'
import { sendEmail, emailTemplates } from './email'
import { sendWhatsApp, whatsappTemplates } from './whatsapp'

// Algoritmo de Matching com IA
export async function generateMatches(empresaId?: string) {
  try {
    // Buscar empresas e associados
    const empresas = empresaId 
      ? [await prisma.empresa.findUnique({ where: { id: empresaId } })]
      : await prisma.empresa.findMany()
    
    const associados = await prisma.associado.findMany({
      include: {
        produtos: true
      }
    })

    const newMatches = []

    for (const empresa of empresas) {
      if (!empresa) continue

      for (const associado of associados) {
        // Calcular score de compatibilidade
        const score = calculateCompatibilityScore(
          empresa.necessidades,
          empresa.setor,
          associado.servicos,
          associado.segmento,
          associado.produtos
        )

        // Só criar match se score >= 70%
        if (score >= 70) {
          // Verificar se match já existe
          const existingMatch = await prisma.match.findFirst({
            where: {
              empresaId: empresa.id,
              associadoId: associado.id,
            }
          })

          if (!existingMatch) {
            // Determinar status baseado no score
            const status = score >= 90 ? 'CONFIRMED' : score >= 80 ? 'INTERESTED' : 'CONTACTED'

            const match = await prisma.match.create({
              data: {
                empresaId: empresa.id,
                associadoId: associado.id,
                score,
                status,
                empresaNeed: empresa.necessidades,
                associadoService: associado.servicos,
              }
            })

            newMatches.push(match)

            // Enviar notificação por email
            if (score >= 85) {
              await sendEmail({
                to: associado.email,
                subject: `🎯 Novo Match de ${score}% - ${empresa.name}`,
                html: emailTemplates.matchNotification(empresa.name, associado.name, score)
              })

              // Enviar WhatsApp se tiver número
              if (associado.whatsapp) {
                await sendWhatsApp({
                  to: associado.whatsapp,
                  message: whatsappTemplates.matchNotification(empresa.name, associado.name, score)
                })
              }
            }
          }
        }
      }
    }

    return {
      success: true,
      matchesCreated: newMatches.length,
      matches: newMatches
    }
  } catch (error) {
    console.error('Generate matches error:', error)
    return { success: false, error }
  }
}

// Algoritmo de cálculo de compatibilidade
function calculateCompatibilityScore(
  empresaNecessidades: string,
  empresaSetor: string,
  associadoServicos: string,
  associadoSegmento: string,
  produtos: any[]
): number {
  let score = 0

  // Converter para lowercase para comparação
  const need = empresaNecessidades.toLowerCase()
  const service = associadoServicos.toLowerCase()
  const setor = empresaSetor.toLowerCase()
  const segmento = associadoSegmento.toLowerCase()

  // Keywords por categoria (dicionário de termos)
  const keywords = {
    financial: ['financ', 'crédito', 'credit', 'trade finance', 'câmbio', 'fx', 'pagamento', 'payment'],
    logistics: ['logística', 'logistics', 'transporte', 'transport', 'desembaraço', 'customs', 'clearance', 'aduaneiro', 'freight'],
    legal: ['legal', 'jurídico', 'compliance', 'regulatório', 'regulatory', 'certificação', 'certification'],
    technology: ['tecnologia', 'technology', 'software', 'ti', 'it', 'digital', 'tech', 'sistema'],
    consulting: ['consultoria', 'consulting', 'advisory', 'assessoria', 'suporte', 'support'],
  }

  // 1. Match direto de palavras-chave (50 pontos)
  let keywordMatches = 0
  for (const [category, words] of Object.entries(keywords)) {
    for (const word of words) {
      if (need.includes(word) && service.includes(word)) {
        keywordMatches += 10
      }
    }
  }
  score += Math.min(keywordMatches, 50)

  // 2. Match de setor/segmento (30 pontos)
  if (setor === segmento) {
    score += 30
  } else {
    // Setores complementares
    const complementary = {
      'energy': ['logistics', 'financial', 'legal'],
      'technology': ['financial', 'legal', 'consulting'],
      'food': ['logistics', 'legal', 'financial'],
    }
    if (complementary[setor]?.includes(segmento)) {
      score += 20
    }
  }

  // 3. Análise de produtos específicos (20 pontos)
  if (produtos && produtos.length > 0) {
    for (const produto of produtos) {
      const prodDesc = produto.descricao.toLowerCase()
      let matches = 0
      for (const [_, words] of Object.entries(keywords)) {
        for (const word of words) {
          if (need.includes(word) && prodDesc.includes(word)) {
            matches++
          }
        }
      }
      if (matches > 0) score += Math.min(matches * 5, 20)
    }
  }

  // Garantir que score está entre 0-100
  return Math.min(Math.max(score, 0), 100)
}

// Gerar matches B2B (entre associados)
export async function generateB2BMatches() {
  try {
    const associados = await prisma.associado.findMany({
      include: {
        produtos: true
      }
    })

    const b2bOpportunities = []

    for (let i = 0; i < associados.length; i++) {
      for (let j = i + 1; j < associados.length; j++) {
        const a1 = associados[i]
        const a2 = associados[j]

        // Calcular sinergia entre associados
        const synergyScore = calculateSynergyScore(a1, a2)

        if (synergyScore >= 80) {
          b2bOpportunities.push({
            associado1: a1.name,
            associado2: a2.name,
            score: synergyScore,
            synergy: describeSynergy(a1, a2)
          })
        }
      }
    }

    return {
      success: true,
      opportunities: b2bOpportunities
    }
  } catch (error) {
    return { success: false, error }
  }
}

// Calcular sinergia entre dois associados
function calculateSynergyScore(a1: any, a2: any): number {
  let score = 0

  // Verificar complementaridade
  const complementary = {
    'Financial': ['Logistics', 'Technology', 'Legal'],
    'Logistics': ['Financial', 'Technology'],
    'Legal': ['Financial', 'Technology'],
    'Technology': ['Financial', 'Logistics', 'Legal'],
  }

  if (complementary[a1.segmento]?.includes(a2.segmento)) {
    score += 50
  }

  // Verificar busca de parcerias nos produtos
  if (a1.produtos && a2.produtos) {
    for (const p1 of a1.produtos) {
      for (const p2 of a2.produtos) {
        if (p1.buscaParceria?.includes(p2.categoria)) {
          score += 25
        }
        if (p2.buscaParceria?.includes(p1.categoria)) {
          score += 25
        }
      }
    }
  }

  return Math.min(score, 100)
}

function describeSynergy(a1: any, a2: any): string {
  return `${a1.segmento} + ${a2.segmento} = Solução completa para clientes`
}

// Atualizar status de match
export async function updateMatchStatus(matchId: string, newStatus: string) {
  try {
    const match = await prisma.match.update({
      where: { id: matchId },
      data: { status: newStatus as any },
      include: {
        empresa: true,
        associado: true,
      }
    })

    // Enviar notificação de mudança de status
    if (newStatus === 'CONFIRMED') {
      await sendEmail({
        to: match.associado.email,
        subject: `✅ Match Confirmado - ${match.empresa.name}`,
        html: `Match confirmado com ${match.empresa.name}. Entre em contato: ${match.empresa.email}`
      })
    }

    return { success: true, match }
  } catch (error) {
    return { success: false, error }
  }
}

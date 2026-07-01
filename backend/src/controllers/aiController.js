// ═══════════════════════════════════════════════════════════
// Controller de Inteligência Artificial
// ═══════════════════════════════════════════════════════════

const prisma = require('../config/database');
const aiService = require('../services/aiService');

// ─── CLASSIFICAR EMPRESA ───
const classificarEmpresa = async (req, res) => {
  try {
    const { id } = req.params;

    const empresa = await prisma.empresa.findUnique({
      where: { id: parseInt(id) }
    });

    if (!empresa) {
      return res.status(404).json({ error: 'Empresa não encontrada' });
    }

    console.log(`🤖 Classificando empresa: ${empresa.nome}`);
    const classificacao = await aiService.classificarEmpresa(empresa);

    // Salvar classificação no banco (campo JSON)
    await prisma.empresa.update({
      where: { id: parseInt(id) },
      data: {
        classificacaoIA: classificacao
      }
    });

    // Log de atividade
    await prisma.activityLog.create({
      data: {
        userId: req.userId,
        action: 'AI_CLASSIFY',
        entity: 'Empresa',
        entityId: empresa.id,
        details: { classificacao }
      }
    });

    return res.json({
      empresa: empresa.nome,
      classificacao
    });
  } catch (error) {
    console.error('Erro ao classificar empresa:', error);
    return res.status(500).json({ error: 'Erro ao classificar empresa' });
  }
};

// ─── CLASSIFICAR ASSOCIADO ───
const classificarAssociado = async (req, res) => {
  try {
    const { id } = req.params;

    const associado = await prisma.associado.findUnique({
      where: { id: parseInt(id) }
    });

    if (!associado) {
      return res.status(404).json({ error: 'Associado não encontrado' });
    }

    console.log(`🤖 Classificando associado: ${associado.nome}`);
    const classificacao = await aiService.classificarAssociado(associado);

    // Salvar classificação no banco
    await prisma.associado.update({
      where: { id: parseInt(id) },
      data: {
        classificacaoIA: classificacao
      }
    });

    // Log de atividade
    await prisma.activityLog.create({
      data: {
        userId: req.userId,
        action: 'AI_CLASSIFY',
        entity: 'Associado',
        entityId: associado.id,
        details: { classificacao }
      }
    });

    return res.json({
      associado: associado.nome,
      classificacao
    });
  } catch (error) {
    console.error('Erro ao classificar associado:', error);
    return res.status(500).json({ error: 'Erro ao classificar associado' });
  }
};

// ─── GERAR MATCHES INTELIGENTES PARA EMPRESA ───
const gerarMatchesInteligentes = async (req, res) => {
  try {
    const { empresaId } = req.params;
    const { eventoId } = req.query;

    const empresa = await prisma.empresa.findUnique({
      where: { id: parseInt(empresaId) }
    });

    if (!empresa) {
      return res.status(404).json({ error: 'Empresa não encontrada' });
    }

    // Empresa restrita a evento não participa de matches globais
    if (empresa.eventoOrigemId && !eventoId) {
      return res.status(400).json({
        error: 'Empresa restrita a evento. Use a tela Eventos × Assoc × Empresa ou informe ?eventoId=X.'
      });
    }

    // Buscar associados ativos
    const associados = await prisma.associado.findMany({
      where: { ativo: true }
    });

    // Buscar evento se informado
    let evento = null;
    if (eventoId) {
      evento = await prisma.evento.findUnique({
        where: { id: parseInt(eventoId) }
      });
    }

    console.log(`🤖 Gerando matches inteligentes para: ${empresa.nome}`);
    const resultado = await aiService.gerarMatchInteligente(empresa, associados, evento);

    if (!resultado.matches || resultado.matches.length === 0) {
      return res.json({
        message: 'Nenhum match relevante encontrado',
        matches: [],
        insights: resultado.insights
      });
    }

    // Criar matches no banco
    const matchesCriados = [];
    let preservados = 0;
    
    for (const match of resultado.matches) {
      try {
        // Verificar se já existe — se sim, PULA totalmente.
        // Regra v15: uma vez que um par (empresa, associado) já está no banco,
        // não regenera (independente do status). Isso impede que clicar em
        // "Gerar Matches" novamente reabra a conversa de WhatsApp.
        const existente = await prisma.match.findUnique({
          where: {
            empresaId_associadoId: {
              empresaId: parseInt(empresaId),
              associadoId: match.associado_id
            }
          }
        });

        if (existente) {
          preservados++;
          console.log(`⏭️  Match #${existente.id} (empresa ${empresaId} × associado ${match.associado_id}) preservado: status=${existente.status} (anti-duplicação)`);
          continue;
        }

        // Calcular prioridade
        const prioridade = aiService.calcularPrioridade(match.score, match.analise);

        const novoMatch = await prisma.match.create({
          data: {
            empresaId: parseInt(empresaId),
            associadoId: match.associado_id,
            score: match.score,
            produto: match.servico_relevante,
            observacoes: match.oportunidade,
            status: 'PENDING',
            prioridade: prioridade.nivel,
            analiseIA: match
          },
          include: { associado: true, empresa: true }
        });

        matchesCriados.push({
          ...novoMatch,
          prioridadeInfo: prioridade
        });
      } catch (err) {
        console.error(`Erro ao criar match com associado ${match.associado_id}:`, err);
      }
    }

    // Log de atividade
    await prisma.activityLog.create({
      data: {
        userId: req.userId,
        action: 'AI_GENERATE_MATCHES',
        entity: 'Empresa',
        entityId: parseInt(empresaId),
        details: {
          empresa: empresa.nome,
          matchesGerados: matchesCriados.length,
          matchesPreservados: preservados,
          eventoId: eventoId || null
        }
      }
    });

    // Agrupar por prioridade
    const porPrioridade = {
      alta: matchesCriados.filter(m => m.prioridade === 'alta' || m.prioridadeInfo?.nivel === 'alta'),
      media: matchesCriados.filter(m => m.prioridade === 'media' || m.prioridadeInfo?.nivel === 'media'),
      baixa: matchesCriados.filter(m => m.prioridade === 'baixa' || m.prioridadeInfo?.nivel === 'baixa')
    };

    return res.json({
      empresa: empresa.nome,
      totalMatches: matchesCriados.length,
      preservados,
      resumo: {
        '🔥 Alta prioridade': porPrioridade.alta.length,
        '⚡ Média prioridade': porPrioridade.media.length,
        '❄️ Baixa prioridade': porPrioridade.baixa.length
      },
      matches: matchesCriados,
      insights: resultado.insights
    });
  } catch (error) {
    console.error('Erro ao gerar matches inteligentes:', error);
    return res.status(500).json({ error: 'Erro ao gerar matches inteligentes' });
  }
};

// ─── GERAR MATCHES B2B ENTRE ASSOCIADOS ───
const gerarMatchesB2B = async (req, res) => {
  try {
    // Buscar todos os associados ativos
    const associados = await prisma.associado.findMany({
      where: { ativo: true }
    });

    if (associados.length < 2) {
      return res.status(400).json({ error: 'É necessário pelo menos 2 associados para gerar matches B2B' });
    }

    console.log(`🤖 Gerando matches B2B entre ${associados.length} associados`);
    const resultado = await aiService.gerarMatchB2B(associados);

    if (!resultado.sinergias || resultado.sinergias.length === 0) {
      return res.json({
        message: 'Nenhuma sinergia relevante encontrada',
        sinergias: [],
        clusters: resultado.clusters || []
      });
    }

    // Criar matches B2B no banco
    const sinergiasCriadas = [];

    for (const sinergia of resultado.sinergias) {
      try {
        // Normalizar par: sinergia é bidirecional, então sempre
        // gravamos com menor ID como origem. Isso impede duplicatas
        // (A, B) vs (B, A) — combinado com @@unique + CHECK no banco.
        let origemId = sinergia.associado_origem_id;
        let destinoId = sinergia.associado_destino_id;
        let servicoOrigem = sinergia.servico_origem;
        let servicoDestino = sinergia.servico_destino;

        if (origemId === destinoId) {
          // Auto-match não faz sentido, pular
          continue;
        }

        if (origemId > destinoId) {
          [origemId, destinoId] = [destinoId, origemId];
          [servicoOrigem, servicoDestino] = [servicoDestino, servicoOrigem];
        }

        // Verificar se já existe
        const existente = await prisma.matchB2B.findUnique({
          where: {
            associadoOrigem_associadoDestino: {
              associadoOrigem: origemId,
              associadoDestino: destinoId
            }
          }
        });

        if (existente) continue;

        const novoMatch = await prisma.matchB2B.create({
          data: {
            associadoOrigem: origemId,
            associadoDestino: destinoId,
            score: sinergia.score,
            servicoOrigem,
            servicoDestino,
            sinergia: sinergia.descricao,
            status: 'PENDING'
          },
          include: {
            origem: true,
            destino: true
          }
        });

        sinergiasCriadas.push({
          ...novoMatch,
          tipoSinergia: sinergia.tipo_sinergia,
          beneficioCliente: sinergia.beneficio_cliente,
          acaoRecomendada: sinergia.acao_recomendada
        });
      } catch (err) {
        console.error(`Erro ao criar match B2B:`, err);
      }
    }

    // Log de atividade
    await prisma.activityLog.create({
      data: {
        userId: req.userId,
        action: 'AI_GENERATE_B2B',
        entity: 'MatchB2B',
        details: {
          sinergiasCriadas: sinergiasCriadas.length,
          clusters: resultado.clusters?.length || 0
        }
      }
    });

    return res.json({
      totalSinergias: sinergiasCriadas.length,
      sinergias: sinergiasCriadas,
      clusters: resultado.clusters || []
    });
  } catch (error) {
    console.error('Erro ao gerar matches B2B:', error);
    return res.status(500).json({ error: 'Erro ao gerar matches B2B' });
  }
};

// ─── ANALISAR EVENTO ───
const analisarEvento = async (req, res) => {
  try {
    const { eventoId } = req.params;

    const evento = await prisma.evento.findUnique({
      where: { id: parseInt(eventoId) },
      include: {
        participantes: {
          include: { empresa: true }
        },
        associados: {
          include: { associado: true }
        }
      }
    });

    if (!evento) {
      return res.status(404).json({ error: 'Evento não encontrado' });
    }

    const participantes = evento.participantes.map(p => p.empresa);
    const associados = evento.associados.map(a => a.associado);

    if (participantes.length === 0 || associados.length === 0) {
      return res.status(400).json({ 
        error: 'O evento precisa ter pelo menos 1 participante e 1 associado para análise' 
      });
    }

    console.log(`🤖 Analisando evento: ${evento.nome}`);
    const analise = await aiService.analisarEvento(evento, participantes, associados);

    if (!analise) {
      return res.status(500).json({ error: 'Não foi possível analisar o evento' });
    }

    // Criar matches sugeridos (ou atualizar se já existirem e estiverem em PENDING)
    const matchesCriados = [];
    let preservados = 0;

    if (analise.matches_sugeridos) {
      for (const match of analise.matches_sugeridos) {
        try {
          // MatchEvento não tem @@unique no schema (entidade1Id/entidade2Id são INTs soltos),
          // então precisamos verificar existência manualmente para evitar duplicatas
          const existente = await prisma.matchEvento.findFirst({
            where: {
              eventoId: parseInt(eventoId),
              tipoMatch: 'EMPRESA_ASSOCIADO',
              entidade1Id: match.empresa_id,
              entidade2Id: match.associado_id
            }
          });

          if (existente) {
            // Regra v14.4: só atualiza se estiver em PENDING
            if (existente.status !== 'PENDING') {
              preservados++;
              console.log(`⏭️  MatchEvento ${existente.id} preservado: status=${existente.status}`);
              continue;
            }

            // Atualizar score se for maior
            if (match.score > existente.score) {
              const updated = await prisma.matchEvento.update({
                where: { id: existente.id },
                data: { score: match.score }
              });
              matchesCriados.push({
                ...updated,
                prioridade: match.prioridade,
                contextoEvento: match.contexto_evento,
                sugestaoAbordagem: match.sugestao_abordagem,
                atualizado: true
              });
            }
            continue;
          }

          const novoMatch = await prisma.matchEvento.create({
            data: {
              eventoId: parseInt(eventoId),
              tipoMatch: 'EMPRESA_ASSOCIADO',
              entidade1Id: match.empresa_id,
              entidade2Id: match.associado_id,
              score: match.score,
              status: 'PENDING'
            }
          });

          matchesCriados.push({
            ...novoMatch,
            prioridade: match.prioridade,
            contextoEvento: match.contexto_evento,
            sugestaoAbordagem: match.sugestao_abordagem
          });
        } catch (err) {
          console.error(`Erro ao processar MatchEvento para empresa ${match.empresa_id} × associado ${match.associado_id}:`, err.message);
        }
      }
    }

    // Log de atividade
    await prisma.activityLog.create({
      data: {
        userId: req.userId,
        action: 'AI_ANALYZE_EVENT',
        entity: 'Evento',
        entityId: parseInt(eventoId),
        details: {
          evento: evento.nome,
          matchesSugeridos: matchesCriados.length,
          matchesPreservados: preservados
        }
      }
    });

    return res.json({
      evento: evento.nome,
      analise: analise.analise_evento,
      matches: matchesCriados,
      matchesPreservados: preservados,
      agendaRecomendada: analise.agenda_recomendada || []
    });
  } catch (error) {
    console.error('Erro ao analisar evento:', error);
    return res.status(500).json({ error: 'Erro ao analisar evento' });
  }
};

// ─── GERAR RESUMO EXECUTIVO ───
const gerarResumoExecutivo = async (req, res) => {
  try {
    // Buscar dados gerais
    const [
      totalEmpresas,
      totalAssociados,
      totalMatches,
      matchesConfirmados,
      matchesPendentes,
      eventosAtivos
    ] = await Promise.all([
      prisma.empresa.count({ where: { ativo: true } }),
      prisma.associado.count({ where: { ativo: true } }),
      prisma.match.count(),
      prisma.match.count({ where: { status: 'CONFIRMED' } }),
      prisma.match.count({ where: { status: 'PENDING' } }),
      prisma.evento.count({ where: { status: 'ATIVO' } })
    ]);

    // Buscar matches recentes com detalhes
    const matchesRecentes = await prisma.match.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: {
        empresa: true,
        associado: true
      }
    });

    const dados = {
      metricas: {
        empresas: totalEmpresas,
        associados: totalAssociados,
        matches: {
          total: totalMatches,
          confirmados: matchesConfirmados,
          pendentes: matchesPendentes
        },
        eventosAtivos
      },
      matchesRecentes: matchesRecentes.map(m => ({
        empresa: m.empresa.nome,
        associado: m.associado.nome,
        score: m.score,
        status: m.status
      }))
    };

    console.log('🤖 Gerando resumo executivo');
    const resumo = await aiService.gerarResumoExecutivo(dados);

    return res.json({
      dados,
      resumoExecutivo: resumo
    });
  } catch (error) {
    console.error('Erro ao gerar resumo executivo:', error);
    return res.status(500).json({ error: 'Erro ao gerar resumo executivo' });
  }
};

// ─── CHAT COM IA ───
const chatIA = async (req, res) => {
  try {
    const { mensagem, contexto } = req.body;

    if (!mensagem) {
      return res.status(400).json({ error: 'Mensagem é obrigatória' });
    }

    // Buscar contexto do sistema
    const [empresas, associados, eventos, matches] = await Promise.all([
      prisma.empresa.count({ where: { ativo: true } }),
      prisma.associado.count({ where: { ativo: true } }),
      prisma.evento.count(),
      prisma.match.count()
    ]);

    const contextoSistema = `
Você é o assistente de IA do BRATECC Connect, um sistema de matchmaking B2B para comércio Brasil-Texas.

CONTEXTO ATUAL DO SISTEMA:
- ${empresas} empresas cadastradas
- ${associados} associados ativos
- ${eventos} eventos
- ${matches} matches realizados

Você pode ajudar com:
- Análise de oportunidades de negócio
- Sugestões de matches
- Insights sobre o mercado Brasil-Texas
- Orientações sobre comércio internacional

${contexto ? `CONTEXTO ADICIONAL: ${JSON.stringify(contexto)}` : ''}

Responda de forma profissional, objetiva e sempre em português brasileiro.`;

    const resposta = await aiService.callGemini(mensagem, contextoSistema);

    return res.json({
      resposta,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Erro no chat IA:', error);
    return res.status(500).json({ error: 'Erro ao processar mensagem' });
  }
};

// ─── RECALCULAR SCORES MANUALMENTE (ADMIN) ───
// POST /api/ai/recalcular-scores
// Body opcional: { empresaId } ou { associadoId } pra escopo limitado.
// Sem body: recalcula TODOS os matches PENDING (atenção: pode ser pesado).
const recalcularScores = async (req, res) => {
  try {
    const scoringService = require('../services/scoringService');
    const { empresaId, associadoId } = req.body || {};

    let result;
    if (empresaId) {
      result = await scoringService.atualizarScoresEmpresa(empresaId);
    } else if (associadoId) {
      result = await scoringService.atualizarScoresAssociado(associadoId);
    } else {
      result = await scoringService.atualizarTodosScoresPending();
    }

    return res.json({
      success: true,
      escopo: empresaId ? `empresa #${empresaId}` : associadoId ? `associado #${associadoId}` : 'todos os matches PENDING',
      ...result,
    });
  } catch (err) {
    console.error('Erro no recalculo manual de scores:', err);
    return res.status(500).json({ error: 'Erro ao recalcular scores', details: err.message });
  }
};

// ─── STATUS DO CRON DE SCORES (ADMIN) ───
const cronStatus = async (req, res) => {
  try {
    const { getCronStatus } = require('../services/scoringCron');
    return res.json(getCronStatus());
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

module.exports = {
  classificarEmpresa,
  classificarAssociado,
  gerarMatchesInteligentes,
  gerarMatchesB2B,
  analisarEvento,
  gerarResumoExecutivo,
  chatIA,
  recalcularScores,
  cronStatus
};

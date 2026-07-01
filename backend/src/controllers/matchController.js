// ═══════════════════════════════════════════════════════════
// Controller de Matches
// ═══════════════════════════════════════════════════════════

const prisma = require('../config/database');

// ─── LISTAR TODOS OS MATCHES ───
// Por padrão NÃO inclui matches de empresas restritas a eventos
// (empresa.eventoOrigemId !== null). Passe ?incluirRestritas=true
// se precisar de uma visão completa.
const getAll = async (req, res) => {
  try {
    const { status, associadoId, empresaId, incluirRestritas } = req.query;

    const where = {};

    if (status) where.status = status;
    if (associadoId) where.associadoId = parseInt(associadoId);
    if (empresaId) where.empresaId = parseInt(empresaId);

    // Excluir empresas restritas a eventos (inscritas via link público)
    if (String(incluirRestritas).toLowerCase() !== 'true') {
      where.empresa = { eventoOrigemId: null };
    }

    const matches = await prisma.match.findMany({
      where,
      include: {
        empresa: true,
        associado: true
      },
      orderBy: { score: 'desc' }
    });

    return res.json(matches);
  } catch (error) {
    console.error('Erro ao listar matches:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// ─── BUSCAR MATCH POR ID ───
const getById = async (req, res) => {
  try {
    const { id } = req.params;

    const match = await prisma.match.findUnique({
      where: { id: parseInt(id) },
      include: {
        empresa: true,
        associado: true
      }
    });

    if (!match) {
      return res.status(404).json({ error: 'Match não encontrado' });
    }

    return res.json(match);
  } catch (error) {
    console.error('Erro ao buscar match:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// ─── CRIAR MATCH MANUAL ───
// Regra v15 (anti-regeneração + score imutável):
//   • Se o par já existe com status != PENDING → retorna o match existente
//     sem modificar (match já tratado é imutável).
//   • Se já existe em PENDING → retorna o match SEM atualizar score/produto.
//     Score só pode ser alterado pelos fluxos dedicados de IA Gemini
//     (scoringService no backend, disparado por update/cron). Esse endpoint
//     NÃO deve sobrescrever score que veio do Gemini com cálculo local.
//   • Se não existe → cria novo PENDING. Score recebido só é aceito quando
//     for criação inicial (ex: vindo do gerarMatchesInteligentes).
const create = async (req, res) => {
  try {
    const { empresaId, associadoId, score, produto, observacoes, prioridade } = req.body;

    const parsedEmpresaId = parseInt(empresaId);
    const parsedAssociadoId = parseInt(associadoId);

    // 1. Verifica se já existe
    const existente = await prisma.match.findUnique({
      where: {
        empresaId_associadoId: {
          empresaId: parsedEmpresaId,
          associadoId: parsedAssociadoId,
        }
      },
      include: { empresa: true, associado: true },
    });

    if (existente) {
      // Match já tratado: imutável
      if (existente.status !== 'PENDING') {
        return res.status(200).json({
          ...existente,
          info: `Match já existe e está em ${existente.status} — preservado (anti-regeneração).`,
        });
      }

      // Match em PENDING: retorna sem modificar.
      // Score é IMUTÁVEL via esse endpoint — para atualizar score, use o
      // scoringService (chamado por: edição de empresa/associado, cron horário,
      // ou POST /api/ai/recalcular-scores).
      return res.status(200).json({
        ...existente,
        info: 'Match já existe em PENDING — score preservado. Use /api/ai/recalcular-scores para forçar recálculo via Gemini.',
      });
    }

    // 2. Não existe — criar novo.
    // SCORE: NÃO calculamos aqui. Score é responsabilidade dos jobs:
    //   • empresa/associado.create → dispara Gemini em background (cria scores
    //     com toda a contraparte, em todos os pares onde já existe match ou
    //     que serão criados depois)
    //   • cron horário → recalcula todos os matches PENDING
    //
    // Aqui o match é só REGISTRADO. Se score não veio no payload, persiste
    // o que tiver (0 se for primeira vez). Cron horário pega.
    //
    // Esse endpoint é chamado pelos botões "WhatsApp" das telas — eles só
    // estão registrando que a interação aconteceu, não gerando análise.
    const scoreInicial = (score != null && !isNaN(parseInt(score))) ? parseInt(score) : 0;

    const match = await prisma.match.create({
      data: {
        empresaId: parsedEmpresaId,
        associadoId: parsedAssociadoId,
        score: scoreInicial,
        produto,
        observacoes,
        prioridade: prioridade || (scoreInicial >= 85 ? 'alta' : scoreInicial >= 70 ? 'media' : 'baixa'),
        status: 'PENDING',
      },
      include: { empresa: true, associado: true },
    });

    // Log de atividade
    await prisma.activityLog.create({
      data: {
        userId: req.userId,
        action: 'CREATE',
        entity: 'Match',
        entityId: match.id,
        details: { 
          empresa: match.empresa.nome, 
          associado: match.associado.nome,
          score: match.score,
        },
      },
    });

    return res.status(201).json(match);
  } catch (error) {
    console.error('Erro ao criar match:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// ─── ATUALIZAR STATUS DO MATCH ───
const updateStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, observacoes } = req.body;

    const match = await prisma.match.findUnique({
      where: { id: parseInt(id) }
    });

    if (!match) {
      return res.status(404).json({ error: 'Match não encontrado' });
    }

    const updatedMatch = await prisma.match.update({
      where: { id: parseInt(id) },
      data: {
        status: status ?? match.status,
        observacoes: observacoes ?? match.observacoes
      },
      include: {
        empresa: true,
        associado: true
      }
    });

    // Log de atividade
    await prisma.activityLog.create({
      data: {
        userId: req.userId,
        action: 'UPDATE_STATUS',
        entity: 'Match',
        entityId: updatedMatch.id,
        details: { status: updatedMatch.status }
      }
    });

    return res.json(updatedMatch);
  } catch (error) {
    console.error('Erro ao atualizar match:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// ─── EXCLUIR MATCH ───
const remove = async (req, res) => {
  try {
    const { id } = req.params;

    const match = await prisma.match.findUnique({
      where: { id: parseInt(id) }
    });

    if (!match) {
      return res.status(404).json({ error: 'Match não encontrado' });
    }

    await prisma.match.delete({
      where: { id: parseInt(id) }
    });

    return res.json({ message: 'Match excluído com sucesso' });
  } catch (error) {
    console.error('Erro ao excluir match:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// ─── GERAR MATCHES AUTOMÁTICOS PARA UMA EMPRESA ───
const generateForEmpresa = async (req, res) => {
  try {
    const { empresaId } = req.params;

    const empresa = await prisma.empresa.findUnique({
      where: { id: parseInt(empresaId) }
    });

    if (!empresa) {
      return res.status(404).json({ error: 'Empresa não encontrada' });
    }

    // Empresa restrita a evento não deve entrar em matches globais
    if (empresa.eventoOrigemId) {
      return res.status(400).json({
        error: 'Esta empresa está vinculada exclusivamente a um evento. Matches devem ser gerados pela tela Eventos × Assoc × Empresa.'
      });
    }

    // Buscar todos os associados ativos
    const associados = await prisma.associado.findMany({
      where: { ativo: true }
    });

    const matchesGerados = [];

    for (const associado of associados) {
      // Verificar se match já existe
      const existingMatch = await prisma.match.findUnique({
        where: {
          empresaId_associadoId: {
            empresaId: parseInt(empresaId),
            associadoId: associado.id
          }
        }
      });

      if (existingMatch) continue;

      // Calcular score baseado em categorias e necessidades
      let score = 50; // Base score

      // Verificar se as categorias do associado batem com o setor da empresa
      const setorMatch = associado.categorias.some(cat => 
        cat.toLowerCase().includes(empresa.setor.toLowerCase()) ||
        empresa.setor.toLowerCase().includes(cat.toLowerCase())
      );
      if (setorMatch) score += 25;

      // Verificar se as necessidades da empresa mencionam serviços do associado
      if (empresa.necessidades && associado.servicos) {
        const necessidadesLower = empresa.necessidades.toLowerCase();
        const servicosLower = associado.servicos.toLowerCase();
        
        const keywords = ['finance', 'financi', 'logistic', 'logística', 'legal', 'compliance', 'tech', 'tecnolog'];
        for (const kw of keywords) {
          if (necessidadesLower.includes(kw) && servicosLower.includes(kw)) {
            score += 15;
            break;
          }
        }
      }

      // Adicionar variação aleatória pequena
      score += Math.floor(Math.random() * 10);
      score = Math.min(score, 98); // Max 98%

      // Criar match se score >= 60
      if (score >= 60) {
        const match = await prisma.match.create({
          data: {
            empresaId: parseInt(empresaId),
            associadoId: associado.id,
            score,
            produto: associado.servicos?.split(',')[0]?.trim() || 'Serviços',
            status: 'PENDING'
          },
          include: {
            empresa: true,
            associado: true
          }
        });

        matchesGerados.push(match);
      }
    }

    // Log de atividade
    await prisma.activityLog.create({
      data: {
        userId: req.userId,
        action: 'GENERATE_MATCHES',
        entity: 'Empresa',
        entityId: parseInt(empresaId),
        details: { 
          empresa: empresa.nome,
          matchesGerados: matchesGerados.length
        }
      }
    });

    return res.json({
      message: `${matchesGerados.length} matches gerados`,
      matches: matchesGerados
    });
  } catch (error) {
    console.error('Erro ao gerar matches:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// ─── ESTATÍSTICAS ───
const getStats = async (req, res) => {
  try {
    const total = await prisma.match.count();
    const porStatus = await prisma.match.groupBy({
      by: ['status'],
      _count: true
    });

    const avgScore = await prisma.match.aggregate({
      _avg: { score: true }
    });

    const confirmed = await prisma.match.count({ where: { status: 'CONFIRMED' } });
    const taxaConversao = total > 0 ? Math.round((confirmed / total) * 100) : 0;

    return res.json({
      total,
      porStatus,
      mediaScore: Math.round(avgScore._avg.score || 0),
      taxaConversao
    });
  } catch (error) {
    console.error('Erro ao buscar estatísticas:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

module.exports = { 
  getAll, 
  getById, 
  create, 
  updateStatus, 
  remove, 
  generateForEmpresa, 
  getStats 
};

// ═══════════════════════════════════════════════════════════
// VAGA CONTROLLER
// ═══════════════════════════════════════════════════════════
// CRUD de vagas. Associado só vê/edita as próprias vagas.
// Admin vê tudo.

const prisma = require('../config/database');

// Helper: descobre o ID do associado do usuário logado.
async function getAssociadoIdDoUsuario(req) {
  if (req.userRole === 'ADMIN') return null;
  if (req.userRole !== 'ASSOCIADO') return -1;
  const a = await prisma.associado.findUnique({ where: { userId: req.userId } });
  return a ? a.id : -1;
}

// ─── LISTAR ───
const getAll = async (req, res) => {
  try {
    const { search, aberta, associadoId, area, modalidade } = req.query;
    const where = {};

    const restricaoAssoc = await getAssociadoIdDoUsuario(req);
    if (restricaoAssoc === -1) {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    if (restricaoAssoc !== null) {
      where.associadoId = restricaoAssoc;
    } else if (associadoId) {
      where.associadoId = parseInt(associadoId);
    }

    if (aberta !== undefined) where.aberta = aberta === 'true';
    if (area) where.area = area;
    if (modalidade) where.modalidade = modalidade;
    if (search) {
      where.OR = [
        { titulo: { contains: search, mode: 'insensitive' } },
        { descricao: { contains: search, mode: 'insensitive' } },
        { area: { contains: search, mode: 'insensitive' } },
      ];
    }

    const vagas = await prisma.vaga.findMany({
      where,
      include: {
        associado: { select: { id: true, nome: true, segmento: true } },
        _count: { select: { matches: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.json(vagas);
  } catch (error) {
    console.error('Erro ao listar vagas:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// ─── BUSCAR POR ID ───
const getById = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const vaga = await prisma.vaga.findUnique({
      where: { id },
      include: {
        associado: true,
        matches: {
          include: { candidato: { include: { universidade: true } } },
          orderBy: { score: 'desc' },
        },
      },
    });

    if (!vaga) return res.status(404).json({ error: 'Vaga não encontrada' });

    const restricaoAssoc = await getAssociadoIdDoUsuario(req);
    if (restricaoAssoc === -1) return res.status(403).json({ error: 'Acesso negado' });
    if (restricaoAssoc !== null && vaga.associadoId !== restricaoAssoc) {
      return res.status(403).json({ error: 'Você não tem permissão para acessar esta vaga' });
    }

    return res.json(vaga);
  } catch (error) {
    console.error('Erro ao buscar vaga:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// ─── CRIAR ───
const create = async (req, res) => {
  try {
    const {
      associadoId, titulo, area, modalidade, local, descricao,
      requisitos, beneficios, salario, aberta,
    } = req.body;

    if (!titulo) return res.status(400).json({ error: 'Título é obrigatório' });

    let assocIdFinal = parseInt(associadoId);
    const restricaoAssoc = await getAssociadoIdDoUsuario(req);
    if (restricaoAssoc === -1) return res.status(403).json({ error: 'Acesso negado' });
    if (restricaoAssoc !== null) {
      assocIdFinal = restricaoAssoc;
    }

    if (!assocIdFinal || isNaN(assocIdFinal)) {
      return res.status(400).json({ error: 'associadoId é obrigatório' });
    }

    const assoc = await prisma.associado.findUnique({ where: { id: assocIdFinal } });
    if (!assoc) return res.status(404).json({ error: 'Associado não encontrado' });

    const vaga = await prisma.vaga.create({
      data: {
        associadoId: assocIdFinal,
        titulo: titulo.trim(),
        area: area?.trim() || null,
        modalidade: modalidade?.trim() || null,
        local: local?.trim() || null,
        descricao: descricao?.trim() || null,
        requisitos: requisitos?.trim() || null,
        beneficios: beneficios?.trim() || null,
        salario: salario?.trim() || null,
        aberta: aberta !== false,
      },
    });

    await prisma.activityLog.create({
      data: {
        action: 'CREATE_VAGA',
        entity: 'Vaga',
        entityId: vaga.id,
        userId: req.userId,
        details: { titulo: vaga.titulo, associado: assoc.nome },
      },
    }).catch(() => {});

    // ─── BACKGROUND: gerar matches Gemini com candidatos ativos ───
    (async () => {
      try {
        const candidatos = await prisma.candidato.findMany({ where: { ativo: true } });
        if (candidatos.length === 0) return;
        const matchVagaService = require('../services/matchVagaService');

        let criados = 0, falhas = 0;
        for (const cand of candidatos) {
          const existe = await prisma.matchVaga.findUnique({
            where: { candidatoId_vagaId: { candidatoId: cand.id, vagaId: vaga.id } },
          });
          if (existe) continue;

          const score = await matchVagaService.recalcularScorePar(cand, vaga);
          if (!score) { falhas++; continue; }

          try {
            await prisma.matchVaga.create({
              data: {
                candidatoId: cand.id,
                vagaId: vaga.id,
                score: score.score,
                observacoes: score.oportunidade,
                status: 'PENDING',
                analiseIA: { justificativa: score.justificativa, geradoEm: new Date().toISOString() },
              },
            });
            criados++;
          } catch (e) { falhas++; }
        }
        console.log(`✨ MatchVagas Gemini gerados para vaga nova "${vaga.titulo}": ${criados} criados, ${falhas} falhas, total avaliado=${candidatos.length}`);
      } catch (err) {
        console.warn(`⚠️ Geração MatchVaga falhou para vaga #${vaga.id}: ${err.message}`);
      }
    })();

    return res.status(201).json(vaga);
  } catch (error) {
    console.error('Erro ao criar vaga:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// ─── ATUALIZAR ───
const update = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const existente = await prisma.vaga.findUnique({ where: { id } });
    if (!existente) return res.status(404).json({ error: 'Vaga não encontrada' });

    const restricaoAssoc = await getAssociadoIdDoUsuario(req);
    if (restricaoAssoc === -1) return res.status(403).json({ error: 'Acesso negado' });
    if (restricaoAssoc !== null && existente.associadoId !== restricaoAssoc) {
      return res.status(403).json({ error: 'Você não tem permissão para editar esta vaga' });
    }

    const allowed = [
      'titulo', 'area', 'modalidade', 'local', 'descricao',
      'requisitos', 'beneficios', 'salario', 'aberta',
    ];
    const data = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) {
        if (typeof req.body[k] === 'string') data[k] = req.body[k].trim() || null;
        else data[k] = req.body[k];
      }
    }

    const updated = await prisma.vaga.update({ where: { id }, data });

    // Recalcula scores dos matches PENDING se mudou requisitos relevantes
    if (data.titulo || data.requisitos || data.descricao || data.area) {
      (async () => {
        try {
          const matchVagaService = require('../services/matchVagaService');
          await matchVagaService.atualizarScoresVaga(id);
        } catch (err) {
          console.warn(`⚠️ Falha ao recalcular scores da vaga #${id}:`, err.message);
        }
      })();
    }

    return res.json(updated);
  } catch (error) {
    console.error('Erro ao atualizar vaga:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// ─── REMOVER ───
const remove = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const existente = await prisma.vaga.findUnique({ where: { id } });
    if (!existente) return res.status(404).json({ error: 'Vaga não encontrada' });

    const restricaoAssoc = await getAssociadoIdDoUsuario(req);
    if (restricaoAssoc === -1) return res.status(403).json({ error: 'Acesso negado' });
    if (restricaoAssoc !== null && existente.associadoId !== restricaoAssoc) {
      return res.status(403).json({ error: 'Você não tem permissão para remover esta vaga' });
    }

    await prisma.vaga.delete({ where: { id } });
    return res.json({ success: true });
  } catch (error) {
    console.error('Erro ao remover vaga:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

module.exports = { getAll, getById, create, update, remove };

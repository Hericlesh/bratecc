// ═══════════════════════════════════════════════════════════
// MATCH VAGA CONTROLLER
// ═══════════════════════════════════════════════════════════
// Gerencia matches Candidato × Vaga.
// Endpoints:
//   GET    /match-vagas              — lista todos (admin) ou os relevantes ao usuário
//   POST   /match-vagas              — registra match manualmente (anti-duplicação)
//   PATCH  /match-vagas/:id          — atualiza status (PENDING → CONTACTED → INTERESTED → CONFIRMED/REJECTED)
//   POST   /match-vagas/gerar        — admin: dispara Gemini pra todos os pares
//   POST   /match-vagas/recalcular   — admin: recalcula scores Gemini

const prisma = require('../config/database');
const matchVagaService = require('../services/matchVagaService');

// ─── LISTAR ───
const getAll = async (req, res) => {
  try {
    const { status, candidatoId, vagaId } = req.query;
    const where = {};

    // Restrições por role
    if (req.userRole === 'ASSOCIADO') {
      const a = await prisma.associado.findUnique({ where: { userId: req.userId } });
      if (!a) return res.status(403).json({ error: 'Associado não encontrado' });
      where.vaga = { associadoId: a.id };
    } else if (req.userRole === 'UNIVERSIDADE') {
      const u = await prisma.universidade.findUnique({ where: { userId: req.userId } });
      if (!u) return res.status(403).json({ error: 'Universidade não encontrada' });
      where.candidato = { universidadeId: u.id };
    }
    // ADMIN vê tudo

    if (status) where.status = status;
    if (candidatoId) where.candidatoId = parseInt(candidatoId);
    if (vagaId) where.vagaId = parseInt(vagaId);

    const matches = await prisma.matchVaga.findMany({
      where,
      include: {
        candidato: {
          include: { universidade: { select: { id: true, nome: true, sigla: true } } },
        },
        vaga: {
          include: { associado: { select: { id: true, nome: true, segmento: true } } },
        },
      },
      orderBy: [{ status: 'asc' }, { score: 'desc' }],
    });

    return res.json(matches);
  } catch (error) {
    console.error('Erro ao listar match-vagas:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// ─── REGISTRAR (anti-duplicação) ───
const create = async (req, res) => {
  try {
    const { candidatoId, vagaId } = req.body;

    if (!candidatoId || !vagaId) {
      return res.status(400).json({ error: 'candidatoId e vagaId são obrigatórios' });
    }

    const cId = parseInt(candidatoId);
    const vId = parseInt(vagaId);

    // Anti-duplicação: se par já existe, retorna ele sem mexer no score
    const existente = await prisma.matchVaga.findUnique({
      where: { candidatoId_vagaId: { candidatoId: cId, vagaId: vId } },
      include: { candidato: true, vaga: true },
    });
    if (existente) {
      return res.json({ ...existente, _alreadyExisted: true });
    }

    // Cria com score 0; cron horário ou recalcular endpoint atualizam depois
    const match = await prisma.matchVaga.create({
      data: {
        candidatoId: cId,
        vagaId: vId,
        score: 0,
        status: 'PENDING',
      },
      include: { candidato: true, vaga: true },
    });

    return res.status(201).json(match);
  } catch (error) {
    console.error('Erro ao criar match-vaga:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// ─── ATUALIZAR STATUS ───
const updateStatus = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { status, observacoes } = req.body;

    const allowed = ['PENDING', 'CONTACTED', 'INTERESTED', 'CONFIRMED', 'REJECTED'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: 'Status inválido' });
    }

    const updated = await prisma.matchVaga.update({
      where: { id },
      data: { status, ...(observacoes !== undefined && { observacoes }) },
    });

    return res.json(updated);
  } catch (error) {
    console.error('Erro ao atualizar status:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// ─── GERAR MATCHES (todos os pares) ───
// Para cada candidato ativo × vaga aberta, calcula score Gemini e cria
// MatchVaga PENDING. Anti-duplicação preservada.
const gerar = async (req, res) => {
  try {
    const candidatos = await prisma.candidato.findMany({ where: { ativo: true } });
    const vagas = await prisma.vaga.findMany({ where: { aberta: true } });

    let criados = 0, preservados = 0, falhas = 0;
    for (const cand of candidatos) {
      for (const vaga of vagas) {
        const existe = await prisma.matchVaga.findUnique({
          where: { candidatoId_vagaId: { candidatoId: cand.id, vagaId: vaga.id } },
        });
        if (existe) { preservados++; continue; }

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
    }

    console.log(`✨ MatchVagas: ${criados} criados, ${preservados} preservados, ${falhas} falhas`);
    return res.json({ criados, preservados, falhas, total: candidatos.length * vagas.length });
  } catch (error) {
    console.error('Erro ao gerar match-vagas:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// ─── RECALCULAR TODOS OS SCORES (PENDING) ───
const recalcular = async (_req, res) => {
  try {
    const r = await matchVagaService.atualizarTodosScoresPending();
    return res.json(r);
  } catch (error) {
    console.error('Erro ao recalcular:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

module.exports = { getAll, create, updateStatus, gerar, recalcular };

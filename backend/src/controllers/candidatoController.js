// ═══════════════════════════════════════════════════════════
// CANDIDATO CONTROLLER
// ═══════════════════════════════════════════════════════════
// CRUD de candidatos. Universidade só vê/edita os próprios candidatos.
// Admin vê tudo.
//
// Endpoints:
//   GET    /candidatos              — admin: lista todos (com filtros)
//                                   — universidade: lista só os dela (filtra automaticamente)
//   GET    /candidatos/:id          — busca por ID (com checagem de ownership)
//   POST   /candidatos              — universidade ou admin cria
//   PUT    /candidatos/:id          — atualiza (com checagem de ownership)
//   DELETE /candidatos/:id          — remove (com checagem de ownership)

const prisma = require('../config/database');

// Helper: descobre o ID da universidade do usuário logado.
// Admin retorna null (vê tudo). Universidade retorna o id da entidade vinculada.
async function getUniversidadeIdDoUsuario(req) {
  if (req.userRole === 'ADMIN') return null;
  if (req.userRole !== 'UNIVERSIDADE') return -1; // bloqueia outros roles
  const u = await prisma.universidade.findUnique({ where: { userId: req.userId } });
  return u ? u.id : -1;
}

// ─── LISTAR ───
const getAll = async (req, res) => {
  try {
    const { search, ativo, universidadeId, disponibilidade } = req.query;
    const where = {};

    // Restrição por role
    const restricaoUniv = await getUniversidadeIdDoUsuario(req);
    if (restricaoUniv === -1) {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    if (restricaoUniv !== null) {
      // Universidade — só vê os próprios
      where.universidadeId = restricaoUniv;
    } else if (universidadeId) {
      // Admin pode filtrar por universidade
      where.universidadeId = parseInt(universidadeId);
    }

    if (ativo !== undefined) where.ativo = ativo === 'true';
    if (disponibilidade) where.disponibilidade = disponibilidade;
    if (search) {
      where.OR = [
        { nome: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { curso: { contains: search, mode: 'insensitive' } },
        { habilidades: { contains: search, mode: 'insensitive' } },
      ];
    }

    const candidatos = await prisma.candidato.findMany({
      where,
      include: {
        universidade: { select: { id: true, nome: true, sigla: true } },
        _count: { select: { matches: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.json(candidatos);
  } catch (error) {
    console.error('Erro ao listar candidatos:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// ─── BUSCAR POR ID ───
const getById = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const candidato = await prisma.candidato.findUnique({
      where: { id },
      include: {
        universidade: true,
        matches: {
          include: { vaga: { include: { associado: true } } },
          orderBy: { score: 'desc' },
        },
      },
    });

    if (!candidato) return res.status(404).json({ error: 'Candidato não encontrado' });

    // Ownership
    const restricaoUniv = await getUniversidadeIdDoUsuario(req);
    if (restricaoUniv === -1) return res.status(403).json({ error: 'Acesso negado' });
    if (restricaoUniv !== null && candidato.universidadeId !== restricaoUniv) {
      return res.status(403).json({ error: 'Você não tem permissão para acessar este candidato' });
    }

    return res.json(candidato);
  } catch (error) {
    console.error('Erro ao buscar candidato:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// ─── CRIAR ───
const create = async (req, res) => {
  try {
    const {
      universidadeId, nome, email, telefone, whatsapp, curso, periodo,
      habilidades, experiencias, curriculoUrl, disponibilidade, idiomas,
      cidade, estado,
    } = req.body;

    if (!nome) return res.status(400).json({ error: 'Nome é obrigatório' });

    // Universidade só pode criar pra si mesma
    let univIdFinal = parseInt(universidadeId);
    const restricaoUniv = await getUniversidadeIdDoUsuario(req);
    if (restricaoUniv === -1) return res.status(403).json({ error: 'Acesso negado' });
    if (restricaoUniv !== null) {
      univIdFinal = restricaoUniv;  // ignora o que veio no body — força a universidade dela
    }

    if (!univIdFinal || isNaN(univIdFinal)) {
      return res.status(400).json({ error: 'universidadeId é obrigatório' });
    }

    // Valida que a universidade existe
    const univ = await prisma.universidade.findUnique({ where: { id: univIdFinal } });
    if (!univ) return res.status(404).json({ error: 'Universidade não encontrada' });

    const candidato = await prisma.candidato.create({
      data: {
        universidadeId: univIdFinal,
        nome: nome.trim(),
        email: email?.toLowerCase().trim() || null,
        telefone: telefone?.trim() || null,
        whatsapp: whatsapp?.trim() || null,
        curso: curso?.trim() || null,
        periodo: periodo?.trim() || null,
        habilidades: habilidades?.trim() || null,
        experiencias: experiencias?.trim() || null,
        curriculoUrl: curriculoUrl?.trim() || null,
        disponibilidade: disponibilidade?.trim() || null,
        idiomas: idiomas?.trim() || null,
        cidade: cidade?.trim() || null,
        estado: estado?.trim() || null,
      },
    });

    await prisma.activityLog.create({
      data: {
        action: 'CREATE_CANDIDATO',
        entity: 'Candidato',
        entityId: candidato.id,
        userId: req.userId,
        details: { nome: candidato.nome, universidade: univ.nome },
      },
    }).catch(() => {});

    // ─── BACKGROUND: gerar matches Gemini com vagas abertas ───
    // Pra cada vaga aberta, calcula score Gemini e cria MatchVaga PENDING.
    (async () => {
      try {
        const vagas = await prisma.vaga.findMany({ where: { aberta: true } });
        if (vagas.length === 0) return;
        const matchVagaService = require('../services/matchVagaService');

        let criados = 0, falhas = 0;
        for (const vaga of vagas) {
          const existe = await prisma.matchVaga.findUnique({
            where: { candidatoId_vagaId: { candidatoId: candidato.id, vagaId: vaga.id } },
          });
          if (existe) continue;

          const score = await matchVagaService.recalcularScorePar(candidato, vaga);
          if (!score) { falhas++; continue; }

          try {
            await prisma.matchVaga.create({
              data: {
                candidatoId: candidato.id,
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
        console.log(`✨ MatchVagas Gemini gerados para candidato novo "${candidato.nome}": ${criados} criados, ${falhas} falhas, total avaliado=${vagas.length}`);
      } catch (err) {
        console.warn(`⚠️ Geração MatchVaga falhou para candidato #${candidato.id}: ${err.message}`);
      }
    })();

    return res.status(201).json(candidato);
  } catch (error) {
    console.error('Erro ao criar candidato:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// ─── ATUALIZAR ───
const update = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const existente = await prisma.candidato.findUnique({ where: { id } });
    if (!existente) return res.status(404).json({ error: 'Candidato não encontrado' });

    // Ownership
    const restricaoUniv = await getUniversidadeIdDoUsuario(req);
    if (restricaoUniv === -1) return res.status(403).json({ error: 'Acesso negado' });
    if (restricaoUniv !== null && existente.universidadeId !== restricaoUniv) {
      return res.status(403).json({ error: 'Você não tem permissão para editar este candidato' });
    }

    const allowed = [
      'nome', 'email', 'telefone', 'whatsapp', 'curso', 'periodo',
      'habilidades', 'experiencias', 'curriculoUrl', 'disponibilidade',
      'idiomas', 'cidade', 'estado', 'ativo',
    ];
    const data = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) {
        if (k === 'email' && req.body[k]) data[k] = req.body[k].toLowerCase().trim();
        else if (typeof req.body[k] === 'string') data[k] = req.body[k].trim() || null;
        else data[k] = req.body[k];
      }
    }

    const updated = await prisma.candidato.update({ where: { id }, data });

    // Recalcula scores dos matches existentes (em PENDING) com as vagas
    if (data.habilidades || data.experiencias || data.curso || data.disponibilidade) {
      (async () => {
        try {
          const matchVagaService = require('../services/matchVagaService');
          await matchVagaService.atualizarScoresCandidato(id);
        } catch (err) {
          console.warn(`⚠️ Falha ao recalcular scores do candidato #${id}:`, err.message);
        }
      })();
    }

    return res.json(updated);
  } catch (error) {
    console.error('Erro ao atualizar candidato:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// ─── REMOVER ───
const remove = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const existente = await prisma.candidato.findUnique({ where: { id } });
    if (!existente) return res.status(404).json({ error: 'Candidato não encontrado' });

    const restricaoUniv = await getUniversidadeIdDoUsuario(req);
    if (restricaoUniv === -1) return res.status(403).json({ error: 'Acesso negado' });
    if (restricaoUniv !== null && existente.universidadeId !== restricaoUniv) {
      return res.status(403).json({ error: 'Você não tem permissão para remover este candidato' });
    }

    await prisma.candidato.delete({ where: { id } });
    return res.json({ success: true });
  } catch (error) {
    console.error('Erro ao remover candidato:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

module.exports = { getAll, getById, create, update, remove };

// ═══════════════════════════════════════════════════════════
// Controller de Eventos
// ═══════════════════════════════════════════════════════════

const prisma = require('../config/database');

// ─── LISTAR TODOS OS EVENTOS ───
const getAll = async (req, res) => {
  try {
    const { status, search } = req.query;

    const where = {};

    if (status) where.status = status;

    if (search) {
      where.OR = [
        { nome: { contains: search, mode: 'insensitive' } },
        { local: { contains: search, mode: 'insensitive' } }
      ];
    }

    const eventos = await prisma.evento.findMany({
      where,
      include: {
        _count: {
          select: { 
            participantes: true,
            associados: true,
            matchesEvento: true
          }
        },
        participantes: {
          select: {
            empresaId: true,
            confirmado: true,
            createdAt: true,
          },
        },
      },
      orderBy: { data: 'desc' }
    });

    // Calcular taxa de match para cada evento. Mantemos a lista de participantes
    // (apenas IDs e status de confirmação) pra a UI saber rapidamente se uma
    // empresa está inscrita / confirmada sem ter que chamar getById de cada evento.
    const eventosComStats = eventos.map(evento => ({
      ...evento,
      participantesList: evento.participantes,  // [{ empresaId, confirmado, createdAt }, ...]
      participantes: evento._count.participantes, // contagem (mantém compatibilidade)
      associados: evento._count.associados,
      matches: evento._count.matchesEvento,
      taxaMatch: evento._count.participantes > 0 
        ? Math.round((evento._count.matchesEvento / evento._count.participantes) * 100) 
        : 0
    }));

    return res.json(eventosComStats);
  } catch (error) {
    console.error('Erro ao listar eventos:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// ─── BUSCAR EVENTO POR ID ───
const getById = async (req, res) => {
  try {
    const { id } = req.params;

    const evento = await prisma.evento.findUnique({
      where: { id: parseInt(id) },
      include: {
        participantes: {
          include: { empresa: true }
        },
        associados: {
          include: { associado: true }
        },
        matchesEvento: true
      }
    });

    if (!evento) {
      return res.status(404).json({ error: 'Evento não encontrado' });
    }

    return res.json(evento);
  } catch (error) {
    console.error('Erro ao buscar evento:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// ─── CRIAR EVENTO ───
const create = async (req, res) => {
  try {
    const { nome, local, data, dataFim, descricao, numeroWhatsapp, status, categorias } = req.body;

    // Gera slug de inscrição público (link que pode ser compartilhado)
    const { gerarSlugUnico } = require('../services/inscricaoService');
    const inscricaoSlug = await gerarSlugUnico();

    const evento = await prisma.evento.create({
      data: {
        nome,
        local,
        data: new Date(data),
        dataFim: dataFim ? new Date(dataFim) : null,
        descricao,
        numeroWhatsapp,
        status: status || 'PLANEJADO',
        categorias: categorias || [],
        inscricaoSlug,
        inscricaoAtiva: true
      }
    });

    // Log de atividade
    await prisma.activityLog.create({
      data: {
        userId: req.userId,
        action: 'CREATE',
        entity: 'Evento',
        entityId: evento.id,
        details: { nome: evento.nome, inscricaoSlug }
      }
    });

    return res.status(201).json(evento);
  } catch (error) {
    console.error('Erro ao criar evento:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// ─── ATUALIZAR EVENTO ───
const update = async (req, res) => {
  try {
    const { id } = req.params;
    const { nome, local, data, dataFim, descricao, numeroWhatsapp, status, categorias } = req.body;

    const evento = await prisma.evento.findUnique({
      where: { id: parseInt(id) }
    });

    if (!evento) {
      return res.status(404).json({ error: 'Evento não encontrado' });
    }

    const updatedEvento = await prisma.evento.update({
      where: { id: parseInt(id) },
      data: {
        nome: nome ?? evento.nome,
        local: local ?? evento.local,
        data: data ? new Date(data) : evento.data,
        dataFim: dataFim ? new Date(dataFim) : evento.dataFim,
        descricao: descricao ?? evento.descricao,
        numeroWhatsapp: numeroWhatsapp ?? evento.numeroWhatsapp,
        status: status ?? evento.status,
        categorias: categorias ?? evento.categorias
      }
    });

    // Log de atividade
    await prisma.activityLog.create({
      data: {
        userId: req.userId,
        action: 'UPDATE',
        entity: 'Evento',
        entityId: updatedEvento.id,
        details: { nome: updatedEvento.nome }
      }
    });

    return res.json(updatedEvento);
  } catch (error) {
    console.error('Erro ao atualizar evento:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// ─── ALTERNAR STATUS DO EVENTO (PLANEJADO ↔ ATIVO) ───
// Obs: eventos em FINALIZADO ou CANCELADO são estados terminais
// e não podem ser re-abertos via toggle. Use PUT /eventos/:id para mudar.
const toggleStatus = async (req, res) => {
  try {
    const { id } = req.params;

    const evento = await prisma.evento.findUnique({
      where: { id: parseInt(id) }
    });

    if (!evento) {
      return res.status(404).json({ error: 'Evento não encontrado' });
    }

    // Estados terminais não podem ser re-abertos por toggle
    if (evento.status === 'FINALIZADO' || evento.status === 'CANCELADO') {
      return res.status(400).json({
        error: `Evento em estado terminal (${evento.status}). Use PUT para reativar.`
      });
    }

    const newStatus = evento.status === 'ATIVO' ? 'PLANEJADO' : 'ATIVO';

    const updatedEvento = await prisma.evento.update({
      where: { id: parseInt(id) },
      data: { status: newStatus },
      include: {
        _count: {
          select: { participantes: true, associados: true, matchesEvento: true }
        }
      }
    });

    // Log de atividade
    await prisma.activityLog.create({
      data: {
        userId: req.userId,
        action: 'TOGGLE_STATUS',
        entity: 'Evento',
        entityId: updatedEvento.id,
        details: { nome: updatedEvento.nome, from: evento.status, to: newStatus }
      }
    });

    return res.json(updatedEvento);
  } catch (error) {
    console.error('Erro ao alternar status:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// ─── EXCLUIR EVENTO ───
const remove = async (req, res) => {
  try {
    const { id } = req.params;

    const evento = await prisma.evento.findUnique({
      where: { id: parseInt(id) }
    });

    if (!evento) {
      return res.status(404).json({ error: 'Evento não encontrado' });
    }

    await prisma.evento.delete({
      where: { id: parseInt(id) }
    });

    // Log de atividade
    await prisma.activityLog.create({
      data: {
        userId: req.userId,
        action: 'DELETE',
        entity: 'Evento',
        entityId: parseInt(id),
        details: { nome: evento.nome }
      }
    });

    return res.json({ message: 'Evento excluído com sucesso' });
  } catch (error) {
    console.error('Erro ao excluir evento:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// ─── ADICIONAR PARTICIPANTE AO EVENTO ───
const addParticipante = async (req, res) => {
  try {
    const { id } = req.params;
    const { empresaId } = req.body;

    const participante = await prisma.eventoParticipante.create({
      data: {
        eventoId: parseInt(id),
        empresaId: parseInt(empresaId)
      },
      include: { empresa: true, evento: true }
    });

    // Log de atividade
    await prisma.activityLog.create({
      data: {
        userId: req.userId,
        action: 'ADD_PARTICIPANTE',
        entity: 'Evento',
        entityId: parseInt(id),
        details: {
          evento: participante.evento.nome,
          empresa: participante.empresa.nome
        }
      }
    });

    return res.status(201).json(participante);
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(400).json({ error: 'Empresa já é participante deste evento' });
    }
    console.error('Erro ao adicionar participante:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// ─── REMOVER PARTICIPANTE DO EVENTO ───
const removeParticipante = async (req, res) => {
  try {
    const { id, empresaId } = req.params;

    const participante = await prisma.eventoParticipante.findUnique({
      where: {
        eventoId_empresaId: {
          eventoId: parseInt(id),
          empresaId: parseInt(empresaId)
        }
      },
      include: { empresa: true, evento: true }
    });

    if (!participante) {
      return res.status(404).json({ error: 'Participante não encontrado neste evento' });
    }

    // Usar transaction: remover participante + matchesEvento relacionados à empresa
    await prisma.$transaction(async (tx) => {
      await tx.eventoParticipante.delete({
        where: { id: participante.id }
      });

      // Limpar matches deste evento que envolvem esta empresa
      // (MatchEvento não tem FK em entidade1Id/entidade2Id — precisa limpeza manual)
      await tx.matchEvento.deleteMany({
        where: {
          eventoId: parseInt(id),
          OR: [
            { tipoMatch: 'EMPRESA_ASSOCIADO', entidade1Id: parseInt(empresaId) },
            { tipoMatch: 'ASSOCIADO_EMPRESA', entidade2Id: parseInt(empresaId) },
            { tipoMatch: 'EMPRESA_EMPRESA', entidade1Id: parseInt(empresaId) },
            { tipoMatch: 'EMPRESA_EMPRESA', entidade2Id: parseInt(empresaId) }
          ]
        }
      });
    });

    await prisma.activityLog.create({
      data: {
        userId: req.userId,
        action: 'REMOVE_PARTICIPANTE',
        entity: 'Evento',
        entityId: parseInt(id),
        details: {
          evento: participante.evento.nome,
          empresa: participante.empresa.nome
        }
      }
    });

    return res.json({ message: 'Participante removido com sucesso' });
  } catch (error) {
    console.error('Erro ao remover participante:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// ─── ADICIONAR ASSOCIADO AO EVENTO ───
const addAssociado = async (req, res) => {
  try {
    const { id } = req.params;
    const { associadoId } = req.body;

    const eventoAssociado = await prisma.eventoAssociado.create({
      data: {
        eventoId: parseInt(id),
        associadoId: parseInt(associadoId)
      },
      include: { associado: true, evento: true }
    });

    // Log de atividade
    await prisma.activityLog.create({
      data: {
        userId: req.userId,
        action: 'ADD_ASSOCIADO_EVENTO',
        entity: 'Evento',
        entityId: parseInt(id),
        details: {
          evento: eventoAssociado.evento.nome,
          associado: eventoAssociado.associado.nome
        }
      }
    });

    return res.status(201).json(eventoAssociado);
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(400).json({ error: 'Associado já está vinculado a este evento' });
    }
    console.error('Erro ao adicionar associado:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// ─── REMOVER ASSOCIADO DO EVENTO ───
const removeAssociado = async (req, res) => {
  try {
    const { id, associadoId } = req.params;

    const eventoAssociado = await prisma.eventoAssociado.findUnique({
      where: {
        eventoId_associadoId: {
          eventoId: parseInt(id),
          associadoId: parseInt(associadoId)
        }
      },
      include: { associado: true, evento: true }
    });

    if (!eventoAssociado) {
      return res.status(404).json({ error: 'Associado não está vinculado a este evento' });
    }

    // Usar transaction: remover vínculo + matchesEvento relacionados ao associado
    await prisma.$transaction(async (tx) => {
      await tx.eventoAssociado.delete({
        where: { id: eventoAssociado.id }
      });

      await tx.matchEvento.deleteMany({
        where: {
          eventoId: parseInt(id),
          OR: [
            { tipoMatch: 'EMPRESA_ASSOCIADO', entidade2Id: parseInt(associadoId) },
            { tipoMatch: 'ASSOCIADO_EMPRESA', entidade1Id: parseInt(associadoId) }
          ]
        }
      });
    });

    await prisma.activityLog.create({
      data: {
        userId: req.userId,
        action: 'REMOVE_ASSOCIADO_EVENTO',
        entity: 'Evento',
        entityId: parseInt(id),
        details: {
          evento: eventoAssociado.evento.nome,
          associado: eventoAssociado.associado.nome
        }
      }
    });

    return res.json({ message: 'Associado removido do evento com sucesso' });
  } catch (error) {
    console.error('Erro ao remover associado do evento:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// ─── LISTAR MATCHES DO EVENTO (EMPRESA × ASSOCIADO) ───
// Retorna matches persistidos em MatchEvento, enriquecidos com dados das entidades.
// Como MatchEvento.entidade1Id/entidade2Id são INTs soltos (sem FK no schema),
// a resolução dos nomes/dados é feita manualmente aqui.
const getMatches = async (req, res) => {
  try {
    const { id } = req.params;
    const eventoId = parseInt(id);

    const evento = await prisma.evento.findUnique({
      where: { id: eventoId }
    });
    if (!evento) {
      return res.status(404).json({ error: 'Evento não encontrado' });
    }

    const matches = await prisma.matchEvento.findMany({
      where: {
        eventoId,
        tipoMatch: 'EMPRESA_ASSOCIADO'
      },
      orderBy: { score: 'desc' }
    });

    if (matches.length === 0) {
      return res.json({ evento: evento.nome, total: 0, matches: [] });
    }

    // Resolve empresas e associados em batch (mais eficiente que N queries)
    const empresaIds = [...new Set(matches.map(m => m.entidade1Id))];
    const associadoIds = [...new Set(matches.map(m => m.entidade2Id))];

    const [empresas, associados] = await Promise.all([
      prisma.empresa.findMany({ where: { id: { in: empresaIds } } }),
      prisma.associado.findMany({ where: { id: { in: associadoIds } } })
    ]);

    const empresasById = Object.fromEntries(empresas.map(e => [e.id, e]));
    const associadosById = Object.fromEntries(associados.map(a => [a.id, a]));

    const enriched = matches.map(m => ({
      id: m.id,
      eventoId: m.eventoId,
      empresaId: m.entidade1Id,
      associadoId: m.entidade2Id,
      score: m.score,
      status: m.status,
      createdAt: m.createdAt,
      empresa: empresasById[m.entidade1Id] || null,
      associado: associadosById[m.entidade2Id] || null,
    }));

    return res.json({
      evento: evento.nome,
      total: enriched.length,
      matches: enriched
    });
  } catch (error) {
    console.error('Erro ao listar matches do evento:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// ─── ATUALIZAR STATUS DE UM MATCH DO EVENTO ───
// PATCH /eventos/:id/matches/:matchId/status
// Body: { status: 'PENDING' | 'CONTACTED' | 'INTERESTED' | 'CONFIRMED' | 'REJECTED' }
const updateMatchStatus = async (req, res) => {
  try {
    const { id, matchId } = req.params;
    const { status } = req.body;

    const STATUS_VALIDOS = ['PENDING', 'CONTACTED', 'INTERESTED', 'CONFIRMED', 'REJECTED'];
    if (!status || !STATUS_VALIDOS.includes(status)) {
      return res.status(400).json({ error: `status deve ser um de: ${STATUS_VALIDOS.join(', ')}` });
    }

    const match = await prisma.matchEvento.findUnique({
      where: { id: parseInt(matchId) }
    });
    if (!match) {
      return res.status(404).json({ error: 'MatchEvento não encontrado' });
    }
    if (match.eventoId !== parseInt(id)) {
      return res.status(400).json({ error: 'Match não pertence a este evento' });
    }

    const updated = await prisma.matchEvento.update({
      where: { id: parseInt(matchId) },
      data: { status }
    });

    await prisma.activityLog.create({
      data: {
        userId: req.userId,
        action: 'UPDATE_MATCH_EVENTO_STATUS',
        entity: 'MatchEvento',
        entityId: updated.id,
        details: { eventoId: updated.eventoId, from: match.status, to: status }
      }
    });

    return res.json(updated);
  } catch (error) {
    console.error('Erro ao atualizar status do match de evento:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// ─── ESTATÍSTICAS ───
const getStats = async (req, res) => {
  try {
    const total = await prisma.evento.count();
    const ativos = await prisma.evento.count({ where: { status: 'ATIVO' } });
    const planejados = await prisma.evento.count({ where: { status: 'PLANEJADO' } });
    const finalizados = await prisma.evento.count({ where: { status: 'FINALIZADO' } });

    const totalParticipantes = await prisma.eventoParticipante.count();
    const totalMatches = await prisma.matchEvento.count();

    return res.json({
      total,
      ativos,
      planejados,
      finalizados,
      totalParticipantes,
      totalMatches
    });
  } catch (error) {
    console.error('Erro ao buscar estatísticas:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// ─── ATIVAR/DESATIVAR INSCRIÇÃO PÚBLICA ───
// PATCH /eventos/:id/inscricao  { ativa: true|false }
const toggleInscricao = async (req, res) => {
  try {
    const { id } = req.params;
    const { ativa } = req.body;

    if (typeof ativa !== 'boolean') {
      return res.status(400).json({ error: '`ativa` deve ser boolean' });
    }

    const evento = await prisma.evento.findUnique({ where: { id: parseInt(id) } });
    if (!evento) return res.status(404).json({ error: 'Evento não encontrado' });

    // Se ativando e evento não tem slug ainda (cadastro antigo), gera agora
    const { gerarSlugUnico } = require('../services/inscricaoService');
    const slug = evento.inscricaoSlug || await gerarSlugUnico();

    const updated = await prisma.evento.update({
      where: { id: parseInt(id) },
      data: {
        inscricaoAtiva: ativa,
        inscricaoSlug: slug
      }
    });

    await prisma.activityLog.create({
      data: {
        userId: req.userId,
        action: ativa ? 'OPEN_EVENT_REGISTRATION' : 'CLOSE_EVENT_REGISTRATION',
        entity: 'Evento',
        entityId: updated.id,
        details: { eventoNome: updated.nome }
      }
    }).catch(() => {});

    return res.json(updated);
  } catch (error) {
    console.error('Erro ao alternar inscrição:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// ─── REGENERAR SLUG (invalida link antigo) ───
// POST /eventos/:id/inscricao/regenerate
const regenerateInscricaoSlug = async (req, res) => {
  try {
    const { id } = req.params;
    const evento = await prisma.evento.findUnique({ where: { id: parseInt(id) } });
    if (!evento) return res.status(404).json({ error: 'Evento não encontrado' });

    const { gerarSlugUnico } = require('../services/inscricaoService');
    const novoSlug = await gerarSlugUnico();

    const updated = await prisma.evento.update({
      where: { id: parseInt(id) },
      data: { inscricaoSlug: novoSlug }
    });

    await prisma.activityLog.create({
      data: {
        userId: req.userId,
        action: 'REGENERATE_EVENT_REGISTRATION_SLUG',
        entity: 'Evento',
        entityId: updated.id,
        details: { eventoNome: updated.nome }
      }
    }).catch(() => {});

    return res.json({ inscricaoSlug: updated.inscricaoSlug });
  } catch (error) {
    console.error('Erro ao regenerar slug:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// ─── CONFIRMAR / DESCONFIRMAR PARTICIPAÇÃO ───
// PATCH /eventos/:id/participantes/:empresaId/confirmar
// Body: { confirmado: true | false }
// Marca a participação de uma empresa em um evento como confirmada ou pendente.
const toggleConfirmacaoParticipante = async (req, res) => {
  try {
    const { id, empresaId } = req.params;
    const { confirmado } = req.body;

    if (typeof confirmado !== 'boolean') {
      return res.status(400).json({ error: 'Campo "confirmado" deve ser true ou false' });
    }

    const participante = await prisma.eventoParticipante.findUnique({
      where: {
        eventoId_empresaId: {
          eventoId: parseInt(id),
          empresaId: parseInt(empresaId),
        },
      },
      include: { empresa: true, evento: true },
    });

    if (!participante) {
      return res.status(404).json({ error: 'Participante não encontrado neste evento' });
    }

    const atualizado = await prisma.eventoParticipante.update({
      where: { id: participante.id },
      data: { confirmado },
      include: { empresa: true, evento: true },
    });

    await prisma.activityLog.create({
      data: {
        userId: req.userId,
        action: confirmado ? 'CONFIRM_PARTICIPANTE' : 'UNCONFIRM_PARTICIPANTE',
        entity: 'EventoParticipante',
        entityId: participante.id,
        details: {
          evento: participante.evento.nome,
          empresa: participante.empresa.nome,
          confirmado,
        },
      },
    }).catch(() => {});

    return res.json(atualizado);
  } catch (error) {
    console.error('Erro ao alterar confirmação do participante:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

module.exports = {
  getAll,
  getById,
  create,
  update,
  toggleStatus,
  remove,
  addParticipante,
  removeParticipante,
  toggleConfirmacaoParticipante,
  addAssociado,
  removeAssociado,
  getMatches,
  updateMatchStatus,
  toggleInscricao,
  regenerateInscricaoSlug,
  getStats
};

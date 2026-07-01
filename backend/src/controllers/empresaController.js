// ═══════════════════════════════════════════════════════════
// Controller de Empresas
// ═══════════════════════════════════════════════════════════

const prisma = require('../config/database');

// ─── LISTAR TODAS AS EMPRESAS ───
// Por padrão retorna TODAS as empresas (inclusive as inscritas via link
// público de evento, com eventoOrigemId != null) — pra não quebrar telas como
// Gestão de Empresas e Eventos × Empresas que precisam delas.
//
// Telas que NÃO devem mostrar empresas restritas (ex: Assoc × Empresa) podem
// passar ?excluirRestritas=true e o backend filtra no SQL.
const getAll = async (req, res) => {
  try {
    const { setor, tipo, search, ativo, excluirRestritas } = req.query;

    const where = {};

    if (setor) where.setor = setor;
    if (tipo) where.tipo = tipo;
    if (ativo !== undefined) where.ativo = ativo === 'true';

    if (String(excluirRestritas).toLowerCase() === 'true') {
      where.eventoOrigemId = null;
    }

    if (search) {
      where.OR = [
        { nome: { contains: search, mode: 'insensitive' } },
        { cidade: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } }
      ];
    }

    const empresas = await prisma.empresa.findMany({
      where,
      include: {
        _count: {
          select: { matches: true, items: true }
        },
        items: {
          orderBy: { createdAt: 'asc' }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return res.json(empresas);
  } catch (error) {
    console.error('Erro ao listar empresas:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// ─── BUSCAR EMPRESA POR ID ───
const getById = async (req, res) => {
  try {
    const { id } = req.params;

    const empresa = await prisma.empresa.findUnique({
      where: { id: parseInt(id) },
      include: {
        matches: {
          include: { associado: true }
        },
        eventosParticipados: {
          include: { evento: true }
        },
        items: {
          orderBy: { createdAt: 'asc' }
        }
      }
    });

    if (!empresa) {
      return res.status(404).json({ error: 'Empresa não encontrada' });
    }

    return res.json(empresa);
  } catch (error) {
    console.error('Erro ao buscar empresa:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// ─── CRIAR EMPRESA ───
const create = async (req, res) => {
  try {
    const {
      nome, setor, porte, cidade, estado, tipo, email, telefone,
      descricao, necessidades, produtosOferecidos, produtosDemandados,
      items // opcional: array de { nome, tipo: 'OFERECIDO'|'DEMANDADO', ncmCodigo? }
    } = req.body;

    // Verificar se email já existe
    const existingEmpresa = await prisma.empresa.findUnique({
      where: { email: email.toLowerCase() }
    });

    if (existingEmpresa) {
      return res.status(400).json({ error: 'E-mail já cadastrado' });
    }

    // Validar items se fornecidos
    const itemsNormalizados = [];
    if (Array.isArray(items) && items.length > 0) {
      for (const it of items) {
        if (!it.nome || !String(it.nome).trim()) continue;
        const tipoUp = String(it.tipo || '').toUpperCase();
        if (!['OFERECIDO', 'DEMANDADO'].includes(tipoUp)) continue;
        itemsNormalizados.push({
          nome: String(it.nome).trim(),
          tipo: tipoUp,
          ncmCodigo: it.ncmCodigo ? String(it.ncmCodigo).replace(/\./g, '').trim() : null,
          ncmDescricao: it.ncmDescricao || null,
        });
      }
    }

    // Transaction: cria empresa + items atomicamente
    const empresa = await prisma.$transaction(async (tx) => {
      const novaEmpresa = await tx.empresa.create({
        data: {
          nome,
          setor,
          porte,
          cidade,
          estado,
          tipo,
          email: email.toLowerCase(),
          telefone,
          descricao,
          necessidades,
          produtosOferecidos,
          produtosDemandados,
          items: itemsNormalizados.length > 0 ? {
            create: itemsNormalizados
          } : undefined
        },
        include: {
          items: { orderBy: { createdAt: 'asc' } }
        }
      });
      return novaEmpresa;
    });

    // Log de atividade
    await prisma.activityLog.create({
      data: {
        userId: req.userId,
        action: 'CREATE',
        entity: 'Empresa',
        entityId: empresa.id,
        details: { nome: empresa.nome, items: itemsNormalizados.length }
      }
    });

    // Gerar matches Gemini em background para todos os associados ativos.
    // Par-a-par via recalcularScorePar — toda combinação ganha score (mesmo
    // baixo), nenhum par fica sem match no banco. Mesma estratégia do
    // associadoController.create pra consistência.
    //
    // Empresas restritas a evento (eventoOrigemId != null) NÃO geram matches
    // automáticos — elas só existem no contexto do evento que as originou.
    if (empresa.eventoOrigemId) {
      console.log(`📌 Empresa "${empresa.nome}" foi criada com eventoOrigemId=${empresa.eventoOrigemId} — pulando geração automática de matches.`);
      return res.status(201).json(empresa);
    }

    (async () => {
      try {
        const associados = await prisma.associado.findMany({ where: { ativo: true } });
        if (associados.length === 0) return;
        const scoringService = require('../services/scoringService');

        let criados = 0;
        let falhas = 0;
        for (const assoc of associados) {
          // Anti-duplicação: se par já tem match, não recria
          const existe = await prisma.match.findUnique({
            where: { empresaId_associadoId: { empresaId: empresa.id, associadoId: assoc.id } },
          });
          if (existe) continue;

          const score = await scoringService.recalcularScorePar(empresa, assoc);
          if (!score) { falhas++; continue; }

          const prioridade = score.score >= 80 ? 'alta' : score.score >= 60 ? 'media' : 'baixa';
          try {
            await prisma.match.create({
              data: {
                empresaId: empresa.id,
                associadoId: assoc.id,
                score: score.score,
                produto: score.produto,
                observacoes: score.oportunidade,
                status: 'PENDING',
                prioridade,
                analiseIA: { justificativa: score.justificativa, geradoEm: new Date().toISOString() },
              },
            });
            criados++;
          } catch (e) { falhas++; }
        }
        console.log(`✨ Matches Gemini gerados para empresa nova "${empresa.nome}": ${criados} criados, ${falhas} falhas, total avaliado=${associados.length}`);
      } catch (err) {
        console.warn(`⚠️ Geração automática de matches Gemini falhou para empresa #${empresa.id}: ${err.message}`);
      }
    })();

    return res.status(201).json(empresa);
  } catch (error) {
    console.error('Erro ao criar empresa:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// ─── CRIAR MÚLTIPLAS EMPRESAS (IMPORTAÇÃO) ───
const createMany = async (req, res) => {
  try {
    const { empresas } = req.body;

    if (!Array.isArray(empresas) || empresas.length === 0) {
      return res.status(400).json({ error: 'Lista de empresas é obrigatória' });
    }

    const results = {
      success: [],
      errors: []
    };

    for (const emp of empresas) {
      try {
        // Verificar se email já existe
        const existing = await prisma.empresa.findUnique({
          where: { email: emp.email.toLowerCase() }
        });

        if (existing) {
          results.errors.push({ email: emp.email, error: 'E-mail já cadastrado' });
          continue;
        }

        const empresa = await prisma.empresa.create({
          data: {
            nome: emp.nome,
            setor: emp.setor || 'Energy',
            porte: emp.porte || null,
            cidade: emp.cidade || '',
            estado: emp.estado || 'Texas',
            tipo: emp.tipo || 'EXPORTADOR',
            email: emp.email.toLowerCase(),
            telefone: emp.telefone,
            descricao: emp.descricao || emp.desc,
            necessidades: emp.necessidades,
            produtosOferecidos: emp.produtosOferecidos || null,
            produtosDemandados: emp.produtosDemandados || null
          }
        });

        results.success.push(empresa);
      } catch (err) {
        results.errors.push({ email: emp.email, error: err.message });
      }
    }

    // Log de atividade
    await prisma.activityLog.create({
      data: {
        userId: req.userId,
        action: 'IMPORT',
        entity: 'Empresa',
        details: { 
          total: empresas.length,
          success: results.success.length,
          errors: results.errors.length
        }
      }
    });

    return res.status(201).json({
      message: `${results.success.length} empresas importadas com sucesso`,
      ...results
    });
  } catch (error) {
    console.error('Erro ao importar empresas:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// ─── ATUALIZAR EMPRESA ───
const update = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      nome, setor, porte, cidade, estado, tipo, email, telefone,
      descricao, necessidades, produtosOferecidos, produtosDemandados, ativo
    } = req.body;

    const empresa = await prisma.empresa.findUnique({
      where: { id: parseInt(id) }
    });

    if (!empresa) {
      return res.status(404).json({ error: 'Empresa não encontrada' });
    }

    // Verificar se novo email já existe em outra empresa
    if (email && email.toLowerCase() !== empresa.email) {
      const existingEmpresa = await prisma.empresa.findUnique({
        where: { email: email.toLowerCase() }
      });

      if (existingEmpresa) {
        return res.status(400).json({ error: 'E-mail já cadastrado' });
      }
    }

    const updatedEmpresa = await prisma.empresa.update({
      where: { id: parseInt(id) },
      data: {
        nome: nome ?? empresa.nome,
        setor: setor ?? empresa.setor,
        porte: porte ?? empresa.porte,
        cidade: cidade ?? empresa.cidade,
        estado: estado ?? empresa.estado,
        tipo: tipo ?? empresa.tipo,
        email: email ? email.toLowerCase() : empresa.email,
        telefone: telefone ?? empresa.telefone,
        descricao: descricao ?? empresa.descricao,
        necessidades: necessidades ?? empresa.necessidades,
        produtosOferecidos: produtosOferecidos ?? empresa.produtosOferecidos,
        produtosDemandados: produtosDemandados ?? empresa.produtosDemandados,
        ativo: ativo ?? empresa.ativo
      }
    });

    // Log de atividade
    await prisma.activityLog.create({
      data: {
        userId: req.userId,
        action: 'UPDATE',
        entity: 'Empresa',
        entityId: updatedEmpresa.id,
        details: { nome: updatedEmpresa.nome }
      }
    });

    // Verifica se algum campo relevante para scoring mudou
    const camposScoring = ['setor', 'tipo', 'descricao', 'necessidades', 'produtosOferecidos', 'produtosDemandados'];
    const houveMudancaRelevante = camposScoring.some(c =>
      req.body[c] !== undefined && req.body[c] !== empresa[c]
    );

    // Dispara recalculo em background — não bloqueia a resposta.
    // Só matches PENDING são afetados (regra v15).
    if (houveMudancaRelevante) {
      const scoringService = require('../services/scoringService');
      scoringService.atualizarScoresEmpresa(updatedEmpresa.id)
        .catch(err => console.error(`❌ Recalculo de scores empresa #${updatedEmpresa.id} falhou:`, err.message));
    }

    return res.json(updatedEmpresa);
  } catch (error) {
    console.error('Erro ao atualizar empresa:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// ─── EXCLUIR EMPRESA ───
const remove = async (req, res) => {
  try {
    const { id } = req.params;

    const empresa = await prisma.empresa.findUnique({
      where: { id: parseInt(id) }
    });

    if (!empresa) {
      return res.status(404).json({ error: 'Empresa não encontrada' });
    }

    // Transaction: deletar empresa + limpar MatchEvento órfãos
    // (MatchEvento.entidade1Id/entidade2Id são INT soltos, não têm FK,
    //  então o Prisma não faz cascade automático — precisa limpeza manual)
    await prisma.$transaction(async (tx) => {
      await tx.matchEvento.deleteMany({
        where: {
          OR: [
            { tipoMatch: 'EMPRESA_ASSOCIADO', entidade1Id: parseInt(id) },
            { tipoMatch: 'ASSOCIADO_EMPRESA', entidade2Id: parseInt(id) },
            { tipoMatch: 'EMPRESA_EMPRESA', entidade1Id: parseInt(id) },
            { tipoMatch: 'EMPRESA_EMPRESA', entidade2Id: parseInt(id) }
          ]
        }
      });

      await tx.empresa.delete({
        where: { id: parseInt(id) }
      });
    });

    // Log de atividade
    await prisma.activityLog.create({
      data: {
        userId: req.userId,
        action: 'DELETE',
        entity: 'Empresa',
        entityId: parseInt(id),
        details: { nome: empresa.nome }
      }
    });

    return res.json({ message: 'Empresa excluída com sucesso' });
  } catch (error) {
    console.error('Erro ao excluir empresa:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// ─── ESTATÍSTICAS ───
const getStats = async (req, res) => {
  try {
    const total = await prisma.empresa.count();
    const porSetor = await prisma.empresa.groupBy({
      by: ['setor'],
      _count: true
    });
    const porTipo = await prisma.empresa.groupBy({
      by: ['tipo'],
      _count: true
    });

    return res.json({
      total,
      porSetor,
      porTipo
    });
  } catch (error) {
    console.error('Erro ao buscar estatísticas:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

module.exports = { getAll, getById, create, createMany, update, remove, getStats };

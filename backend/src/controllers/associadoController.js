// ═══════════════════════════════════════════════════════════
// Controller de Associados
// ═══════════════════════════════════════════════════════════

const bcrypt = require('bcryptjs');
const prisma = require('../config/database');

// ─── LISTAR TODOS OS ASSOCIADOS ───
const getAll = async (req, res) => {
  try {
    const { segmento, categoria, search, ativo } = req.query;

    const where = {};

    if (segmento) where.segmento = segmento;
    if (categoria) where.categorias = { has: categoria };
    if (ativo !== undefined) where.ativo = ativo === 'true';

    if (search) {
      where.OR = [
        { nome: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { servicos: { contains: search, mode: 'insensitive' } }
      ];
    }

    const associados = await prisma.associado.findMany({
      where,
      include: {
        _count: {
          select: {
            matches: true,
            matchesB2BOrigem: true,
            matchesB2BDestino: true,
            items: true
          }
        },
        items: {
          orderBy: { createdAt: 'asc' }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return res.json(associados);
  } catch (error) {
    console.error('Erro ao listar associados:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// ─── BUSCAR ASSOCIADO POR ID ───
const getById = async (req, res) => {
  try {
    const { id } = req.params;

    const associado = await prisma.associado.findUnique({
      where: { id: parseInt(id) },
      include: {
        matches: {
          include: { empresa: true }
        },
        matchesB2BOrigem: {
          include: { destino: true }
        },
        matchesB2BDestino: {
          include: { origem: true }
        },
        eventosParticipados: {
          include: { evento: true }
        },
        items: {
          orderBy: { createdAt: 'asc' }
        },
        user: {
          select: { id: true, email: true, role: true }
        }
      }
    });

    if (!associado) {
      return res.status(404).json({ error: 'Associado não encontrado' });
    }

    return res.json(associado);
  } catch (error) {
    console.error('Erro ao buscar associado:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// ─── CRIAR ASSOCIADO ───
const create = async (req, res) => {
  try {
    const {
      nome, tipoPessoa, segmento, porte, email, telefone, whatsapp, servicos,
      produtosOferecidos, produtosDemandados, descricao, categorias,
      criarUsuario, senha,
      items // opcional: array de { nome, tipo: 'OFERECIDO'|'DEMANDADO', ncmCodigo? }
    } = req.body;

    // Verificar se email já existe
    const existingAssociado = await prisma.associado.findUnique({
      where: { email: email.toLowerCase() }
    });

    if (existingAssociado) {
      return res.status(400).json({ error: 'E-mail já cadastrado' });
    }

    let userId = null;

    // Criar usuário se solicitado ou se senha foi fornecida
    if (criarUsuario || senha) {
      const existingUser = await prisma.user.findUnique({
        where: { email: email.toLowerCase() }
      });

      if (existingUser) {
        return res.status(400).json({ error: 'Já existe um usuário com este e-mail' });
      }

      const hashedSenha = await bcrypt.hash(senha || 'temp123', 10);

      const user = await prisma.user.create({
        data: {
          email: email.toLowerCase(),
          senha: hashedSenha,
          role: 'ASSOCIADO'
        }
      });

      userId = user.id;
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

    const associado = await prisma.associado.create({
      data: {
        nome,
        tipoPessoa: tipoPessoa || null,
        segmento,
        porte,
        email: email.toLowerCase(),
        telefone,
        whatsapp,
        servicos,
        produtosOferecidos,
        produtosDemandados,
        descricao,
        categorias: categorias || [],
        userId,
        items: itemsNormalizados.length > 0 ? {
          create: itemsNormalizados
        } : undefined
      },
      include: {
        items: { orderBy: { createdAt: 'asc' } }
      }
    });

    // Log de atividade
    await prisma.activityLog.create({
      data: {
        userId: req.userId,
        action: 'CREATE',
        entity: 'Associado',
        entityId: associado.id,
        details: { nome: associado.nome, items: itemsNormalizados.length }
      }
    });

    // Gerar matches Gemini em background para todas as empresas ativas.
    // Para um associado novo, calcula score Gemini de cada par (associado × empresa)
    // e cria/atualiza apenas os matches PENDING.
    //
    // IMPORTANTE: empresas com eventoOrigemId (inscritas via link público de evento)
    // são restritas ao contexto do evento — nunca entram em matches normais.
    (async () => {
      try {
        const empresas = await prisma.empresa.findMany({
          where: { ativo: true, eventoOrigemId: null },
        });
        if (empresas.length === 0) return;
        const scoringService = require('../services/scoringService');

        let criados = 0;
        let falhas = 0;
        for (const emp of empresas) {
          // Não cria se já existe (anti-duplicação)
          const existe = await prisma.match.findUnique({
            where: { empresaId_associadoId: { empresaId: emp.id, associadoId: associado.id } },
          });
          if (existe) continue;

          const score = await scoringService.recalcularScorePar(emp, associado);
          if (!score) { falhas++; continue; }

          const prioridade = score.score >= 80 ? 'alta' : score.score >= 60 ? 'media' : 'baixa';
          try {
            await prisma.match.create({
              data: {
                empresaId: emp.id,
                associadoId: associado.id,
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
        console.log(`✨ Matches Gemini gerados para associado novo "${associado.nome}": ${criados} criados, ${falhas} falhas, total avaliado=${empresas.length}`);
      } catch (err) {
        console.warn(`⚠️ Geração automática de matches Gemini falhou para associado #${associado.id}: ${err.message}`);
      }
    })();

    return res.status(201).json(associado);
  } catch (error) {
    console.error('Erro ao criar associado:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// ─── CRIAR MÚLTIPLOS ASSOCIADOS (IMPORTAÇÃO) ───
const createMany = async (req, res) => {
  try {
    const { associados } = req.body;

    if (!Array.isArray(associados) || associados.length === 0) {
      return res.status(400).json({ error: 'Lista de associados é obrigatória' });
    }

    const results = {
      success: [],
      errors: []
    };

    for (const assoc of associados) {
      try {
        if (!assoc.email) {
          results.errors.push({ email: null, error: 'E-mail é obrigatório' });
          continue;
        }

        const existing = await prisma.associado.findUnique({
          where: { email: assoc.email.toLowerCase() }
        });

        if (existing) {
          results.errors.push({ email: assoc.email, error: 'E-mail já cadastrado' });
          continue;
        }

        // Criar usuário vinculado se solicitado
        let userId = null;
        if (assoc.criarUsuario) {
          const existingUser = await prisma.user.findUnique({
            where: { email: assoc.email.toLowerCase() }
          });
          if (!existingUser) {
            const hashedSenha = await bcrypt.hash(assoc.senha || 'temp123', 10);
            const user = await prisma.user.create({
              data: {
                email: assoc.email.toLowerCase(),
                senha: hashedSenha,
                role: 'ASSOCIADO'
              }
            });
            userId = user.id;
          }
        }

        const associado = await prisma.associado.create({
          data: {
            nome: assoc.nome,
            segmento: assoc.segmento || 'Geral',
            porte: assoc.porte || null,
            email: assoc.email.toLowerCase(),
            telefone: assoc.telefone || null,
            whatsapp: assoc.whatsapp || null,
            servicos: assoc.servicos || null,
            produtosOferecidos: assoc.produtosOferecidos || null,
            produtosDemandados: assoc.produtosDemandados || null,
            descricao: assoc.descricao || null,
            categorias: assoc.categorias || [],
            userId
          }
        });

        results.success.push(associado);
      } catch (err) {
        results.errors.push({ email: assoc.email, error: err.message });
      }
    }

    // Log de atividade
    await prisma.activityLog.create({
      data: {
        userId: req.userId,
        action: 'IMPORT',
        entity: 'Associado',
        details: {
          total: associados.length,
          success: results.success.length,
          errors: results.errors.length
        }
      }
    });

    return res.status(201).json({
      message: `${results.success.length} associados importados com sucesso`,
      ...results
    });
  } catch (error) {
    console.error('Erro ao importar associados:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// ─── ATUALIZAR ASSOCIADO ───
const update = async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      nome, segmento, porte, email, telefone, whatsapp, servicos, 
      produtosOferecidos, produtosDemandados, descricao, categorias, ativo 
    } = req.body;

    const associado = await prisma.associado.findUnique({
      where: { id: parseInt(id) }
    });

    if (!associado) {
      return res.status(404).json({ error: 'Associado não encontrado' });
    }

    // Verificar se novo email já existe em outro associado
    if (email && email.toLowerCase() !== associado.email) {
      const existingAssociado = await prisma.associado.findUnique({
        where: { email: email.toLowerCase() }
      });

      if (existingAssociado) {
        return res.status(400).json({ error: 'E-mail já cadastrado' });
      }
    }

    const updatedAssociado = await prisma.associado.update({
      where: { id: parseInt(id) },
      data: {
        nome: nome ?? associado.nome,
        segmento: segmento ?? associado.segmento,
        porte: porte ?? associado.porte,
        email: email ? email.toLowerCase() : associado.email,
        telefone: telefone ?? associado.telefone,
        whatsapp: whatsapp ?? associado.whatsapp,
        servicos: servicos ?? associado.servicos,
        produtosOferecidos: produtosOferecidos ?? associado.produtosOferecidos,
        produtosDemandados: produtosDemandados ?? associado.produtosDemandados,
        descricao: descricao ?? associado.descricao,
        categorias: categorias ?? associado.categorias,
        ativo: ativo ?? associado.ativo
      }
    });

    // Log de atividade
    await prisma.activityLog.create({
      data: {
        userId: req.userId,
        action: 'UPDATE',
        entity: 'Associado',
        entityId: updatedAssociado.id,
        details: { nome: updatedAssociado.nome }
      }
    });

    // Verifica se algum campo relevante para scoring mudou
    const camposScoring = ['segmento', 'descricao', 'servicos', 'produtosOferecidos', 'produtosDemandados', 'categorias'];
    const houveMudancaRelevante = camposScoring.some(c => {
      if (req.body[c] === undefined) return false;
      if (Array.isArray(req.body[c]) && Array.isArray(associado[c])) {
        return JSON.stringify(req.body[c]) !== JSON.stringify(associado[c]);
      }
      return req.body[c] !== associado[c];
    });

    // Dispara recalculo em background — só matches PENDING (regra v15).
    if (houveMudancaRelevante) {
      const scoringService = require('../services/scoringService');
      scoringService.atualizarScoresAssociado(updatedAssociado.id)
        .catch(err => console.error(`❌ Recalculo de scores associado #${updatedAssociado.id} falhou:`, err.message));
    }

    return res.json(updatedAssociado);
  } catch (error) {
    console.error('Erro ao atualizar associado:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// ─── EXCLUIR ASSOCIADO ───
const remove = async (req, res) => {
  try {
    const { id } = req.params;

    const associado = await prisma.associado.findUnique({
      where: { id: parseInt(id) }
    });

    if (!associado) {
      return res.status(404).json({ error: 'Associado não encontrado' });
    }

    // Schema tem onDelete: SetNull em userId, então apagamos o associado PRIMEIRO
    // (libera a FK) e só depois apagamos o user. Transaction garante atomicidade.
    // Também limpa MatchEvento órfãos (IDs soltos, sem FK no schema).
    await prisma.$transaction(async (tx) => {
      // Limpa matches de evento que referenciam este associado
      await tx.matchEvento.deleteMany({
        where: {
          OR: [
            { tipoMatch: 'EMPRESA_ASSOCIADO', entidade2Id: parseInt(id) },
            { tipoMatch: 'ASSOCIADO_EMPRESA', entidade1Id: parseInt(id) }
          ]
        }
      });

      await tx.associado.delete({
        where: { id: parseInt(id) }
      });

      if (associado.userId) {
        await tx.user.delete({
          where: { id: associado.userId }
        });
      }
    });

    // Log de atividade (fora da transaction — se falhar, delete já foi commitado)
    await prisma.activityLog.create({
      data: {
        userId: req.userId,
        action: 'DELETE',
        entity: 'Associado',
        entityId: parseInt(id),
        details: { nome: associado.nome }
      }
    });

    return res.json({ message: 'Associado excluído com sucesso' });
  } catch (error) {
    console.error('Erro ao excluir associado:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// ─── ESTATÍSTICAS ───
const getStats = async (req, res) => {
  try {
    const total = await prisma.associado.count();
    const porSegmento = await prisma.associado.groupBy({
      by: ['segmento'],
      _count: true
    });

    return res.json({
      total,
      porSegmento
    });
  } catch (error) {
    console.error('Erro ao buscar estatísticas:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// ─── RESETAR SENHA DO ASSOCIADO ───
// POST /associados/:id/reset-senha
// Body opcional: { senha: "string" }
// Se a senha não for fornecida, gera uma temporária aleatória de 10 caracteres.
// Retorna a senha em texto puro pra que o admin possa repassar ao associado.
const resetSenha = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!id || isNaN(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    const associado = await prisma.associado.findUnique({
      where: { id },
      include: { user: true },
    });

    if (!associado) {
      return res.status(404).json({ error: 'Associado não encontrado' });
    }

    let novaSenha = (req.body?.senha || '').toString().trim();
    let geradaPorSistema = false;

    if (!novaSenha) {
      // Gera senha temporária aleatória legível: 10 chars [a-z0-9]
      novaSenha = Math.random().toString(36).slice(2, 8) + Math.floor(1000 + Math.random() * 9000);
      geradaPorSistema = true;
    } else if (novaSenha.length < 6) {
      return res.status(400).json({ error: 'A senha precisa ter no mínimo 6 caracteres' });
    }

    const hashedSenha = await bcrypt.hash(novaSenha, 10);

    // Caso 1: associado já tem User vinculado → atualizar senha
    if (associado.user) {
      await prisma.user.update({
        where: { id: associado.user.id },
        data: { senha: hashedSenha },
      });
    } else {
      // Caso 2: associado não tem login ainda → criar User + vincular
      if (!associado.email) {
        return res.status(400).json({
          error: 'Associado não tem e-mail cadastrado. Adicione um e-mail antes de resetar a senha.',
        });
      }
      // Verificar se já existe usuário com esse e-mail (evita unique violation)
      const existing = await prisma.user.findUnique({ where: { email: associado.email.toLowerCase() } });
      if (existing) {
        // Se já existe um User com mesmo email mas não vinculado, vincular agora
        await prisma.user.update({
          where: { id: existing.id },
          data: { senha: hashedSenha, role: 'ASSOCIADO' },
        });
        await prisma.associado.update({
          where: { id: associado.id },
          data: { userId: existing.id },
        });
      } else {
        const novoUser = await prisma.user.create({
          data: {
            email: associado.email.toLowerCase(),
            senha: hashedSenha,
            role: 'ASSOCIADO',
          },
        });
        await prisma.associado.update({
          where: { id: associado.id },
          data: { userId: novoUser.id },
        });
      }
    }

    // Log
    await prisma.activityLog.create({
      data: {
        action: 'RESET_PASSWORD_ASSOCIADO',
        entity: 'Associado',
        entityId: associado.id,
        userId: req.userId || null,
        details: {
          associadoNome: associado.nome,
          associadoEmail: associado.email,
          geradaPorSistema,
          via: 'admin',
        },
      },
    }).catch(() => {});

    console.log(`🔑 Senha do associado #${associado.id} (${associado.nome}) foi resetada por usuário #${req.userId || '?'}`);

    return res.json({
      success: true,
      novaSenha,
      geradaPorSistema,
      email: associado.email,
      mensagem: geradaPorSistema
        ? 'Senha temporária gerada. Repasse ao associado e oriente a alterar no primeiro acesso.'
        : 'Senha atualizada com sucesso.',
    });
  } catch (error) {
    console.error('Erro ao resetar senha do associado:', error);
    return res.status(500).json({ error: 'Erro ao resetar senha' });
  }
};

module.exports = { getAll, getById, create, createMany, update, remove, getStats, resetSenha };

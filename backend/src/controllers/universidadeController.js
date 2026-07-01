// ═══════════════════════════════════════════════════════════
// UNIVERSIDADE CONTROLLER
// ═══════════════════════════════════════════════════════════
// CRUD de universidades. Cada universidade pode ter um login próprio
// (User com role=UNIVERSIDADE) que dá acesso à área restrita pra
// cadastrar candidatos.
//
// Endpoints:
//   GET    /universidades              — admin lista todas
//   GET    /universidades/stats        — admin: estatísticas
//   GET    /universidades/:id          — busca por ID
//   POST   /universidades              — admin cria
//   PUT    /universidades/:id          — admin atualiza
//   DELETE /universidades/:id          — admin remove
//   POST   /universidades/:id/reset-senha — admin reseta senha do login

const prisma = require('../config/database');
const bcrypt = require('bcryptjs');

// ─── LISTAR TODAS ───
const getAll = async (req, res) => {
  try {
    const { search, ativo, estado } = req.query;
    const where = {};

    if (ativo !== undefined) where.ativo = ativo === 'true';
    if (estado) where.estado = estado;
    if (search) {
      where.OR = [
        { nome: { contains: search, mode: 'insensitive' } },
        { sigla: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { cidade: { contains: search, mode: 'insensitive' } },
      ];
    }

    const universidades = await prisma.universidade.findMany({
      where,
      include: {
        _count: { select: { candidatos: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.json(universidades);
  } catch (error) {
    console.error('Erro ao listar universidades:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// ─── BUSCAR POR ID ───
const getById = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const universidade = await prisma.universidade.findUnique({
      where: { id },
      include: {
        candidatos: {
          where: { ativo: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!universidade) {
      return res.status(404).json({ error: 'Universidade não encontrada' });
    }

    return res.json(universidade);
  } catch (error) {
    console.error('Erro ao buscar universidade:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// ─── CRIAR ───
const create = async (req, res) => {
  try {
    const {
      nome, sigla, cidade, estado, email, telefone, responsavel, descricao,
      criarUsuario, senha,
    } = req.body;

    if (!nome || !email) {
      return res.status(400).json({ error: 'Nome e e-mail são obrigatórios' });
    }

    const emailNorm = email.toLowerCase().trim();

    // Verifica unique
    const existente = await prisma.universidade.findUnique({ where: { email: emailNorm } });
    if (existente) {
      return res.status(409).json({ error: 'Já existe uma universidade com este e-mail' });
    }

    // Cria usuário se solicitado
    let userId = null;
    if (criarUsuario || senha) {
      const userExistente = await prisma.user.findUnique({ where: { email: emailNorm } });
      if (userExistente) {
        return res.status(409).json({ error: 'Já existe um usuário com este e-mail' });
      }
      const hashedSenha = await bcrypt.hash(senha || 'temp123', 10);
      const novoUser = await prisma.user.create({
        data: { email: emailNorm, senha: hashedSenha, role: 'UNIVERSIDADE' },
      });
      userId = novoUser.id;
    }

    const universidade = await prisma.universidade.create({
      data: {
        nome: nome.trim(),
        sigla: sigla?.trim() || null,
        cidade: cidade?.trim() || null,
        estado: estado?.trim() || null,
        email: emailNorm,
        telefone: telefone?.trim() || null,
        responsavel: responsavel?.trim() || null,
        descricao: descricao?.trim() || null,
        userId,
      },
    });

    await prisma.activityLog.create({
      data: {
        action: 'CREATE_UNIVERSIDADE',
        entity: 'Universidade',
        entityId: universidade.id,
        userId: req.userId,
        details: { nome: universidade.nome, criouLogin: !!userId },
      },
    }).catch(() => {});

    return res.status(201).json(universidade);
  } catch (error) {
    console.error('Erro ao criar universidade:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// ─── ATUALIZAR ───
const update = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const {
      nome, sigla, cidade, estado, email, telefone, responsavel, descricao, ativo,
    } = req.body;

    const existente = await prisma.universidade.findUnique({ where: { id } });
    if (!existente) {
      return res.status(404).json({ error: 'Universidade não encontrada' });
    }

    // Se mudou email, validar unicidade
    if (email && email.toLowerCase().trim() !== existente.email) {
      const dup = await prisma.universidade.findUnique({ where: { email: email.toLowerCase().trim() } });
      if (dup) return res.status(409).json({ error: 'Já existe uma universidade com este e-mail' });
    }

    const updated = await prisma.universidade.update({
      where: { id },
      data: {
        ...(nome !== undefined && { nome: nome.trim() }),
        ...(sigla !== undefined && { sigla: sigla?.trim() || null }),
        ...(cidade !== undefined && { cidade: cidade?.trim() || null }),
        ...(estado !== undefined && { estado: estado?.trim() || null }),
        ...(email !== undefined && { email: email.toLowerCase().trim() }),
        ...(telefone !== undefined && { telefone: telefone?.trim() || null }),
        ...(responsavel !== undefined && { responsavel: responsavel?.trim() || null }),
        ...(descricao !== undefined && { descricao: descricao?.trim() || null }),
        ...(ativo !== undefined && { ativo: !!ativo }),
      },
    });

    return res.json(updated);
  } catch (error) {
    console.error('Erro ao atualizar universidade:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// ─── REMOVER ───
const remove = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const existente = await prisma.universidade.findUnique({
      where: { id },
      include: { _count: { select: { candidatos: true } } },
    });
    if (!existente) return res.status(404).json({ error: 'Universidade não encontrada' });

    // Cascade do schema apaga candidatos. Se quiser confirmação extra, pode
    // bloquear quando há candidatos vinculados.

    await prisma.universidade.delete({ where: { id } });

    await prisma.activityLog.create({
      data: {
        action: 'DELETE_UNIVERSIDADE',
        entity: 'Universidade',
        entityId: id,
        userId: req.userId,
        details: { nome: existente.nome, candidatosRemovidos: existente._count.candidatos },
      },
    }).catch(() => {});

    return res.json({ success: true });
  } catch (error) {
    console.error('Erro ao remover universidade:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// ─── RESETAR SENHA ───
// Mesma lógica do associadoController.resetSenha.
const resetSenha = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const universidade = await prisma.universidade.findUnique({
      where: { id },
      include: { user: true },
    });

    if (!universidade) {
      return res.status(404).json({ error: 'Universidade não encontrada' });
    }

    let novaSenha = (req.body?.senha || '').toString().trim();
    let geradaPorSistema = false;

    if (!novaSenha) {
      novaSenha = Math.random().toString(36).slice(2, 8) + Math.floor(1000 + Math.random() * 9000);
      geradaPorSistema = true;
    } else if (novaSenha.length < 6) {
      return res.status(400).json({ error: 'A senha precisa ter no mínimo 6 caracteres' });
    }

    const hashedSenha = await bcrypt.hash(novaSenha, 10);

    if (universidade.user) {
      await prisma.user.update({
        where: { id: universidade.user.id },
        data: { senha: hashedSenha },
      });
    } else {
      const existing = await prisma.user.findUnique({ where: { email: universidade.email } });
      if (existing) {
        await prisma.user.update({
          where: { id: existing.id },
          data: { senha: hashedSenha, role: 'UNIVERSIDADE' },
        });
        await prisma.universidade.update({
          where: { id: universidade.id },
          data: { userId: existing.id },
        });
      } else {
        const novoUser = await prisma.user.create({
          data: { email: universidade.email, senha: hashedSenha, role: 'UNIVERSIDADE' },
        });
        await prisma.universidade.update({
          where: { id: universidade.id },
          data: { userId: novoUser.id },
        });
      }
    }

    await prisma.activityLog.create({
      data: {
        action: 'RESET_PASSWORD_UNIVERSIDADE',
        entity: 'Universidade',
        entityId: universidade.id,
        userId: req.userId || null,
        details: { universidadeNome: universidade.nome, geradaPorSistema, via: 'admin' },
      },
    }).catch(() => {});

    console.log(`🔑 Senha da universidade #${universidade.id} (${universidade.nome}) foi resetada por usuário #${req.userId || '?'}`);

    return res.json({
      success: true,
      novaSenha,
      geradaPorSistema,
      email: universidade.email,
      mensagem: geradaPorSistema
        ? 'Senha temporária gerada. Repasse à universidade.'
        : 'Senha atualizada com sucesso.',
    });
  } catch (error) {
    console.error('Erro ao resetar senha:', error);
    return res.status(500).json({ error: 'Erro ao resetar senha' });
  }
};

// ─── ESTATÍSTICAS ───
const getStats = async (_req, res) => {
  try {
    const total = await prisma.universidade.count();
    const ativas = await prisma.universidade.count({ where: { ativo: true } });
    const totalCandidatos = await prisma.candidato.count({ where: { ativo: true } });
    return res.json({ total, ativas, totalCandidatos });
  } catch (error) {
    console.error('Erro ao buscar estatísticas:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

module.exports = { getAll, getById, create, update, remove, resetSenha, getStats };

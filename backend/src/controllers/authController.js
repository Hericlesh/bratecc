// ═══════════════════════════════════════════════════════════
// Controller de Autenticação
// ═══════════════════════════════════════════════════════════

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../config/database');

// ─── LOGIN ───
const login = async (req, res) => {
  try {
    // Validação crítica: sem JWT_SECRET nem adianta tentar
    if (!process.env.JWT_SECRET) {
      console.error('❌ JWT_SECRET não configurado no .env');
      return res.status(500).json({
        error: 'Configuração do servidor incompleta (JWT_SECRET ausente). Contate o administrador.'
      });
    }

    const { email, senha } = req.body;

    if (!email || !senha) {
      return res.status(400).json({ error: 'E-mail e senha são obrigatórios' });
    }

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: { associado: true, universidade: true }
    });

    if (!user) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    if (!user.ativo) {
      return res.status(401).json({ error: 'Usuário inativo' });
    }

    const senhaValida = await bcrypt.compare(senha, user.senha);

    if (!senhaValida) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    // Log de atividade (não-crítico: se falhar, não impede o login)
    try {
      await prisma.activityLog.create({
        data: {
          userId: user.id,
          action: 'LOGIN',
          entity: 'User',
          entityId: user.id,
          ipAddress: req.ip
        }
      });
    } catch (logErr) {
      console.warn('Falha ao gravar ActivityLog (não impede login):', logErr.message);
    }

    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role.toLowerCase(),
        associado: user.associado ? {
          id: user.associado.id,
          nome: user.associado.nome
        } : null,
        universidade: user.universidade ? {
          id: user.universidade.id,
          nome: user.universidade.nome,
          sigla: user.universidade.sigla
        } : null
      }
    });
  } catch (error) {
    console.error('❌ Erro no login:', error);
    // Mensagens específicas para causas comuns
    if (error.code === 'P2021' || error.message?.includes('does not exist')) {
      return res.status(500).json({
        error:
          'Tabelas do banco não existem. Com Postgres ativo, rode na pasta backend: npm install && npm run db:setup (aplica todas as migrations e gera o Prisma Client). Se preferir usar o Prisma CLI, use npm run db:migrate.'
      });
    }
    if (error.code === 'P1001' || error.message?.includes('Can\'t reach database')) {
      return res.status(500).json({
        error: 'Não foi possível conectar ao banco de dados. Verifique DATABASE_URL.'
      });
    }
    return res.status(500).json({
      error: 'Erro interno do servidor',
      // Em dev, expor detalhes para facilitar diagnóstico
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ─── VERIFICAR TOKEN ───
const me = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      include: { associado: true, universidade: true }
    });

    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    return res.json({
      id: user.id,
      email: user.email,
      role: user.role.toLowerCase(),
      associado: user.associado ? {
        id: user.associado.id,
        nome: user.associado.nome
      } : null,
      universidade: user.universidade ? {
        id: user.universidade.id,
        nome: user.universidade.nome,
        sigla: user.universidade.sigla
      } : null
    });
  } catch (error) {
    console.error('Erro ao buscar usuário:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// ─── CRIAR USUÁRIO (Admin only) ───
const createUser = async (req, res) => {
  try {
    const { email, senha, role } = req.body;

    const existingUser = await prisma.user.findUnique({
      where: { email: email.toLowerCase() }
    });

    if (existingUser) {
      return res.status(400).json({ error: 'E-mail já cadastrado' });
    }

    const hashedSenha = await bcrypt.hash(senha, 10);

    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        senha: hashedSenha,
        role: role || 'ASSOCIADO'
      }
    });

    return res.status(201).json({
      id: user.id,
      email: user.email,
      role: user.role
    });
  } catch (error) {
    console.error('Erro ao criar usuário:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

module.exports = { login, me, createUser };

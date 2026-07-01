// ═══════════════════════════════════════════════════════════
// Controller de Itens (Produtos/Serviços oferecidos ou demandados)
// ═══════════════════════════════════════════════════════════

const prisma = require('../config/database');
const ncmService = require('../services/ncmService');

// ─── Helpers de validação ───
const TIPOS_VALIDOS = ['OFERECIDO', 'DEMANDADO'];

function validarOwner(body) {
  const empresaId = body.empresaId ? parseInt(body.empresaId) : null;
  const associadoId = body.associadoId ? parseInt(body.associadoId) : null;

  if (!empresaId && !associadoId) {
    return { error: 'Informe empresaId OU associadoId' };
  }
  if (empresaId && associadoId) {
    return { error: 'Item não pode pertencer a empresa E associado ao mesmo tempo' };
  }
  return { empresaId, associadoId };
}

// ─── LISTAR ITENS ───
// GET /items?empresaId=1  ou  /items?associadoId=1
// Filtros opcionais: ?tipo=OFERECIDO
const getAll = async (req, res) => {
  try {
    const { empresaId, associadoId, tipo } = req.query;

    const where = {};
    if (empresaId) where.empresaId = parseInt(empresaId);
    if (associadoId) where.associadoId = parseInt(associadoId);
    if (tipo) {
      const tipoUp = String(tipo).toUpperCase();
      if (!TIPOS_VALIDOS.includes(tipoUp)) {
        return res.status(400).json({ error: `tipo deve ser um de: ${TIPOS_VALIDOS.join(', ')}` });
      }
      where.tipo = tipoUp;
    }

    if (!empresaId && !associadoId) {
      return res.status(400).json({ error: 'Informe empresaId ou associadoId' });
    }

    const items = await prisma.item.findMany({
      where,
      orderBy: { createdAt: 'asc' }
    });

    return res.json(items);
  } catch (error) {
    console.error('Erro ao listar items:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// ─── BUSCAR ITEM POR ID ───
const getById = async (req, res) => {
  try {
    const { id } = req.params;
    const item = await prisma.item.findUnique({
      where: { id: parseInt(id) }
    });

    if (!item) {
      return res.status(404).json({ error: 'Item não encontrado' });
    }
    return res.json(item);
  } catch (error) {
    console.error('Erro ao buscar item:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// ─── CRIAR ITEM ───
const create = async (req, res) => {
  try {
    const { nome, tipo, ncmCodigo } = req.body;

    if (!nome || !String(nome).trim()) {
      return res.status(400).json({ error: 'nome é obrigatório' });
    }

    const tipoUp = String(tipo || '').toUpperCase();
    if (!TIPOS_VALIDOS.includes(tipoUp)) {
      return res.status(400).json({ error: `tipo deve ser um de: ${TIPOS_VALIDOS.join(', ')}` });
    }

    const ownerCheck = validarOwner(req.body);
    if (ownerCheck.error) {
      return res.status(400).json({ error: ownerCheck.error });
    }

    // Se ncmCodigo fornecido, busca descrição no cache
    let ncmDescricao = null;
    let ncmNormalizado = null;
    if (ncmCodigo) {
      ncmNormalizado = String(ncmCodigo).replace(/\./g, '').trim();
      const ncm = await ncmService.getByCodigo(ncmNormalizado);
      if (ncm) {
        ncmDescricao = ncm.descricao;
      }
      // Se não encontrou, guarda o código do jeito que veio — o usuário
      // pode ter digitado manualmente um código que ainda não foi cacheado
    }

    const item = await prisma.item.create({
      data: {
        nome: String(nome).trim(),
        tipo: tipoUp,
        ncmCodigo: ncmNormalizado,
        ncmDescricao,
        empresaId: ownerCheck.empresaId,
        associadoId: ownerCheck.associadoId,
      }
    });

    return res.status(201).json(item);
  } catch (error) {
    console.error('Erro ao criar item:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// ─── ATUALIZAR ITEM ───
const update = async (req, res) => {
  try {
    const { id } = req.params;
    const { nome, tipo, ncmCodigo } = req.body;

    const existing = await prisma.item.findUnique({ where: { id: parseInt(id) } });
    if (!existing) {
      return res.status(404).json({ error: 'Item não encontrado' });
    }

    const data = {};
    if (nome !== undefined) {
      if (!String(nome).trim()) {
        return res.status(400).json({ error: 'nome não pode ficar vazio' });
      }
      data.nome = String(nome).trim();
    }
    if (tipo !== undefined) {
      const tipoUp = String(tipo).toUpperCase();
      if (!TIPOS_VALIDOS.includes(tipoUp)) {
        return res.status(400).json({ error: `tipo deve ser um de: ${TIPOS_VALIDOS.join(', ')}` });
      }
      data.tipo = tipoUp;
    }
    if (ncmCodigo !== undefined) {
      if (ncmCodigo === null || ncmCodigo === '') {
        data.ncmCodigo = null;
        data.ncmDescricao = null;
      } else {
        const normalized = String(ncmCodigo).replace(/\./g, '').trim();
        data.ncmCodigo = normalized;
        const ncm = await ncmService.getByCodigo(normalized);
        data.ncmDescricao = ncm ? ncm.descricao : null;
      }
    }

    const item = await prisma.item.update({
      where: { id: parseInt(id) },
      data
    });

    return res.json(item);
  } catch (error) {
    console.error('Erro ao atualizar item:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// ─── EXCLUIR ITEM ───
const remove = async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.item.findUnique({ where: { id: parseInt(id) } });
    if (!existing) {
      return res.status(404).json({ error: 'Item não encontrado' });
    }

    await prisma.item.delete({ where: { id: parseInt(id) } });
    return res.json({ message: 'Item excluído com sucesso' });
  } catch (error) {
    console.error('Erro ao excluir item:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// ═══════════════════════════════════════════════════════════
// ENDPOINTS DE NCM
// ═══════════════════════════════════════════════════════════

// GET /items/ncm/search?q=solar&limit=20
const searchNcm = async (req, res) => {
  try {
    const { q, limit } = req.query;
    const results = await ncmService.search(q || '', limit ? parseInt(limit) : 20);
    return res.json(results);
  } catch (error) {
    console.error('Erro ao buscar NCM:', error);
    return res.status(500).json({
      error: 'Erro ao buscar NCM',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// GET /items/ncm/:codigo
const getNcm = async (req, res) => {
  try {
    const { codigo } = req.params;
    const ncm = await ncmService.getByCodigo(codigo);
    if (!ncm) {
      return res.status(404).json({ error: 'Código NCM não encontrado' });
    }
    return res.json(ncm);
  } catch (error) {
    console.error('Erro ao buscar NCM:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// POST /items/ncm/refresh (admin only, força atualização do cache)
const refreshNcm = async (req, res) => {
  try {
    const count = await ncmService.refreshCache();
    return res.json({ message: 'Cache NCM atualizado', total: count });
  } catch (error) {
    console.error('Erro ao atualizar cache NCM:', error);
    return res.status(500).json({
      error: 'Erro ao atualizar cache NCM (API do Siscomex pode estar indisponível)',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

module.exports = {
  getAll,
  getById,
  create,
  update,
  remove,
  searchNcm,
  getNcm,
  refreshNcm,
};

// ═══════════════════════════════════════════════════════════
// Controller público: inscrição de empresas em eventos
// ═══════════════════════════════════════════════════════════
// Rotas PÚBLICAS (sem authMiddleware). Acessível por qualquer um
// com o slug do evento. A segurança vem de:
//   1. Slug suficientemente aleatório (~50 bits de entropia)
//   2. Evento precisa estar com inscricaoAtiva=true
//   3. Evento não pode ter passado da data fim
//   4. Captcha opcional (ativado via env vars)
// ═══════════════════════════════════════════════════════════

const prisma = require('../config/database');
const { validarCaptcha } = require('../services/inscricaoService');

// ─── Helper: valida que o evento aceita inscrições agora ───
async function buscarEventoInscrivel(slug) {
  if (!slug || typeof slug !== 'string') {
    return { error: { status: 404, message: 'Link inválido' } };
  }

  const evento = await prisma.evento.findUnique({
    where: { inscricaoSlug: slug.toLowerCase().trim() }
  });

  if (!evento) {
    return { error: { status: 404, message: 'Link de inscrição não encontrado' } };
  }

  if (!evento.inscricaoAtiva) {
    return { error: { status: 403, message: 'As inscrições para este evento foram encerradas pelo organizador' } };
  }

  if (evento.status === 'CANCELADO' || evento.status === 'FINALIZADO') {
    return { error: { status: 403, message: `Evento ${evento.status.toLowerCase()}. Inscrições indisponíveis.` } };
  }

  // Se tem dataFim, não aceita inscrições após ela
  if (evento.dataFim && new Date(evento.dataFim) < new Date()) {
    return { error: { status: 403, message: 'As inscrições para este evento já se encerraram (evento ocorreu).' } };
  }

  return { evento };
}

// ─── GET /public/inscricao/:slug ───
// Retorna dados PÚBLICOS do evento (nome, data, local, descrição).
// Não inclui lista de participantes nem associados — só o essencial
// para renderizar o formulário de inscrição.
const getEventoInscricao = async (req, res) => {
  try {
    const { slug } = req.params;
    const { evento, error } = await buscarEventoInscrivel(slug);
    if (error) return res.status(error.status).json({ error: error.message });

    return res.json({
      nome: evento.nome,
      local: evento.local,
      data: evento.data,
      dataFim: evento.dataFim,
      descricao: evento.descricao,
      categorias: evento.categorias || [],
      captchaRequired: !!(process.env.CAPTCHA_PROVIDER && process.env.CAPTCHA_SECRET),
      captchaProvider: process.env.CAPTCHA_PROVIDER || null,
      captchaSiteKey: process.env.CAPTCHA_SITE_KEY || null
    });
  } catch (err) {
    console.error('Erro ao buscar evento para inscrição:', err);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// ─── POST /public/inscricao/:slug ───
// Cadastra uma nova Empresa vinculada exclusivamente ao evento
// (eventoOrigemId = evento.id) e a adiciona em EventoParticipante.
const submitInscricao = async (req, res) => {
  try {
    const { slug } = req.params;
    const { evento, error } = await buscarEventoInscrivel(slug);
    if (error) return res.status(error.status).json({ error: error.message });

    const {
      nome, setor, porte, cidade, estado, tipo,
      email, telefone, descricao, necessidades,
      captchaToken,
      items // opcional: array de { nome, tipo: 'OFERECIDO'|'DEMANDADO', ncmCodigo? }
    } = req.body;

    // Captcha (noop se não estiver configurado no env)
    const captchaResult = await validarCaptcha(
      captchaToken,
      req.ip || req.headers['x-forwarded-for']
    );
    if (!captchaResult.success) {
      return res.status(400).json({ error: captchaResult.error || 'Captcha inválido' });
    }

    // Validações básicas (mesmas do formulário admin, com mensagens claras)
    if (!nome || !String(nome).trim()) {
      return res.status(400).json({ error: 'Nome da empresa é obrigatório' });
    }
    if (!setor || !String(setor).trim()) {
      return res.status(400).json({ error: 'Segmento/setor é obrigatório' });
    }
    if (!cidade || !String(cidade).trim()) {
      return res.status(400).json({ error: 'Cidade é obrigatória' });
    }
    if (!estado || !String(estado).trim()) {
      return res.status(400).json({ error: 'Estado é obrigatório' });
    }
    if (!tipo || !['EXPORTADOR', 'IMPORTADOR', 'AMBOS'].includes(tipo)) {
      return res.status(400).json({ error: 'Tipo deve ser Exportador, Importador ou Ambos' });
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'E-mail inválido' });
    }

    // Checa se já existe empresa com esse email
    const emailLower = email.toLowerCase().trim();
    const existente = await prisma.empresa.findUnique({
      where: { email: emailLower },
      select: { id: true, nome: true, eventoOrigemId: true }
    });

    if (existente) {
      // Caso 1: já está inscrita neste mesmo evento
      const inscricaoExistente = await prisma.eventoParticipante.findFirst({
        where: { eventoId: evento.id, empresaId: existente.id }
      });
      if (inscricaoExistente) {
        return res.status(409).json({ error: 'Esta empresa já está inscrita neste evento' });
      }
      // Caso 2: empresa já existe em outro contexto — não podemos reusar porque
      // o pedido é que inscrições públicas fiquem restritas ao evento. Bloqueia.
      return res.status(409).json({
        error: 'Este e-mail já está em uso no sistema. Se você é esta empresa, entre em contato com o organizador do evento.'
      });
    }

    // Normaliza items (se fornecidos)
    const itemsNormalizados = [];
    if (Array.isArray(items)) {
      for (const it of items) {
        if (!it.nome || !String(it.nome).trim()) continue;
        const tipoUp = String(it.tipo || '').toUpperCase();
        if (!['OFERECIDO', 'DEMANDADO'].includes(tipoUp)) continue;
        itemsNormalizados.push({
          nome: String(it.nome).trim(),
          tipo: tipoUp,
          ncmCodigo: it.ncmCodigo ? String(it.ncmCodigo).replace(/\./g, '').trim() : null,
          ncmDescricao: it.ncmDescricao || null
        });
      }
    }

    // Transação: cria Empresa com eventoOrigemId + adiciona em EventoParticipante
    const empresa = await prisma.$transaction(async (tx) => {
      const novaEmpresa = await tx.empresa.create({
        data: {
          nome: String(nome).trim(),
          setor: String(setor).trim(),
          porte: porte || null,
          cidade: String(cidade).trim(),
          estado: String(estado).trim(),
          tipo,
          email: emailLower,
          telefone: telefone || null,
          descricao: descricao || null,
          necessidades: necessidades || null,
          ativo: true,
          eventoOrigemId: evento.id, // marca como restrita a este evento
          items: itemsNormalizados.length > 0 ? { create: itemsNormalizados } : undefined
        },
        include: { items: { orderBy: { createdAt: 'asc' } } }
      });

      await tx.eventoParticipante.create({
        data: {
          eventoId: evento.id,
          empresaId: novaEmpresa.id,
          confirmado: true, // inscrição direta pelo link = confirmação automática
        }
      });

      return novaEmpresa;
    });

    // Log (sem userId — é anônimo)
    await prisma.activityLog.create({
      data: {
        action: 'PUBLIC_INSCRICAO',
        entity: 'Empresa',
        entityId: empresa.id,
        ipAddress: req.ip || req.headers['x-forwarded-for'] || null,
        details: {
          eventoId: evento.id,
          eventoNome: evento.nome,
          empresaNome: empresa.nome
        }
      }
    }).catch(() => {}); // log não é crítico

    return res.status(201).json({
      success: true,
      message: `Inscrição confirmada para ${evento.nome}!`,
      empresa: {
        id: empresa.id,
        nome: empresa.nome,
        email: empresa.email
      },
      evento: {
        nome: evento.nome,
        data: evento.data,
        local: evento.local
      }
    });
  } catch (err) {
    console.error('Erro ao processar inscrição pública:', err);
    return res.status(500).json({ error: 'Erro interno ao processar inscrição' });
  }
};

module.exports = { getEventoInscricao, submitInscricao };

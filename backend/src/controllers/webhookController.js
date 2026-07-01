// ═══════════════════════════════════════════════════════════
// BRATECC Connect AI - Webhook Controller (Meta WhatsApp)
// ═══════════════════════════════════════════════════════════
//
// Endpoints:
//   GET  /api/webhook/meta   → Verificação do webhook pela Meta
//   POST /api/webhook/meta   → Receber mensagens e status
//   POST /api/whatsapp/send  → Enviar mensagem manual
//   POST /api/whatsapp/send-bulk → Enviar em lote
//   GET  /api/whatsapp/status → Status da integração
//
// ═══════════════════════════════════════════════════════════

const whatsappService = require('../services/whatsappService');
const prisma = require('../config/database');

// ═══════════════════════════════════════════════════════════
// WEBHOOK META — VERIFICAÇÃO (GET)
// ═══════════════════════════════════════════════════════════
//
// A Meta envia um GET para verificar o webhook na configuração.
// Precisa retornar o hub.challenge se o token bater.
//
// No painel da Meta:
//   Callback URL: https://seu-dominio.com/api/webhook/meta
//   Verify Token: (o valor de META_VERIFY_TOKEN no .env)
//
exports.verifyWebhook = (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const config = whatsappService.getConfig();

  console.log('🔐 Webhook verification request:', { mode, token: token?.substring(0, 10) + '...' });

  if (mode === 'subscribe' && token === config.verifyToken) {
    console.log('✅ Webhook verificado com sucesso!');
    return res.status(200).send(challenge);
  }

  console.warn('❌ Webhook verification failed — token mismatch');
  return res.sendStatus(403);
};

// ═══════════════════════════════════════════════════════════
// WEBHOOK META — RECEBER MENSAGENS (POST)
// ═══════════════════════════════════════════════════════════
//
// A Meta envia POST com mensagens recebidas e atualizações de status.
// IMPORTANTE: Sempre retornar 200 rapidamente para evitar re-envios.
//
exports.receiveWebhook = async (req, res) => {
  // SEMPRE retornar 200 imediatamente (a Meta re-envia se não receber)
  res.sendStatus(200);

  try {
    const body = req.body;

    // Verificar se é do WhatsApp Business
    if (body.object !== 'whatsapp_business_account') {
      return;
    }

    // Processar cada entry
    const entries = body.entry || [];

    for (const entry of entries) {
      const changes = entry.changes || [];

      for (const change of changes) {
        if (change.field !== 'messages') continue;

        const value = change.value;

        // ─── MENSAGENS RECEBIDAS ───
        if (value.messages && value.messages.length > 0) {
          for (const message of value.messages) {
            const contact = value.contacts?.find(c => c.wa_id === message.from);

            // Processar apenas mensagens de texto e interativas
            if (message.type === 'text' || message.type === 'interactive') {
              await whatsappService.processIncomingMessage(message, contact);
            } else {
              // Para outros tipos (imagem, áudio, etc.), responder pedindo texto
              await whatsappService.sendTextMessage(message.from,
                '🤖 Por enquanto, consigo processar apenas mensagens de texto. Por favor, digite sua resposta.'
              );
            }
          }
        }

        // ─── STATUS DE MENSAGENS ENVIADAS ───
        if (value.statuses && value.statuses.length > 0) {
          for (const status of value.statuses) {
            await handleStatusUpdate(status);
          }
        }

        // ─── ERROS ───
        if (value.errors && value.errors.length > 0) {
          for (const error of value.errors) {
            console.error('❌ Erro Meta Webhook:', JSON.stringify(error));
            await prisma.activityLog.create({
              data: {
                action: 'WHATSAPP_WEBHOOK_ERROR',
                entity: 'WhatsApp',
                details: error,
              },
            });
          }
        }
      }
    }
  } catch (error) {
    console.error('❌ Erro ao processar webhook:', error);
  }
};

// ═══════════════════════════════════════════════════════════
// ENVIAR MENSAGEM MANUAL (POST /api/whatsapp/send)
// ═══════════════════════════════════════════════════════════
exports.sendMessage = async (req, res) => {
  try {
    const { to, message, type = 'text' } = req.body;

    if (!to || !message) {
      return res.status(400).json({ error: 'Campos "to" e "message" são obrigatórios' });
    }

    let result;

    if (type === 'template') {
      result = await whatsappService.sendTemplate(to, message, req.body.language, req.body.components);
    } else {
      result = await whatsappService.sendTextMessage(to, message);
    }

    if (result.success) {
      return res.json({ success: true, messageId: result.messageId });
    }

    return res.status(500).json({ success: false, error: result.error });
  } catch (error) {
    console.error('Erro ao enviar mensagem:', error);
    return res.status(500).json({ error: 'Erro interno ao enviar mensagem' });
  }
};

// ═══════════════════════════════════════════════════════════
// ENVIAR EM LOTE (POST /api/whatsapp/send-bulk)
// ═══════════════════════════════════════════════════════════
exports.sendBulk = async (req, res) => {
  try {
    const { matchIds } = req.body;

    if (!matchIds || !Array.isArray(matchIds) || matchIds.length === 0) {
      return res.status(400).json({ error: 'Array "matchIds" é obrigatório' });
    }

    const results = await whatsappService.sendBulkMatchNotifications(matchIds);

    return res.json({
      success: true,
      total: matchIds.length,
      sent: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      details: results,
    });
  } catch (error) {
    console.error('Erro no envio em lote:', error);
    return res.status(500).json({ error: 'Erro interno no envio em lote' });
  }
};

// ═══════════════════════════════════════════════════════════
// ENVIAR HSM INÍCIO (POST /api/whatsapp/send-hsm)
// Body: { to, nome, segmento, produtoDemandado }
// ═══════════════════════════════════════════════════════════
exports.sendHSM = async (req, res) => {
  try {
    const { to, nome, segmento, produtoDemandado } = req.body;

    if (!to || !nome) {
      return res.status(400).json({ error: 'Campos "to" e "nome" são obrigatórios' });
    }

    const result = await whatsappService.sendHSMInicio(to, nome, segmento, produtoDemandado);

    if (result.success) {
      return res.json({ success: true, messageId: result.messageId });
    }

    return res.status(500).json({ success: false, error: result.error });
  } catch (error) {
    console.error('Erro ao enviar HSM:', error);
    return res.status(500).json({ error: 'Erro interno ao enviar HSM' });
  }
};

// ═══════════════════════════════════════════════════════════
// ENVIAR HSM INÍCIO EM LOTE PARA MATCHES Assoc × Empresa
// POST /api/whatsapp/send-hsm-matches
// Body: { matchIds: [1, 2, 3] }
// ► v15: Envia APENAS para o ASSOCIADO de cada match (etapa 1).
//   A empresa só recebe HSM (avanço/hsmbrac) quando o associado aceitar.
// ═══════════════════════════════════════════════════════════
exports.sendHSMMatches = async (req, res) => {
  try {
    const { matchIds } = req.body;

    if (!matchIds || !Array.isArray(matchIds) || matchIds.length === 0) {
      return res.status(400).json({ error: 'Array "matchIds" é obrigatório' });
    }

    const results = await whatsappService.sendMatchHSMBulk(matchIds);

    const sent = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success && !r.skipped).length;
    const skipped = results.filter(r => r.skipped).length;

    return res.json({
      success: true,
      total: results.length,
      sent,
      failed,
      skipped,
      details: results,
      info: 'HSM de início enviado apenas para os associados. Empresas serão contatadas automaticamente quando o associado aceitar.',
    });
  } catch (error) {
    console.error('Erro no envio HSM em lote:', error);
    return res.status(500).json({ error: 'Erro interno no envio HSM em lote' });
  }
};

// ═══════════════════════════════════════════════════════════
// ENVIAR HSM INÍCIO EM LOTE PARA MATCHES Assoc × Assoc (B2B)
// POST /api/whatsapp/send-hsm-matches-b2b
// Body: { matchIds: [1, 2, 3] }   (IDs da tabela MatchB2B)
// ► Envia APENAS para o associado ORIGEM (menor ID) do par. O destino
//   só recebe HSM (avanço/hsmbrac) quando a origem aceitar.
// ═══════════════════════════════════════════════════════════
exports.sendHSMMatchesB2B = async (req, res) => {
  try {
    const { matchIds } = req.body;

    if (!matchIds || !Array.isArray(matchIds) || matchIds.length === 0) {
      return res.status(400).json({ error: 'Array "matchIds" é obrigatório' });
    }

    const results = await whatsappService.sendMatchB2BHSMBulk(matchIds);

    const sent = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success && !r.skipped).length;
    const skipped = results.filter(r => r.skipped).length;

    return res.json({
      success: true,
      total: results.length,
      sent,
      failed,
      skipped,
      details: results,
      info: 'HSM de início enviado apenas para o associado de origem de cada par. O destino será contatado quando a origem aceitar.',
    });
  } catch (error) {
    console.error('Erro no envio HSM B2B em lote:', error);
    return res.status(500).json({ error: 'Erro interno no envio HSM B2B em lote' });
  }
};

// POST /api/whatsapp/send-hsm-matches-vaga
// Body: { matchIds: [1, 2, 3] }   (IDs da tabela MatchVaga)
// ► Envia APENAS para o ASSOCIADO dono da vaga em cada par. O candidato só
//   recebe HSM (avanço/hsmbrac) quando o associado aceitar via fluxo de conversa.
// ═══════════════════════════════════════════════════════════
exports.sendHSMMatchesVaga = async (req, res) => {
  try {
    const { matchIds } = req.body;

    if (!matchIds || !Array.isArray(matchIds) || matchIds.length === 0) {
      return res.status(400).json({ error: 'Array "matchIds" é obrigatório' });
    }

    const results = await whatsappService.sendMatchVagaHSMBulk(matchIds);

    const sent = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success && !r.skipped).length;
    const skipped = results.filter(r => r.skipped).length;

    return res.json({
      success: true,
      total: results.length,
      sent,
      failed,
      skipped,
      details: results,
      info: 'HSM enviado apenas para o associado dono de cada vaga. O candidato será contatado quando o associado aceitar.',
    });
  } catch (error) {
    console.error('Erro no envio HSM matches Vaga em lote:', error);
    return res.status(500).json({ error: 'Erro interno no envio HSM Vaga em lote' });
  }
};

// ═══════════════════════════════════════════════════════════
// CONVITE PARA EVENTO (POST /api/whatsapp/send-evento-invite)
// Body: { eventoId, alvos: [{ tipo: 'empresa'|'associado', id }, ...] }
// Dispara hsmbraevent para cada alvo informando o evento.
// ═══════════════════════════════════════════════════════════
exports.sendEventoInvite = async (req, res) => {
  try {
    const { eventoId, alvos } = req.body;

    if (!eventoId) {
      return res.status(400).json({ error: 'Campo "eventoId" é obrigatório' });
    }
    if (!alvos || !Array.isArray(alvos) || alvos.length === 0) {
      return res.status(400).json({ error: 'Array "alvos" com { tipo, id } é obrigatório' });
    }

    // Validação básica do shape de cada alvo
    const tiposValidos = new Set(['empresa', 'associado']);
    const invalidos = alvos.filter(a => !a || !tiposValidos.has(a.tipo) || !a.id);
    if (invalidos.length > 0) {
      return res.status(400).json({
        error: `${invalidos.length} alvo(s) inválido(s). Cada alvo precisa de { tipo: 'empresa'|'associado', id: number }.`
      });
    }

    const result = await whatsappService.sendEventoInviteBulk(eventoId, alvos);
    if (result.error) {
      return res.status(404).json(result);
    }

    return res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('Erro no envio convite de evento:', error);
    return res.status(500).json({ error: 'Erro interno no envio convite de evento', details: error.message });
  }
};

// ═══════════════════════════════════════════════════════════
// SINERGIA NO EVENTO (POST /api/whatsapp/send-evento-sinergia)
// Body: { eventoId, pares: [{ empresaId, associadoId }, ...] }
// Cria matches PENDING (Assoc×Empresa) e dispara HSM etapa 1
// (hsm_evento_empresa_associado) para os ASSOCIADOS dos pares.
// A etapa 2 (hsmbrac, reutilizado) é disparada automaticamente
// pelo webhookController quando o associado responder com interesse.
// ═══════════════════════════════════════════════════════════
exports.sendEventoSinergia = async (req, res) => {
  try {
    const { eventoId, pares } = req.body;

    if (!eventoId) {
      return res.status(400).json({ error: 'Campo "eventoId" é obrigatório' });
    }
    if (!pares || !Array.isArray(pares) || pares.length === 0) {
      return res.status(400).json({ error: 'Array "pares" com { empresaId, associadoId } é obrigatório' });
    }

    const invalidos = pares.filter(p => !p || !p.empresaId || !p.associadoId);
    if (invalidos.length > 0) {
      return res.status(400).json({
        error: `${invalidos.length} par(es) inválido(s). Cada par precisa de { empresaId, associadoId }.`
      });
    }

    const result = await whatsappService.sendEventoSinergiaInicioBulk(eventoId, pares);
    if (result.error) {
      return res.status(404).json(result);
    }

    return res.json({
      success: true,
      info: 'HSM etapa 1 enviado aos associados. A empresa será contatada automaticamente quando o associado responder com interesse no WhatsApp.',
      ...result,
    });
  } catch (error) {
    console.error('Erro no envio sinergia evento:', error);
    return res.status(500).json({ error: 'Erro interno no envio sinergia evento', details: error.message });
  }
};

// ═══════════════════════════════════════════════════════════
// STATUS DA INTEGRAÇÃO (GET /api/whatsapp/status)
// ═══════════════════════════════════════════════════════════
exports.getStatus = async (req, res) => {
  try {
    const config = whatsappService.getConfig();

    const configured = !!(config.accessToken && config.phoneNumberId);

    // Contar mensagens enviadas (últimas 24h)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentLogs = await prisma.activityLog.count({
      where: {
        action: { startsWith: 'WHATSAPP_' },
        createdAt: { gte: oneDayAgo },
      },
    });

    // Conversas ativas
    const activeConversations = whatsappService.conversationStates.size;

    return res.json({
      configured,
      provider: 'Meta WhatsApp Business Cloud API',
      whatsappLineId: configured ? config.phoneNumberId : null,
      activeConversations,
      messagesLast24h: recentLogs,
      webhookUrl: `${process.env.FRONTEND_URL || 'http://localhost'}/api/webhook/meta`,
      verifyToken: config.verifyToken,
      hsmTemplates: {
        inicio: process.env.HSM_TEMPLATE_INICIO || 'hsmbra',
        avanco: process.env.HSM_TEMPLATE_AVANCO || 'hsmbrac',
        evento: process.env.HSM_TEMPLATE_EVENTO || 'hsmbraevent',
      },
      fluxoMatch: '2-etapas (handshake): hsmbra → associado → resposta → hsmbrac → empresa',
    });
  } catch (error) {
    return res.status(500).json({ error: 'Erro ao buscar status' });
  }
};

// ═══════════════════════════════════════════════════════════
// FUNÇÕES AUXILIARES
// ═══════════════════════════════════════════════════════════

async function handleStatusUpdate(status) {
  const statusMap = {
    'sent': '📤 Enviada',
    'delivered': '✅ Entregue',
    'read': '👀 Lida',
    'failed': '❌ Falhou',
  };

  const statusText = statusMap[status.status] || status.status;
  console.log(`📊 Status WhatsApp: ${statusText} (${status.recipient_id})`);

  // Sucesso: se essa mensagem é de um item da fila de retry, marca DELIVERED
  // pra parar de tentar de novo.
  if (status.status === 'delivered' || status.status === 'read') {
    try {
      const retryWorker = require('../services/whatsappRetryWorker');
      await retryWorker.markDeliveredByMessageId(status.id);
    } catch (err) {
      // Silencioso — pode ser msg sem item na fila (envio normal)
    }
  }

  // Falha: logar e tentar enfileirar retry persistente
  if (status.status === 'failed' && status.errors) {
    console.error('❌ WhatsApp delivery failed:', JSON.stringify(status.errors));

    const erro = status.errors[0] || {};
    const codigo = erro.code;

    await prisma.activityLog.create({
      data: {
        action: 'WHATSAPP_DELIVERY_FAILED',
        entity: 'WhatsApp',
        details: {
          recipientId: status.recipient_id,
          messageId: status.id,
          codigoErro: codigo,
          tituloErro: erro.title || null,
          mensagemErro: erro.message || null,
          errors: status.errors,
        },
      },
    }).catch(err => console.warn('Falha ao salvar activityLog:', err.message));

    // ─── ENFILEIRAR RETRY PERSISTENTE ───
    // 131049 e outros códigos recuperáveis vão pra tabela whatsapp_retry_queue.
    // Worker (whatsappRetryWorker) processa com backoff exponencial (30s, 1m, 2m,
    // 5m, 10m, 30m, 1h, 2h, 4h, 8h) até maxAttempts=10 ou DELIVERED.
    try {
      await whatsappService.enqueueRetryOnFailure(status.id, codigo, erro.message);
    } catch (err) {
      console.error('Erro ao enfileirar retry:', err.message);
    }
  }
}

// ═══════════════════════════════════════════════════════════
// DIAGNÓSTICO (GET /api/whatsapp/diagnostico)
// ═══════════════════════════════════════════════════════════
exports.diagnostico = async (req, res) => {
  const config = whatsappService.getConfig();
  const checks = [];

  checks.push({
    check: 'META_WHATSAPP_TOKEN',
    ok: !!config.accessToken,
    detail: config.accessToken ? `Configurado (${config.accessToken.substring(0, 15)}...)` : '❌ VAZIO'
  });

  checks.push({
    check: 'WHATSAPP_LINE_ID',
    ok: !!config.phoneNumberId,
    detail: config.phoneNumberId || '❌ VAZIO'
  });

  // ─── Conectividade com a Meta + business account ID ───
  let businessAccountId = null;
  if (config.accessToken && config.phoneNumberId) {
    try {
      const testUrl = `https://graph.facebook.com/v21.0/${config.phoneNumberId}?access_token=${config.accessToken}&fields=display_phone_number,verified_name,whatsapp_business_account`;
      const response = await fetch(testUrl);
      const data = await response.json();
      if (response.ok) {
        businessAccountId = data.whatsapp_business_account?.id;
        checks.push({
          check: 'Meta API',
          ok: true,
          detail: `Conectado · ${data.display_phone_number || data.id}${data.verified_name ? ' · ' + data.verified_name : ''}`,
        });
      } else {
        checks.push({
          check: 'Meta API',
          ok: false,
          detail: `Erro ${response.status}: ${data.error?.message || JSON.stringify(data)}`,
        });
      }
    } catch (err) {
      checks.push({ check: 'Meta API', ok: false, detail: `Erro de rede: ${err.message}` });
    }
  }

  // ─── Verificar templates HSM aprovados ───
  const templateInicio = process.env.HSM_TEMPLATE_INICIO || 'hsmbra';
  const templateAvanco = process.env.HSM_TEMPLATE_AVANCO || 'hsmbrac';
  const templateEvento = process.env.HSM_TEMPLATE_EVENTO || 'hsmbraevent';
  const templateEventoSinergiaInicio = process.env.HSM_TEMPLATE_EVENTO_SINERGIA_INICIO || 'hsm_evento_empresa_associado';
  const templateLang = process.env.HSM_TEMPLATE_LANGUAGE || 'pt_BR';

  if (config.accessToken && businessAccountId) {
    try {
      const tplUrl = `https://graph.facebook.com/v21.0/${businessAccountId}/message_templates?access_token=${config.accessToken}&fields=name,status,language&limit=200`;
      const r = await fetch(tplUrl);
      const data = await r.json();
      if (r.ok && Array.isArray(data.data)) {
        const findTpl = (name) => data.data.filter(t => t.name === name);
        for (const [name, label] of [
          [templateInicio, 'INÍCIO'],
          [templateAvanco, 'AVANÇO'],
          [templateEvento, 'EVENTO'],
          [templateEventoSinergiaInicio, 'EVENTO SINERGIA (etapa 1)'],
        ]) {
          const matches = findTpl(name);
          if (matches.length === 0) {
            checks.push({
              check: `Template ${label} ("${name}")`,
              ok: false,
              detail: `❌ Não existe na Meta. Cadastre/aprove no Business Manager.`,
            });
          } else {
            const approved = matches.find(t => t.status === 'APPROVED' && t.language === templateLang);
            if (approved) {
              checks.push({
                check: `Template ${label} ("${name}")`,
                ok: true,
                detail: `✅ APPROVED em ${templateLang}`,
              });
            } else {
              const statuses = matches.map(t => `${t.language}:${t.status}`).join(', ');
              checks.push({
                check: `Template ${label} ("${name}")`,
                ok: false,
                detail: `Encontrado mas não APPROVED em ${templateLang}. Status atuais: ${statuses}`,
              });
            }
          }
        }
      } else {
        checks.push({
          check: `Templates HSM`,
          ok: false,
          detail: `Erro ao listar templates: ${data.error?.message || r.status}`,
        });
      }
    } catch (err) {
      checks.push({ check: 'Templates HSM', ok: false, detail: `Erro de rede: ${err.message}` });
    }
  } else if (!businessAccountId && config.accessToken && config.phoneNumberId) {
    checks.push({
      check: 'Templates HSM',
      ok: false,
      detail: 'Não foi possível obter o business_account_id — verifique permissões do token (precisa de whatsapp_business_management).',
    });
  }

  try {
    const empresasComTel = await prisma.empresa.count({ where: { telefone: { not: null } } });
    const assocComTel = await prisma.associado.count({ where: { OR: [{ whatsapp: { not: null } }, { telefone: { not: null } }] } });
    checks.push({ check: 'Empresas com telefone', ok: empresasComTel > 0, detail: `${empresasComTel}` });
    checks.push({ check: 'Associados com tel/whatsapp', ok: assocComTel > 0, detail: `${assocComTel}` });
  } catch (e) { /* ignore */ }

  const allOk = checks.every(c => c.ok);
  return res.json({
    status: allOk ? '✅ OK' : '⚠️ Problemas',
    templates: {
      inicio: templateInicio,
      avanco: templateAvanco,
      evento: templateEvento,
      eventoSinergiaInicio: templateEventoSinergiaInicio,
      language: templateLang,
    },
    checks,
  });
};

// ═══════════════════════════════════════════════════════════
// TESTE DE ENVIO (POST /api/whatsapp/test)
// Body: { to: "5511999999999" }
// ═══════════════════════════════════════════════════════════
exports.testSend = async (req, res) => {
  try {
    const { to } = req.body;
    if (!to) return res.status(400).json({ error: 'Campo "to" obrigatório (ex: 5511999999999)' });

    const result = await whatsappService.sendTextMessage(to,
      '🎯 BRATECC Connect AI - Teste!\n\nSe recebeu esta mensagem, a integração WhatsApp está funcionando.'
    );

    return res.json({
      success: result.success,
      messageId: result.messageId,
      error: result.error,
      debug: { to, hasToken: !!process.env.META_WHATSAPP_TOKEN, lineId: process.env.WHATSAPP_LINE_ID }
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════
// FILA DE RETRY (admin)
// ═══════════════════════════════════════════════════════════

// GET /api/whatsapp/retry-queue → listar itens (filtros: status, limit)
exports.listRetryQueue = async (req, res) => {
  try {
    const { status, limit = 50 } = req.query;
    const where = {};
    if (status) where.status = status.toUpperCase();

    const items = await prisma.whatsappRetryQueue.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(parseInt(limit) || 50, 200),
    });

    const retryWorker = require('../services/whatsappRetryWorker');
    const stats = await retryWorker.getQueueStats();

    return res.json({ stats, items });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// POST /api/whatsapp/retry-queue/:id/force → forçar retry imediato
exports.forceRetryQueueItem = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const item = await prisma.whatsappRetryQueue.findUnique({ where: { id } });
    if (!item) return res.status(404).json({ error: 'Item não encontrado' });

    await prisma.whatsappRetryQueue.update({
      where: { id },
      data: {
        status: 'PENDING',
        nextAttemptAt: new Date(),
      },
    });

    // Trigger worker imediato (próximo tick em <30s, mas força)
    const retryWorker = require('../services/whatsappRetryWorker');
    retryWorker.processBatch().catch(() => {});

    return res.json({ success: true, message: 'Item reagendado para processamento imediato.' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// POST /api/whatsapp/retry-queue/:id/abandon → marcar como ABANDONED manualmente
exports.abandonRetryQueueItem = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await prisma.whatsappRetryQueue.update({
      where: { id },
      data: { status: 'ABANDONED', completedAt: new Date() },
    });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

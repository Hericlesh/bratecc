// ═══════════════════════════════════════════════════════════
// BRATECC Connect AI - Serviço WhatsApp (Meta Cloud API)
// ═══════════════════════════════════════════════════════════
//
// Integração com WhatsApp Business Platform da Meta
// Docs: https://developers.facebook.com/docs/whatsapp/cloud-api
//
// ═══════════════════════════════════════════════════════════

const prisma = require('../config/database');
const { callGemini } = require('./aiService');
const hsmTemplates = require('./hsmTemplates');

const META_API_VERSION = 'v21.0';
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

// ─── CLASSIFICAR INTENÇÃO VIA LLM ───
// ═══════════════════════════════════════════════════════════
// EXPLICAÇÃO DO QUE É A BRATECC CONNECT
// ═══════════════════════════════════════════════════════════
// A IA precisa estar sempre pronta pra responder "o que é o BRATECC?", "como
// funciona?", "vocês cobram?" durante qualquer etapa do fluxo. Quando isso
// acontece, respondemos de forma contextual, sem perder o estado da conversa.

const SOBRE_BRATECC_BASE = `A BRATECC Connect é uma plataforma da Câmara Brasil-Texas (BRATECC) que conecta empresas brasileiras a associados qualificados para gerar oportunidades reais de negócio entre Brasil e Texas (EUA).

Como funciona na prática:
1. Empresas e associados se cadastram com seu perfil (setor, produtos, serviços, necessidades).
2. A nossa IA cruza esses perfis e identifica combinações com alto potencial de gerar negócio.
3. Quando há sinergia, fazemos a aproximação por aqui no WhatsApp — sem custo, sem fila de email.
4. Se ambas as partes confirmam interesse, a BRATECC libera o contato direto para que as partes finalizem a conversa de negócio diretamente.`;

// Detecta se a mensagem é uma pergunta genérica sobre o BRATECC (e não uma
// resposta ao fluxo atual). Usa Gemini com prompt específico.
async function detectarPerguntaSobreBratecc(mensagem) {
  const prompt = `Analise a mensagem do usuário e responda apenas "sim" ou "nao".

A mensagem é uma PERGUNTA sobre o que é a BRATECC, como ela funciona, se cobra, quem são, ou similar?

Exemplos que SÃO pergunta sobre a BRATECC:
- "o que é isso"
- "o que é bratecc"
- "como funciona"
- "vocês cobram alguma coisa?"
- "quem é vocês?"
- "essa empresa é confiável?"
- "isso é gratuito?"
- "vou ter custo?"
- "que serviço é esse"

Exemplos que NÃO são pergunta sobre a BRATECC:
- "sim"
- "pode apresentar"
- "tenho interesse"
- "pula essa"
- "manda detalhes da empresa"
- "quero falar com eles"

Mensagem: "${mensagem}"

Responda apenas "sim" ou "nao".`;

  try {
    const resposta = await callGemini(prompt);
    const norm = resposta.trim().toLowerCase();
    return norm.startsWith('sim');
  } catch (err) {
    console.warn('[detectarPerguntaSobreBratecc] erro:', err.message);
    return false;
  }
}

// Gera resposta contextual sobre o BRATECC, considerando em qual etapa do
// fluxo o usuário está. Mantém a mensagem do BRATECC base + dica de retomada
// pra puxar o usuário de volta pro ponto onde estava.
function responderSobreBratecc(state) {
  const partes = [SOBRE_BRATECC_BASE];

  // Sufixo contextual conforme onde a pessoa está
  const item = state?.matches?.[state.matchIndex];
  if (item) {
    if (item.etapa === 'aguardando_segundo') {
      partes.push(`\nVoltando ao seu caso: *${item.outraParte.nome}* demonstrou interesse em se conectar com vocês. Vocês autorizam que a BRATECC faça essa intermediação?`);
    } else if (state.step === 'apresentar_match' || state.step === 'detalhes') {
      partes.push(`\nE sobre a oportunidade com *${item.outraParte.nome}*: faz sentido pra você?`);
    } else if (state.step === 'pos_interesse') {
      partes.push(`\nVocê quer ver as outras oportunidades pendentes ou prefere encerrar por aqui?`);
    } else {
      partes.push(`\nPosso te apresentar as oportunidades agora?`);
    }
  } else {
    partes.push(`\nPosso te apresentar as oportunidades agora?`);
  }

  return partes.join('\n');
}

async function classificarIntencao(mensagem, opcoes, contexto = '') {
  // Glossário com exemplos pra cada intenção possível. Ajuda o Gemini a
  // entender expressões coloquiais e ambíguas.
  const exemplosPorIntencao = {
    confirmar: ['sim', 'pode sim', 'claro', 'beleza', 'ok', 'fechado', 'pode mandar', 'manda aí', 'tá bom', 'top', 'isso mesmo'],
    voltar: ['volta', 'voltar', 'antes', 'esquece', 'cancela', 'não'],
    aceitar: ['sim', 'pode apresentar', 'manda', 'mostra', 'pode', 'claro', 'beleza', 'to dentro', 'pode mandar', 'quero ver', 'mostra aí', 'manda aí'],
    recusar: ['não', 'agora não', 'depois', 'mais tarde', 'sem interesse', 'não quero', 'não obrigado'],
    pergunta: ['o que é isso', 'como funciona', 'quem é vocês', 'que tipo de empresa', 'o que vocês fazem'],
    interesse: ['quero conectar', 'tenho interesse', 'pode seguir', 'fechar', 'quero esse', 'me interessa', 'gostei', 'pode fechar', 'quero', 'topo', 'quero falar', 'me conecta', 'me apresenta'],
    detalhes: ['detalhes', 'mais informações', 'me conta mais', 'o que eles fazem', 'quero saber mais', 'fala mais sobre', 'descreve melhor'],
    pular: ['pula', 'próximo', 'próxima', 'outra opção', 'tem outra', 'não esse', 'esse não', 'mostra outra', 'quero outra', 'next'],
  };

  const opcoesComExemplos = opcoes.map(o => {
    const exemplos = exemplosPorIntencao[o.toLowerCase()];
    return `- "${o}"${exemplos ? ` — exemplos: ${exemplos.slice(0, 6).map(e => `"${e}"`).join(', ')}` : ''}`;
  }).join('\n');

  const prompt = `Você é um classificador de intenções de WhatsApp. Analise a mensagem do usuário no contexto da conversa e classifique em UMA das opções abaixo.

${contexto ? `CONTEXTO DA CONVERSA: ${contexto}\n` : ''}
OPÇÕES POSSÍVEIS:
${opcoesComExemplos}

REGRAS IMPORTANTES:
1. Use o CONTEXTO acima pra desambiguar — a mesma palavra pode significar coisas diferentes em contextos diferentes.
2. "pode seguir", "pode fechar", "vamos lá", "fechado", "topo" geralmente indicam INTERESSE em prosseguir com a conexão atual, NÃO pular pra outra.
3. "pular", "próximo", "outra" claramente pedem PULAR pra próxima opção.
4. Em dúvida real entre duas opções, escolha a que indica continuar/avançar com o que está sendo discutido.

MENSAGEM DO USUÁRIO: "${mensagem}"

Responda APENAS com o nome exato da opção escolhida (sem aspas, sem explicação). Se realmente nenhuma opção se encaixar, responda "indefinido".`;

  try {
    const resposta = await callGemini(prompt);
    const intencao = resposta.trim().toLowerCase();

    // Match flexível — busca a primeira opção cujo nome aparece na resposta
    let match = opcoes.find(o => intencao.includes(o.toLowerCase()));

    // Heurística adicional: se o Gemini retornou indefinido ou texto longo,
    // tentar match por sinônimos exatos.
    if (!match) {
      for (const opcao of opcoes) {
        const sinList = exemplosPorIntencao[opcao.toLowerCase()] || [];
        if (sinList.some(s => intencao === s.toLowerCase() || intencao.includes(s.toLowerCase()))) {
          match = opcao;
          break;
        }
      }
    }

    const resultado = match || 'indefinido';
    console.log(`[classificarIntencao] msg="${mensagem}" → resposta_gemini="${intencao}" → classificado="${resultado}" (opcoes=[${opcoes.join(',')}])`);
    return resultado;
  } catch (error) {
    console.error('[classificarIntencao] Erro:', error.message);
    return 'indefinido';
  }
}

// ─── CONFIGURAÇÃO ───
function getConfig() {
  return {
    accessToken: process.env.META_WHATSAPP_TOKEN,
    phoneNumberId: process.env.WHATSAPP_LINE_ID,
    verifyToken: process.env.META_VERIFY_TOKEN || 'bratecc-verify-token-2026',
  };
}

// ─── ENVIAR MENSAGEM DE TEXTO ───
async function sendTextMessage(to, text) {
  const config = getConfig();

  if (!config.accessToken || !config.phoneNumberId) {
    console.warn('⚠️  WhatsApp Meta não configurado (META_WHATSAPP_TOKEN ou WHATSAPP_LINE_ID ausente). Mensagem não enviada.');
    return { success: false, error: 'WhatsApp não configurado (token ou phone number ID ausente)' };
  }

  const phoneNorm = normalizePhone(to);
  console.log(`📞 [WhatsApp text] → ${phoneNorm} (${text.length} chars)`);

  try {
    const response = await fetch(
      `${META_API_BASE}/${config.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: phoneNorm,
          type: 'text',
          text: { preview_url: false, body: text },
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      const errMsg = data.error?.message || JSON.stringify(data);
      const errCode = data.error?.code;
      const errSubcode = data.error?.error_subcode;
      console.error(`❌ Meta API recusou texto livre para ${phoneNorm}: HTTP ${response.status} · code=${errCode} subcode=${errSubcode} · ${errMsg}`);
      if (errCode === 131047 || errCode === 131056 || /24/.test(errMsg) && /window/i.test(errMsg)) {
        console.error('   ↳ Janela de 24h fechada. Texto livre só é permitido se o destinatário enviou mensagem nas últimas 24h. Use template HSM aprovado.');
      }
      if (errCode === 131026) {
        console.error('   ↳ Número não está no WhatsApp ou bloqueou o Business.');
      }
      if (errCode === 190 || /OAuthException|access token/i.test(errMsg)) {
        console.error('   ↳ Token inválido/expirado. Renove META_WHATSAPP_TOKEN no Business Manager.');
      }
      await logWhatsApp(to, text, 'error', data);
      return { success: false, error: errMsg, code: errCode, raw: data };
    }

    console.log(`✅ Texto livre enviado para ${phoneNorm} · message_id=${data.messages?.[0]?.id}`);
    await logWhatsApp(to, text, 'sent', data);
    return { success: true, messageId: data.messages?.[0]?.id, data };
  } catch (error) {
    console.error(`❌ Erro de rede ao enviar texto para ${phoneNorm}:`, error.message);
    await logWhatsApp(to, text, 'error', { error: error.message });
    return { success: false, error: error.message };
  }
}

// ─── ENVIAR TEMPLATE (mensagens aprovadas pela Meta) ───
async function sendTemplate(to, templateName, languageCode = 'pt_BR', components = []) {
  const config = getConfig();

  if (!config.accessToken || !config.phoneNumberId) {
    return { success: false, error: 'WhatsApp não configurado (token ou phone number ID ausente)' };
  }

  const phoneNorm = normalizePhone(to);
  console.log(`📞 [WhatsApp template "${templateName}" / ${languageCode}] → ${phoneNorm}`);

  try {
    const body = {
      messaging_product: 'whatsapp',
      to: phoneNorm,
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
      },
    };

    if (components.length > 0) {
      body.template.components = components;
    }

    const response = await fetch(
      `${META_API_BASE}/${config.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      const errMsg = data.error?.message || JSON.stringify(data);
      const errCode = data.error?.code;
      console.error(`❌ Meta API recusou template "${templateName}" para ${phoneNorm}: HTTP ${response.status} · code=${errCode} · ${errMsg}`);
      if (errCode === 132001 || /template name does not exist|does not exist in the translation/i.test(errMsg)) {
        console.error(`   ↳ Template "${templateName}" não existe ou não foi aprovado em ${languageCode}. Cadastre/aprove no Meta Business Manager.`);
      }
      if (errCode === 132000 || /number of parameters/i.test(errMsg)) {
        console.error(`   ↳ Quantidade ou nome dos parâmetros não bate com o aprovado na Meta. Verifique os {{nome}}, {{segmento}}, {{produtos_servico}}.`);
      }
      if (errCode === 131026) {
        console.error('   ↳ Número não está no WhatsApp ou bloqueou o Business.');
      }
      if (errCode === 190 || /OAuthException|access token/i.test(errMsg)) {
        console.error('   ↳ Token inválido/expirado. Renove META_WHATSAPP_TOKEN no Business Manager.');
      }
      return { success: false, error: errMsg, code: errCode, raw: data };
    }

    console.log(`✅ Template "${templateName}" enviado para ${phoneNorm} · message_id=${data.messages?.[0]?.id}`);
    return { success: true, messageId: data.messages?.[0]?.id, data };
  } catch (error) {
    console.error(`❌ Erro de rede ao enviar template "${templateName}":`, error.message);
    return { success: false, error: error.message };
  }
}

// ─── ENVIAR MENSAGEM INTERATIVA (botões) ───
async function sendInteractiveButtons(to, bodyText, buttons, headerText = null) {
  const config = getConfig();

  if (!config.accessToken || !config.phoneNumberId) {
    return { success: false, error: 'WhatsApp não configurado' };
  }

  const interactive = {
    type: 'button',
    body: { text: bodyText },
    action: {
      buttons: buttons.map((btn, i) => ({
        type: 'reply',
        reply: { id: btn.id || `btn_${i}`, title: btn.title.substring(0, 20) },
      })),
    },
  };

  if (headerText) {
    interactive.header = { type: 'text', text: headerText };
  }

  try {
    const response = await fetch(
      `${META_API_BASE}/${config.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: normalizePhone(to),
          type: 'interactive',
          interactive,
        }),
      }
    );

    const data = await response.json();
    if (!response.ok) {
      return { success: false, error: data };
    }
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ─── MARCAR COMO LIDA ───
async function markAsRead(messageId) {
  const config = getConfig();
  if (!config.accessToken || !config.phoneNumberId) return;

  try {
    await fetch(`${META_API_BASE}/${config.phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      }),
    });
  } catch (error) {
    console.error('Erro ao marcar como lida:', error.message);
  }
}

// ═══════════════════════════════════════════════════════════
// PROCESSAMENTO DE MENSAGENS RECEBIDAS (Webhook)
// Fluxo: Fechar matches entre Empresas e Associados
// ═══════════════════════════════════════════════════════════

// Estado das conversas em andamento (em produção usar Redis)
const conversationStates = new Map();

// ─── CACHE LEVE DE HSMs ENVIADOS ───
// Cache em memória pra rastrear context dos envios recentes — usado quando
// o webhook reporta failed e precisamos enfileirar retry persistente. TTL
// curto (5min) só pra cobrir o gap entre envio e webhook de status.
const hsmSendCache = new Map();
const HSM_CACHE_TTL_MS = 5 * 60 * 1000;

function recordHSMSend(messageId, ctx) {
  if (!messageId) return;
  hsmSendCache.set(messageId, { ...ctx, savedAt: Date.now() });
  // Limpa entradas antigas oportunisticamente
  for (const [k, v] of hsmSendCache.entries()) {
    if (Date.now() - v.savedAt > HSM_CACHE_TTL_MS) {
      hsmSendCache.delete(k);
    }
  }
}

function getHSMSendContext(messageId) {
  return messageId ? hsmSendCache.get(messageId) : null;
}

// ─── IDENTIFICAR REMETENTE PELO TELEFONE ───
async function identificarRemetente(phone) {
  const phoneNorm = normalizePhone(phone);

  // Buscar em todas as empresas e comparar números normalizados
  const empresas = await prisma.empresa.findMany({
    where: { telefone: { not: null } },
  });

  for (const emp of empresas) {
    const empNorm = normalizePhone(emp.telefone || '');
    if (empNorm.length >= 8 && phoneNorm.endsWith(empNorm.slice(-8))) {
      return { tipo: 'empresa', entidade: emp };
    }
  }

  // Buscar em todos os associados e comparar números normalizados
  const associados = await prisma.associado.findMany({
    where: {
      OR: [
        { whatsapp: { not: null } },
        { telefone: { not: null } },
      ],
    },
  });

  for (const assoc of associados) {
    const waNorm = normalizePhone(assoc.whatsapp || '');
    const telNorm = normalizePhone(assoc.telefone || '');
    if (waNorm.length >= 8 && phoneNorm.endsWith(waNorm.slice(-8))) {
      return { tipo: 'associado', entidade: assoc };
    }
    if (telNorm.length >= 8 && phoneNorm.endsWith(telNorm.slice(-8))) {
      return { tipo: 'associado', entidade: assoc };
    }
  }

  return null;
}

// ─── BUSCAR MATCHES PENDENTES (Assoc×Empresa + B2B, com etapa) ───
// Retorna lista unificada de "interações pendentes" para esta entidade.
// Cada item carrega `matchType` ('match' | 'matchB2B') e `etapa`
// ('aguardando_primeiro' | 'aguardando_segundo') para que o handler
// saiba qual transição de status fazer e se precisa disparar HSM avanço.
//
// Regras (status do enum: PENDING/CONTACTED/INTERESTED/CONFIRMED/REJECTED):
//
//   Match (Assoc × Empresa):
//     • status PENDING/CONTACTED + tipo='associado' → primeiro contato
//       (associado é quem decide. Se aceitar → INTERESTED + HSM avanço pra empresa)
//     • status INTERESTED + tipo='empresa' → segundo contato
//       (empresa é quem decide. Se aceitar → CONFIRMED)
//
//   MatchB2B:
//     • status PENDING/CONTACTED + entidade é o associadoOrigem → primeiro contato
//     • status INTERESTED + entidade é o associadoDestino → segundo contato
//
async function buscarMatchesPendentes(tipo, entidadeId) {
  const items = [];

  // ── Match Assoc × Empresa ──
  if (tipo === 'associado') {
    const matches = await prisma.match.findMany({
      where: {
        associadoId: entidadeId,
        status: { in: ['PENDING', 'CONTACTED'] },
      },
      include: { empresa: true, associado: true },
      orderBy: { score: 'desc' },
    });
    for (const m of matches) {
      items.push({
        matchType: 'match',
        etapa: 'aguardando_primeiro',
        id: m.id,
        score: m.score,
        produto: m.produto,
        observacoes: m.observacoes,
        analiseIA: m.analiseIA,
        empresa: m.empresa,
        associado: m.associado,
        // outraParte: quem aparece pro usuário como "a empresa que demonstrou interesse"
        outraParte: m.empresa,
      });
    }
  } else if (tipo === 'empresa') {
    const matches = await prisma.match.findMany({
      where: {
        empresaId: entidadeId,
        status: 'INTERESTED',
      },
      include: { empresa: true, associado: true },
      orderBy: { score: 'desc' },
    });
    for (const m of matches) {
      items.push({
        matchType: 'match',
        etapa: 'aguardando_segundo',
        id: m.id,
        score: m.score,
        produto: m.produto,
        observacoes: m.observacoes,
        analiseIA: m.analiseIA,
        empresa: m.empresa,
        associado: m.associado,
        outraParte: m.associado,
      });
    }
  }

  // ── MatchB2B (Assoc × Assoc) ──
  if (tipo === 'associado') {
    // Origem aguardando primeiro contato
    const b2bOrigem = await prisma.matchB2B.findMany({
      where: {
        associadoOrigem: entidadeId,
        status: { in: ['PENDING', 'CONTACTED'] },
      },
      include: { origem: true, destino: true },
      orderBy: { score: 'desc' },
    });
    for (const m of b2bOrigem) {
      items.push({
        matchType: 'matchB2B',
        etapa: 'aguardando_primeiro',
        id: m.id,
        score: m.score,
        produto: m.servicoDestino || m.servicoOrigem,
        observacoes: m.sinergia,
        origem: m.origem,
        destino: m.destino,
        // Pro usuário (origem), a "outra parte" é o destino
        outraParte: m.destino,
      });
    }

    // Destino aguardando segundo contato (origem já aceitou)
    const b2bDestino = await prisma.matchB2B.findMany({
      where: {
        associadoDestino: entidadeId,
        status: 'INTERESTED',
      },
      include: { origem: true, destino: true },
      orderBy: { score: 'desc' },
    });
    for (const m of b2bDestino) {
      items.push({
        matchType: 'matchB2B',
        etapa: 'aguardando_segundo',
        id: m.id,
        score: m.score,
        produto: m.servicoOrigem || m.servicoDestino,
        observacoes: m.sinergia,
        origem: m.origem,
        destino: m.destino,
        // Pro usuário (destino), a "outra parte" é a origem
        outraParte: m.origem,
      });
    }
  }

  // ── MatchVaga (Candidato × Vaga) ──
  // Apenas o associado (dono da vaga) entra no fluxo de conversa via WhatsApp.
  // O candidato só é contatado depois (etapa 2 / hsmbrac), então não precisa
  // estado de conversa pra ele inicialmente.
  if (tipo === 'associado') {
    const matchesVaga = await prisma.matchVaga.findMany({
      where: {
        vaga: { associadoId: entidadeId },
        status: { in: ['PENDING', 'CONTACTED'] },
      },
      include: {
        candidato: { include: { universidade: true } },
        vaga: true,
      },
      orderBy: { score: 'desc' },
    });
    for (const m of matchesVaga) {
      items.push({
        matchType: 'matchVaga',
        etapa: 'aguardando_primeiro',
        id: m.id,
        score: m.score,
        produto: m.vaga.titulo,                    // título da vaga vira "produto"
        observacoes: m.observacoes,
        analiseIA: m.analiseIA,
        candidato: m.candidato,
        vaga: m.vaga,
        // Pro usuário (associado), a "outra parte" é o candidato
        outraParte: m.candidato,
      });
    }
  }

  // Ordenar todos por score desc
  items.sort((a, b) => (b.score || 0) - (a.score || 0));
  return items;
}

// ─── PROCESSAR MENSAGEM RECEBIDA ───
async function processIncomingMessage(message, contact) {
  const from = message.from;
  const msgBody = message.text?.body?.trim() || '';
  const contactName = contact?.profile?.name || 'Desconhecido';

  console.log(`📩 Mensagem de ${contactName} (${from}): "${msgBody}"`);

  // Marcar como lida
  if (message.id) {
    await markAsRead(message.id);
  }

  // Buscar estado existente da conversa
  let state = conversationStates.get(from) || null;

  // Timeout de 30 min — reinicia conversa
  if (state && Date.now() - state.lastActivity > 30 * 60 * 1000) {
    state = null;
    conversationStates.delete(from);
  }

  // Se não há estado, identificar quem é e iniciar
  if (!state) {
    const remetente = await identificarRemetente(from);

    if (!remetente) {
      await sendTextMessage(from,
        `*BRATECC Connect*\n\nOlá! Não encontrei seu número cadastrado no nosso sistema.\n\nSe você é um associado ou empresa parceira da BRATECC, entre em contato com admin@bratecc.com para verificar seu cadastro.`
      );
      return;
    }

    // ─── CONVITES DE EVENTO PENDENTES ───
    // Antes de tentar mostrar matches, verificamos se a empresa/associado tem
    // convite pra evento aguardando confirmação de presença (confirmado=false).
    // Se tem, a conversa entra no fluxo de confirmação de presença, que tem
    // deadline (data do evento) e prioridade sobre apresentações de match.
    if (remetente.tipo === 'empresa') {
      const convitesPendentes = await prisma.eventoParticipante.findMany({
        where: {
          empresaId: remetente.entidade.id,
          confirmado: false,
        },
        include: { evento: true },
        orderBy: { createdAt: 'desc' },
      });
      // Filtra só eventos futuros ou sem data definida
      const conviteAtivo = convitesPendentes.find(c => {
        if (!c.evento.data) return true;
        return new Date(c.evento.data) >= new Date(Date.now() - 24 * 60 * 60 * 1000); // tolerância 1 dia passado
      });
      if (conviteAtivo) {
        state = {
          step: 'evento_confirm_presenca',
          remetente,
          eventoId: conviteAtivo.eventoId,
          evento: conviteAtivo.evento,
          lastActivity: Date.now(),
        };
        conversationStates.set(from, state);
        await sendTextMessage(from,
          `Olá, *${remetente.entidade.nome}*. Aqui é a assistente da BRATECC Connect.\n\nVocê foi convidado(a) para o evento *${conviteAtivo.evento.nome}*${conviteAtivo.evento.data ? ` em ${new Date(conviteAtivo.evento.data).toLocaleDateString('pt-BR')}` : ''}${conviteAtivo.evento.local ? `, em ${conviteAtivo.evento.local}` : ''}.\n\nVocês confirmam presença?`
        );
        return;
      }
    }

    // Buscar matches pendentes
    const matches = await buscarMatchesPendentes(remetente.tipo, remetente.entidade.id);

    if (matches.length === 0) {
      await sendTextMessage(from,
        `*BRATECC Connect*\n\nOlá, *${remetente.entidade.nome}*.\n\nNo momento não identificamos novas oportunidades de negócio para o seu perfil. Assim que surgir algo relevante, entraremos em contato.\n\nObrigado.`
      );
      return;
    }

    state = {
      step: 'intro',
      remetente,
      matches,
      matchIndex: 0,
      lastActivity: Date.now(),
    };
    conversationStates.set(from, state);

    // ─── DETECÇÃO DE ETAPA 2 (handshake fechando) ───
    // Se TODOS os matches estão em aguardando_segundo, isso significa que
    // este usuário é alguém que recebeu hsmbrac (a outra parte demonstrou
    // interesse). Aqui não precisa de intro genérica de "Aqui é a BRATECC..."
    // — pulamos direto pra apresentação contextual do match.
    const todosEtapaSegundo = matches.every(m => m.etapa === 'aguardando_segundo');
    if (todosEtapaSegundo) {
      await apresentarMatch(from, state);
      return;
    }

    const total = matches.length;
    const tipoLabel = remetente.tipo === 'empresa' ? 'associados especializados' : 'empresas';
    await sendTextMessage(from,
      `*BRATECC Connect*\n\nOlá, *${remetente.entidade.nome}*.\n\nAqui é a assistente da BRATECC Connect. Nós conectamos empresas e associados para gerar oportunidades reais de negócio no eixo Brasil-Texas.\n\nAnalisamos o seu perfil e identificamos *${total}* ${total > 1 ? 'oportunidades' : 'oportunidade'} com ${tipoLabel} que têm sinergia com a sua atuação.\n\nPosso te apresentar agora?`
    );
    return;
  }

  state.lastActivity = Date.now();
  const buttonReply = message.interactive?.button_reply?.id || null;

  // ─── INTERCEPTAR PERGUNTAS SOBRE A BRATECC ───
  // Em qualquer etapa do fluxo, se o usuário fizer uma pergunta sobre o que
  // é a BRATECC, como funciona, se cobra etc, respondemos imediatamente e
  // retomamos a conversa de onde estava (mantemos state.step intacto).
  // Não interceptamos quando vem buttonReply — botão é resposta direta.
  if (msgBody && !buttonReply) {
    try {
      const ehPerguntaSobreBratecc = await detectarPerguntaSobreBratecc(msgBody);
      if (ehPerguntaSobreBratecc) {
        console.log(`[processIncomingMessage] Pergunta sobre BRATECC detectada (step=${state.step}). Respondendo e retomando.`);
        await sendTextMessage(from, responderSobreBratecc(state));
        conversationStates.set(from, state); // só salva timestamp atualizado
        return;
      }
    } catch (err) {
      console.warn('[processIncomingMessage] erro ao detectar pergunta sobre BRATECC:', err.message);
      // Segue o fluxo normal se a detecção falhar
    }
  }

  // ─── FLUXO DE FECHAMENTO DE MATCH ───
  try {
    switch (state.step) {
      case 'intro':
        await handleIntro(from, msgBody, state);
        break;

      case 'apresentar_match':
        await handleRespostaMatch(from, msgBody, buttonReply, state);
        break;

      case 'detalhes':
        await handleDetalhes(from, msgBody, buttonReply, state);
        break;

      case 'confirmacao':
        await handleConfirmacao(from, msgBody, buttonReply, state);
        break;

      case 'pos_interesse':
        await handlePosInteresse(from, msgBody, state);
        break;

      case 'evento_confirm_presenca':
        await handleEventoConfirmPresenca(from, msgBody, state);
        break;

      case 'concluido':
        await sendTextMessage(from,
          `Obrigado. Todos os seus matches já foram processados. Quando houver novas oportunidades, entraremos em contato.\n\nQualquer dúvida: admin@bratecc.com`
        );
        conversationStates.delete(from);
        return;

      default:
        // Reiniciar
        conversationStates.delete(from);
        await processIncomingMessage(message, contact);
        return;
    }

    conversationStates.set(from, state);
  } catch (error) {
    console.error('❌ Erro no processamento:', error);
    await sendTextMessage(from,
      `⚠️ Desculpe, ocorreu um erro. Tente novamente em instantes.\n\nSe o problema persistir, contate admin@bratecc.com`
    );
  }
}

// ═══════════════════════════════════════════════════════════
// HANDLERS DO FLUXO DE FECHAMENTO DE MATCH
// ═══════════════════════════════════════════════════════════

// ─── HANDLER DA INTRODUÇÃO ───
async function handleIntro(from, msgBody, state) {
  const intencao = await classificarIntencao(
    msgBody,
    ['aceitar', 'recusar', 'pergunta'],
    'A IA se apresentou e perguntou se pode mostrar oportunidades de negócio. O usuário respondeu.'
  );

  if (intencao === 'aceitar') {
    await apresentarMatch(from, state);
    return;
  }

  if (intencao === 'recusar') {
    await sendTextMessage(from,
      `Sem problemas. Quando quiser ver as oportunidades, é só nos mandar uma mensagem.\n\nObrigado, *${state.remetente.entidade.nome}*.`
    );
    conversationStates.delete(from);
    return;
  }

  // Pergunta ou indefinido — explicar o que é a BRATECC com texto unificado
  await sendTextMessage(from, responderSobreBratecc(state));
}

// ─── APRESENTAR O MATCH ATUAL ───
// Funciona para item.matchType ∈ {'match', 'matchB2B'} e ambas as etapas.
//
// Etapa 1 (aguardando_primeiro): apresenta a outra parte como uma OPORTUNIDADE
//   identificada pela IA. Pergunta se a pessoa quer conectar.
//
// Etapa 2 (aguardando_segundo): a outra parte JÁ demonstrou interesse — esse
//   é o handshake fechando. Apresenta como "X demonstrou interesse em
//   conectar com vocês" e pede AUTORIZAÇÃO da empresa pra fazer o contato.
async function apresentarMatch(from, state) {
  const item = state.matches[state.matchIndex];
  const outraParte = item.outraParte;
  const matchNum = state.matchIndex + 1;
  const totalMatches = state.matches.length;
  const remetenteNome = state.remetente.entidade.nome;

  // ─── ETAPA 2: handshake fechando — mensagem contextual diferente ───
  if (item.etapa === 'aguardando_segundo') {
    const detalhes = [];
    if (item.matchType === 'matchB2B') {
      detalhes.push(`*Segmento:* ${outraParte.segmento || 'Diversos'}`);
    } else {
      // Item.match: outraParte é o Associado
      detalhes.push(`*Segmento:* ${outraParte.segmento || 'Diversos'}`);
      if (outraParte.servicos) {
        const servPrincipal = outraParte.servicos.split(',')[0].trim();
        if (servPrincipal) detalhes.push(`*Atua com:* ${servPrincipal}`);
      }
    }
    if (item.produto) {
      detalhes.push(`*Sinergia identificada:* ${item.produto}`);
    }

    const partes = [
      `Olá, *${remetenteNome}*.`,
      ``,
      `*${outraParte.nome}* demonstrou interesse em se conectar com vocês através da BRATECC Connect.`,
      ``,
      ...detalhes,
      ``,
      `*O que isso significa na prática:*`,
      `Se vocês autorizarem, a BRATECC vai liberar o contato direto entre as partes para que vocês finalizem essa conversa de negócio diretamente. Quem decide o ritmo, formato e termos do contato são vocês.`,
    ];

    if (totalMatches > 1) {
      partes.push(``, `_Esta é a oportunidade ${matchNum} de ${totalMatches} aguardando sua confirmação._`);
    }

    partes.push(``, `Vocês permitem que *${outraParte.nome}* entre em contato com vocês para dar continuidade?`);

    state.step = 'apresentar_match';
    await sendTextMessage(from, partes.join('\n'));
    return;
  }

  // ─── ETAPA 1: apresentação de oportunidade (fluxo original) ───
  let descricao;
  if (item.matchType === 'matchVaga') {
    // Apresenta candidato pro associado (dono da vaga). Resumo do CV.
    const cand = item.candidato;
    const detalhesCV = [];
    if (cand.curso) detalhesCV.push(`Curso: ${cand.curso}`);
    if (cand.periodo) detalhesCV.push(`Período: ${cand.periodo}`);
    if (cand.disponibilidade) detalhesCV.push(`Disponibilidade: ${cand.disponibilidade}`);
    if (cand.idiomas) detalhesCV.push(`Idiomas: ${cand.idiomas}`);
    if (cand.habilidades) {
      const hab = cand.habilidades.length > 120 ? cand.habilidades.substring(0, 120) + '...' : cand.habilidades;
      detalhesCV.push(`Habilidades: ${hab}`);
    }
    if (cand.universidade?.nome) detalhesCV.push(`Universidade: ${cand.universidade.nome}${cand.universidade.sigla ? ` (${cand.universidade.sigla})` : ''}`);

    descricao = [
      `*Candidato:* ${cand.nome}`,
      ``,
      ...detalhesCV,
      ``,
      `*Para a vaga:* ${item.vaga.titulo}`,
      `*Compatibilidade:* ${item.score}%`,
    ];
  } else if (item.matchType === 'matchB2B') {
    descricao = [
      `*${outraParte.nome}*`,
      `Segmento: ${outraParte.segmento || 'Diversos'}`,
      item.produto ? `Sinergia em: ${item.produto}` : null,
      `Compatibilidade: *${item.score}%*`,
    ];
  } else if (outraParte === item.empresa) {
    descricao = [
      `*${outraParte.nome}*`,
      `Setor: ${outraParte.setor || 'Diversos'}`,
      outraParte.cidade ? `Local: ${outraParte.cidade}, ${outraParte.estado}` : null,
      item.produto ? `Oportunidade em: ${item.produto}` : null,
      `Compatibilidade: *${item.score}%*`,
    ];
  } else {
    descricao = [
      `*${outraParte.nome}*`,
      `Segmento: ${outraParte.segmento || 'Diversos'}`,
      item.produto ? `Oportunidade em: ${item.produto}` : null,
      `Compatibilidade: *${item.score}%*`,
    ];
  }

  const cabecalho = item.matchType === 'matchVaga'
    ? `*Candidato ${matchNum} de ${totalMatches} para sua vaga*`
    : `*Oportunidade ${matchNum} de ${totalMatches}*`;

  const cta = item.matchType === 'matchVaga'
    ? `Esse perfil interessa? Posso conectar você com o candidato para uma conversa?`
    : `O que acha dessa oportunidade?`;

  const msg = [
    cabecalho,
    ``,
    ...descricao.filter(Boolean),
    ``,
    cta,
  ].join('\n');

  state.step = 'apresentar_match';
  await sendTextMessage(from, msg);
}

// ─── RESPOSTA AO MATCH APRESENTADO ───
async function handleRespostaMatch(from, msgBody, buttonReply, state) {
  const item = state.matches[state.matchIndex];
  const outraParte = item.outraParte;

  // Botões interativos têm prioridade
  if (buttonReply === 'btn_interesse') {
    return await confirmarInteresse(from, state, item);
  }
  if (buttonReply === 'btn_detalhes') {
    state.step = 'detalhes';
    return await mostrarDetalhes(from, state);
  }
  if (buttonReply === 'btn_rejeitar') {
    return await rejeitarMatch(from, state, item);
  }

  // Classificar intenção via LLM
  const intencao = await classificarIntencao(
    msgBody,
    ['interesse', 'detalhes', 'pular'],
    `Foi apresentada uma oportunidade de negócio com ${outraParte.nome}. O usuário está respondendo se tem interesse, se quer saber mais detalhes, ou se quer pular para a próxima.`
  );

  if (intencao === 'interesse') return await confirmarInteresse(from, state, item);
  if (intencao === 'detalhes') {
    state.step = 'detalhes';
    return await mostrarDetalhes(from, state);
  }
  if (intencao === 'pular') return await rejeitarMatch(from, state, item);

  await sendTextMessage(from,
    `Não consegui entender bem. Você quer prosseguir com *${outraParte.nome}*, prefere saber mais sobre eles, ou quer ver outra oportunidade?`
  );
}

// ─── AUXILIAR: CONFIRMAR INTERESSE ───
// Quando o usuário demonstra interesse claro num match (via texto livre que a
// IA classificou como "interesse" ou via botão btn_interesse), disparamos
// imediatamente o handshake da etapa 2: notifica a outra parte (hsmbrac) e
// avança o status do match. Não pedimos confirmação dupla — a IA já entendeu
// a intenção, e UX de WhatsApp pede menos atrito.
async function confirmarInteresse(from, state, item) {
  console.log(`[confirmarInteresse] Etapa=${item.etapa} match #${item.id} (${state.remetente.entidade.nome} → ${item.outraParte.nome})`);

  if (item.etapa === 'aguardando_segundo') {
    // Etapa 2: handshake fechando — empresa autorizou contato.
    // processarSegundaConfirmacao:
    //   • atualiza status do match para CONFIRMED (match fechado)
    //   • envia mensagem de fechamento ao usuário
    //   • avisa o time da BRATECC (activityLog)
    //   • avança pro próximo match (ou conclui)
    await processarSegundaConfirmacao(from, state, item);
  } else {
    // Etapa 1: associado/origem demonstrou interesse — dispara hsmbrac pra outra parte.
    //   • atualiza status do match para INTERESTED
    //   • dispara hsmbrac pra outra parte
    //   • envia mensagem de confirmação ao usuário
    //   • avança pro próximo match (ou conclui)
    await processarPrimeiraConfirmacao(from, state, item);
  }
}

// ─── AUXILIAR: REJEITAR MATCH ───
async function rejeitarMatch(from, state, item) {
  const tabela = item.matchType === 'matchB2B' ? 'matchB2B'
                : item.matchType === 'matchVaga' ? 'matchVaga'
                : 'match';

  await prisma[tabela].update({
    where: { id: item.id },
    data: { status: 'REJECTED' },
  });

  await prisma.activityLog.create({
    data: {
      action: item.matchType === 'matchB2B' ? 'MATCHB2B_REJECTED_WHATSAPP'
            : item.matchType === 'matchVaga' ? 'MATCHVAGA_REJECTED_WHATSAPP'
            : 'MATCH_REJECTED_WHATSAPP',
      entity: item.matchType === 'matchB2B' ? 'MatchB2B'
            : item.matchType === 'matchVaga' ? 'MatchVaga'
            : 'Match',
      entityId: item.id,
      details: {
        quem: state.remetente.tipo,
        entidadeNome: state.remetente.entidade.nome,
        outraParteNome: item.outraParte.nome,
        etapa: item.etapa,
        via: 'WhatsApp',
      },
    },
  });

  console.log(`${item.matchType} #${item.id} → REJECTED (${state.remetente.entidade.nome} rejeitou ${item.outraParte.nome}, etapa=${item.etapa})`);

  await sendTextMessage(from, `Entendido.`);
  await avancarParaProximoMatch(from, state);
}

// ─── MOSTRAR DETALHES DA OUTRA PARTE ───
async function mostrarDetalhes(from, state) {
  const item = state.matches[state.matchIndex];
  const outraParte = item.outraParte;
  const eh_empresa = item.matchType === 'match' && outraParte === item.empresa;

  const partes = [];
  partes.push(`Sobre *${outraParte.nome}*:\n`);

  if (outraParte.descricao) {
    partes.push(`${outraParte.descricao}\n`);
  }

  if (eh_empresa) {
    partes.push(`\nÉ uma empresa do setor de *${outraParte.setor || 'diversos'}*`);
    if (outraParte.tipo) {
      const tipoLabel = { EXPORTADOR: 'exportadora', IMPORTADOR: 'importadora', AMBOS: 'importadora e exportadora' };
      partes.push(`, atuando como ${tipoLabel[outraParte.tipo] || outraParte.tipo}`);
    }
    if (outraParte.cidade) {
      partes.push(`, com sede em ${outraParte.cidade}, ${outraParte.estado}`);
    }
    partes.push('.\n');

    if (outraParte.necessidades) partes.push(`\nAtualmente buscam: ${outraParte.necessidades}\n`);
    if (outraParte.produtosDemandados) partes.push(`\nProdutos demandados: ${outraParte.produtosDemandados}\n`);
    if (outraParte.produtosOferecidos) partes.push(`\nOferecem: ${outraParte.produtosOferecidos}\n`);
  } else {
    // Outra parte é Associado (em Match→empresa olhando assoc, ou em B2B)
    partes.push(`Atuam no segmento de *${outraParte.segmento || 'serviços diversos'}*`);
    if (outraParte.servicos) partes.push(`, oferecendo serviços de ${outraParte.servicos}`);
    partes.push('.\n');

    if (outraParte.produtosOferecidos) {
      partes.push(`\nProdutos e serviços disponíveis: ${outraParte.produtosOferecidos}\n`);
    }
    if (outraParte.categorias?.length > 0) {
      partes.push(`\nÁreas de atuação: ${outraParte.categorias.join(', ')}\n`);
    }
  }

  if (item.produto) {
    partes.push(`\nA oportunidade de negócio entre vocês está no segmento de *${item.produto}*.`);
  }
  if (item.observacoes) {
    partes.push(`\n${item.observacoes}`);
  }

  partes.push(`\n\nA compatibilidade entre *${state.remetente.entidade.nome}* e *${outraParte.nome}* é de *${item.score}%*.`);

  const msg = [partes.join(''), ``, `Tem interesse em avançar com essa oportunidade?`].join('\n');
  await sendTextMessage(from, msg);
}

// ─── HANDLER DE RESPOSTA APÓS DETALHES ───
async function handleDetalhes(from, msgBody, buttonReply, state) {
  state.step = 'apresentar_match';
  await handleRespostaMatch(from, msgBody, buttonReply, state);
}

// ─── CONFIRMAÇÃO DE INTERESSE ───
// Aqui é onde acontece o handshake de 2 etapas:
//   • etapa 1 (aguardando_primeiro): status → INTERESTED, dispara hsmbrac pra outra parte
//   • etapa 2 (aguardando_segundo): status → CONFIRMED (match fechado)
async function handleConfirmacao(from, msgBody, buttonReply, state) {
  const item = state.matches[state.matchIndex];
  const { remetente } = state;

  console.log(`[handleConfirmacao] from=${from} msgBody="${msgBody}" buttonReply=${buttonReply} matchId=${item.id} etapa=${item.etapa}`);

  const intencao = buttonReply === 'btn_sim' ? 'confirmar'
    : buttonReply === 'btn_nao' ? 'voltar'
    : await classificarIntencao(
        msgBody,
        ['confirmar', 'voltar'],
        `Foi perguntado ao usuário se ele confirma interesse em conectar com ${item.outraParte.nome}.`
      );

  console.log(`[handleConfirmacao] intencao classificada = "${intencao}"`);

  if (intencao === 'voltar') {
    state.step = 'apresentar_match';
    await sendTextMessage(from,
      `Sem problemas. E sobre *${item.outraParte.nome}*, faz sentido seguirmos com a conexão?`
    );
    return;
  }

  if (intencao !== 'confirmar') {
    console.log(`[handleConfirmacao] Intenção indefinida — pedindo clarificação.`);
    await sendTextMessage(from, `Não consegui entender. Para iniciar a conexão com *${item.outraParte.nome}*, responda *sim*. Para voltar e ver outras oportunidades, responda *voltar*.`);
    return;
  }

  // ─── CONFIRMOU ───
  if (item.etapa === 'aguardando_primeiro') {
    console.log(`[handleConfirmacao] CONFIRMADO. Disparando processarPrimeiraConfirmacao...`);
    await processarPrimeiraConfirmacao(from, state, item);
  } else {
    console.log(`[handleConfirmacao] CONFIRMADO. Disparando processarSegundaConfirmacao...`);
    await processarSegundaConfirmacao(from, state, item);
  }
}

// ─── PROCESSA A PRIMEIRA CONFIRMAÇÃO (associado/origem aceitou) ───
// Status: PENDING/CONTACTED → INTERESTED
// Dispara hsmbrac pra outra parte (empresa ou destino do B2B)
async function processarPrimeiraConfirmacao(from, state, item) {
  const tabela = item.matchType === 'matchB2B' ? 'matchB2B'
                : item.matchType === 'matchVaga' ? 'matchVaga'
                : 'match';
  const { remetente } = state;

  // Pra matchVaga, o associado já está aceitando o candidato. Como o candidato
  // é o "destinatário final" (não há etapa 3), marcamos como CONFIRMED direto.
  // Pros outros tipos, vai pra INTERESTED (handshake etapa 2 ainda pendente).
  const novoStatus = item.matchType === 'matchVaga' ? 'CONFIRMED' : 'INTERESTED';

  await prisma[tabela].update({
    where: { id: item.id },
    data: { status: novoStatus },
  });

  await prisma.activityLog.create({
    data: {
      action: item.matchType === 'matchB2B' ? 'MATCHB2B_INTERESTED_WHATSAPP'
            : item.matchType === 'matchVaga' ? 'MATCHVAGA_CONFIRMED_WHATSAPP'
            : 'MATCH_INTERESTED_WHATSAPP',
      entity: item.matchType === 'matchB2B' ? 'MatchB2B'
            : item.matchType === 'matchVaga' ? 'MatchVaga'
            : 'Match',
      entityId: item.id,
      details: {
        quem: remetente.tipo,
        entidadeNome: remetente.entidade.nome,
        outraParteNome: item.outraParte.nome,
        etapa: 'primeira_confirmacao',
        novoStatus,
        via: 'WhatsApp',
      },
    },
  });

  console.log(`${item.matchType} #${item.id} → ${novoStatus} (1ª etapa: ${remetente.entidade.nome} aceitou; disparando hsmbrac pra ${item.outraParte.nome})`);

  // ─── DISPARAR HSM AVANÇO (hsmbrac) PRA OUTRA PARTE ───
  const outraParte = item.outraParte;
  let phone, segmento, produtosServico;

  if (item.matchType === 'matchVaga') {
    // Outra parte = candidato. Mensagem informa que tem vaga interessada.
    phone = outraParte.whatsapp || outraParte.telefone;
    segmento = outraParte.curso
      || (outraParte.habilidades ? outraParte.habilidades.split(',')[0].trim() : null)
      || 'Profissional';
    produtosServico = item.vaga.titulo
      || `Oportunidade na ${remetente.entidade.nome}`;
  } else if (item.matchType === 'matchB2B') {
    // Outra parte = associadoDestino. Mensagem fala do que a Origem oferece.
    phone = outraParte.whatsapp || outraParte.telefone;
    segmento = outraParte.segmento || 'Geral';
    produtosServico = item.produto
      || (item.origem.servicos ? item.origem.servicos.split(',')[0].trim() : null)
      || (item.origem.produtosOferecidos ? item.origem.produtosOferecidos.split(',')[0].trim() : null)
      || 'Parceria estratégica';
  } else {
    // Outra parte = empresa
    phone = outraParte.telefone;
    segmento = outraParte.setor || 'Geral';
    produtosServico = item.produto
      || outraParte.necessidades
      || outraParte.produtosDemandados
      || 'Serviços especializados';
  }

  let avisoEnvio = '';
  if (phone) {
    const r = await sendHSMAvanco(phone, outraParte.nome, segmento, produtosServico);
    avisoEnvio = r.success
      ? `Já enviei a notificação para *${outraParte.nome}*.`
      : `Vou registrar o interesse e o time da BRATECC vai cuidar do contato com *${outraParte.nome}*.`;
  } else {
    avisoEnvio = `O time da BRATECC vai entrar em contato diretamente com *${outraParte.nome}*.`;
    console.warn(`⚠️ HSM avanço não enviado: ${outraParte.nome} sem telefone.`);
  }

  // Avançar a conversa do remetente
  const restantes = state.matches.length - state.matchIndex - 1;

  // Mensagem de fechamento adaptada por tipo
  const fechamento = item.matchType === 'matchVaga'
    ? `*Conexão confirmada!* ${avisoEnvio} O contato direto com *${outraParte.nome}* foi liberado para que vocês deem continuidade.`
    : `*Interesse registrado.* ${avisoEnvio}`;

  if (restantes > 0) {
    state.step = 'pos_interesse';
    await sendTextMessage(from,
      `${fechamento}\n\nAlém dessa, ainda temos *${restantes}* outra${restantes > 1 ? 's' : ''} oportunidade${restantes > 1 ? 's' : ''} para o seu perfil. Deseja ver?`
    );
  } else {
    state.step = 'concluido';
    const fechamentoFinal = item.matchType === 'matchVaga'
      ? `Essa era a última indicação de candidato. Quando surgirem novos perfis que combinem com suas vagas, entraremos em contato.`
      : `Essa era a última oportunidade identificada para o seu perfil. Quando houver novidades, entraremos em contato.`;
    await sendTextMessage(from,
      `${fechamento}\n\n${fechamentoFinal}\n\nObrigado, *${remetente.entidade.nome}*.`
    );
    conversationStates.delete(from);
  }
}

// ─── PROCESSA A SEGUNDA CONFIRMAÇÃO (empresa/destino aceitou) ───
// Status: INTERESTED → CONFIRMED. Match fechado.
async function processarSegundaConfirmacao(from, state, item) {
  const tabela = item.matchType === 'matchB2B' ? 'matchB2B' : 'match';
  const { remetente } = state;

  await prisma[tabela].update({
    where: { id: item.id },
    data: { status: 'CONFIRMED' },
  });

  await prisma.activityLog.create({
    data: {
      action: item.matchType === 'matchB2B' ? 'MATCHB2B_CONFIRMED_WHATSAPP' : 'MATCH_CONFIRMED_WHATSAPP',
      entity: item.matchType === 'matchB2B' ? 'MatchB2B' : 'Match',
      entityId: item.id,
      details: {
        quem: remetente.tipo,
        entidadeNome: remetente.entidade.nome,
        outraParteNome: item.outraParte.nome,
        etapa: 'segunda_confirmacao',
        via: 'WhatsApp',
      },
    },
  });

  console.log(`${item.matchType} #${item.id} → CONFIRMED (2ª etapa: ${remetente.entidade.nome} aceitou — match fechado)`);

  const restantes = state.matches.length - state.matchIndex - 1;
  if (restantes > 0) {
    state.step = 'pos_interesse';
    await sendTextMessage(from,
      `*Conexão confirmada!* 🎉\n\nO contato direto entre *${remetente.entidade.nome}* e *${item.outraParte.nome}* foi liberado. A BRATECC vai notificar a outra parte para que ela entre em contato com vocês.\n\nAinda temos *${restantes}* outra${restantes > 1 ? 's' : ''} oportunidade${restantes > 1 ? 's' : ''} para você. Deseja ver?`
    );
  } else {
    state.step = 'concluido';
    await sendTextMessage(from,
      `*Conexão confirmada!* 🎉\n\nO contato direto entre *${remetente.entidade.nome}* e *${item.outraParte.nome}* foi liberado. A BRATECC vai notificar a outra parte para que ela entre em contato com vocês.\n\nEssa era a última oportunidade pendente. Obrigado!`
    );
    conversationStates.delete(from);
  }
}

// ─── APÓS REGISTRAR INTERESSE — VER MAIS OU ENCERRAR ───
async function handlePosInteresse(from, msgBody, state) {
  const intencao = await classificarIntencao(
    msgBody,
    ['ver_mais', 'encerrar'],
    'O usuário acabou de confirmar interesse em uma oportunidade. Foi perguntado se deseja ver as outras oportunidades ou encerrar.'
  );

  if (intencao === 'ver_mais') {
    await avancarParaProximoMatch(from, state);
    return;
  }

  if (intencao === 'encerrar') {
    state.step = 'concluido';
    await sendTextMessage(from,
      `Entendido. A equipe BRATECC vai cuidar dos próximos passos para as oportunidades confirmadas.\n\nQuando houver novidades, entraremos em contato. Obrigado, *${state.remetente.entidade.nome}*.`
    );
    conversationStates.delete(from);
    return;
  }

  await sendTextMessage(from, `Deseja ver as outras oportunidades ou prefere encerrar por aqui?`);
}

// ─── HANDLER DE CONFIRMAÇÃO DE PRESENÇA EM EVENTO ───
// Empresa recebeu hsmbraevent (convite pra evento) e está respondendo.
// Classifica intenção: confirmar, recusar, ou perguntar sobre o evento.
async function handleEventoConfirmPresenca(from, msgBody, state) {
  const intencao = await classificarIntencao(
    msgBody,
    ['confirmar', 'recusar', 'pergunta'],
    `A empresa foi convidada para o evento "${state.evento.nome}" e está respondendo se confirma presença.`
  );

  if (intencao === 'confirmar') {
    // Marca participação como confirmada no banco
    try {
      await prisma.eventoParticipante.update({
        where: {
          eventoId_empresaId: {
            eventoId: state.eventoId,
            empresaId: state.remetente.entidade.id,
          },
        },
        data: { confirmado: true },
      });
      await prisma.activityLog.create({
        data: {
          action: 'EVENTO_PRESENCA_CONFIRMED',
          entity: 'EventoParticipante',
          details: {
            eventoId: state.eventoId,
            eventoNome: state.evento.nome,
            empresaId: state.remetente.entidade.id,
            empresaNome: state.remetente.entidade.nome,
            via: 'WhatsApp',
          },
        },
      }).catch(() => {});
    } catch (err) {
      console.error('Erro ao confirmar presença:', err.message);
    }

    await sendTextMessage(from,
      `Presença confirmada para *${state.evento.nome}*. Obrigado!\n\nA BRATECC vai te enviar mais detalhes em breve. Qualquer dúvida, estamos à disposição.`
    );
    state.step = 'concluido';
    conversationStates.delete(from);
    return;
  }

  if (intencao === 'recusar') {
    // Marca como recusado deletando o EventoParticipante
    // (alternativa: ter um campo "recusado" — mas pra simplificar, removemos)
    try {
      await prisma.eventoParticipante.delete({
        where: {
          eventoId_empresaId: {
            eventoId: state.eventoId,
            empresaId: state.remetente.entidade.id,
          },
        },
      });
      await prisma.activityLog.create({
        data: {
          action: 'EVENTO_PRESENCA_DECLINED',
          entity: 'Evento',
          entityId: state.eventoId,
          details: {
            eventoNome: state.evento.nome,
            empresaId: state.remetente.entidade.id,
            empresaNome: state.remetente.entidade.nome,
            via: 'WhatsApp',
          },
        },
      }).catch(() => {});
    } catch (err) {
      console.error('Erro ao recusar presença:', err.message);
    }

    await sendTextMessage(from,
      `Tudo bem, agradecemos o retorno.\n\nQuando tivermos novas oportunidades que se encaixem com o perfil de *${state.remetente.entidade.nome}*, entraremos em contato.`
    );
    state.step = 'concluido';
    conversationStates.delete(from);
    return;
  }

  // Pergunta ou indefinido — dá mais detalhes do evento
  const detalhes = [];
  if (state.evento.data) {
    detalhes.push(`*Data:* ${new Date(state.evento.data).toLocaleDateString('pt-BR')}`);
  }
  if (state.evento.local) {
    detalhes.push(`*Local:* ${state.evento.local}`);
  }
  if (state.evento.descricao) {
    detalhes.push(`*Sobre:* ${state.evento.descricao}`);
  }

  const partes = [
    `Sobre o evento *${state.evento.nome}*:`,
    ``,
    ...detalhes,
    ``,
    `Vocês confirmam presença?`,
  ];

  await sendTextMessage(from, partes.join('\n'));
}

// ─── AVANÇAR PARA O PRÓXIMO MATCH ───
async function avancarParaProximoMatch(from, state) {
  state.matchIndex++;

  if (state.matchIndex >= state.matches.length) {
    state.step = 'concluido';
    await sendTextMessage(from,
      `Essas eram todas as oportunidades que identificamos para o seu perfil, *${state.remetente.entidade.nome}*.\n\nA BRATECC vai cuidar dos próximos passos para as oportunidades confirmadas. Qualquer dúvida, estamos à disposição.\n\nObrigado.`
    );
    conversationStates.delete(from);
    return;
  }

  await apresentarMatch(from, state);
}

// ═══════════════════════════════════════════════════════════
// FUNÇÕES AUXILIARES
// ═══════════════════════════════════════════════════════════

function normalizePhone(phone) {
  return phone.replace(/[^0-9]/g, '');
}


// ─── LOG DE WHATSAPP ───
async function logWhatsApp(to, message, status, response) {
  try {
    await prisma.activityLog.create({
      data: {
        action: `WHATSAPP_${status.toUpperCase()}`,
        entity: 'WhatsApp',
        details: {
          to,
          message: message.substring(0, 500),
          status,
          response: typeof response === 'object' ? JSON.stringify(response).substring(0, 1000) : response,
        },
      },
    });
  } catch (error) {
    console.error('Erro ao logar WhatsApp:', error.message);
  }
}

// ─── NOTIFICAÇÕES EM LOTE ───
async function sendBulkMatchNotifications(matchIds) {
  const results = [];

  for (const matchId of matchIds) {
    try {
      const match = await prisma.match.findUnique({
        where: { id: matchId },
        include: { empresa: true, associado: true },
      });

      if (!match || !match.associado.whatsapp) continue;

      const result = await sendTextMessage(match.associado.whatsapp,
        `🎯 *Novo Match BRATECC Connect!*\n\n🏢 Empresa: *${match.empresa.nome}*\n📊 Setor: ${match.empresa.setor}\n🔄 ${match.empresa.tipo}\n📍 ${match.empresa.cidade}, ${match.empresa.estado}\n\n💡 Serviço: ${match.produto}\n📊 Score: *${match.score}%*\n\nAcesse o sistema para ver detalhes e entrar em contato!`
      );

      results.push({ matchId, success: result.success });
    } catch (error) {
      results.push({ matchId, success: false, error: error.message });
    }
  }

  return results;
}

// ─── ENVIAR NOTIFICAÇÃO DE MATCH PARA EMPRESA ───
async function notifyEmpresaMatch(empresaId) {
  try {
    const empresa = await prisma.empresa.findUnique({ where: { id: empresaId } });
    if (!empresa?.telefone) return;

    const matchCount = await prisma.match.count({
      where: { empresaId, status: 'PENDING' },
    });

    if (matchCount > 0) {
      await sendTextMessage(empresa.telefone,
        `🎉 *BRATECC Connect AI*\n\nSua empresa *${empresa.nome}* recebeu *${matchCount} novo(s) match(es)* com associados especializados!\n\nAcesse o sistema para ver os detalhes:\n🌐 ${process.env.FRONTEND_URL || 'https://bratecc.com'}`
      );
    }
  } catch (error) {
    console.error('Erro ao notificar empresa:', error);
  }
}

// ─── ENFILEIRAR RETRY DE HSM EM 131049 (e outros erros recuperáveis) ───
// Chamado pelo handleStatusUpdate quando o webhook reporta `failed`. Persiste
// o retry na tabela whatsapp_retry_queue, que é processada pelo worker
// (whatsappRetryWorker.js) com backoff exponencial.
//
// Por que persistente: a v15.24 fazia retry com setTimeout em memória. Em
// produção isso falha em qualquer reinício do container — perde a fila. Com
// tabela, mesmo se o servidor reiniciar entre o erro e o retry agendado, o
// worker pega o item de volta e tenta. Sobrevive a deploy/restart.
async function enqueueRetryOnFailure(messageId, errorCode, errorMessage) {
  // Só re-enfileira pra erros que valem a pena tentar de novo.
  // 131049 = ecosystem engagement → muitas vezes passa em retry
  // 131045 = template paused → pode reativar
  // 130472 = experimental rate limit → tenta de novo depois
  // outros códigos comuns (132001, 131026, 190) são irrecuperáveis e o worker decide ABANDONED
  const erros_recuperaveis = [131049, 131045, 130472, 131056];
  if (!erros_recuperaveis.includes(errorCode)) {
    return null;
  }

  const ctx = getHSMSendContext(messageId);
  if (!ctx) {
    console.warn(`[enqueueRetry] Sem contexto cacheado pra ${messageId} — não dá pra enfileirar (TTL expirado).`);
    return null;
  }

  try {
    const retryWorker = require('./whatsappRetryWorker');
    const item = await retryWorker.enqueueRetry({
      toPhone: ctx.to,
      templateName: ctx.templateName,
      languageCode: ctx.languageCode,
      params: ctx.components,
      originalMessageId: messageId,
      errorCode,
      errorMessage,
      context: `Auto-enqueued após webhook ${errorCode}`,
    });
    return item;
  } catch (err) {
    console.error('[enqueueRetry] Erro:', err.message);
    return null;
  }
}

// Helper genérico que envia HSM com fallback para texto livre
async function sendHSMComFallback({ to, nome, segmento, produtoDemandado, templateName, fallbackText, logLabel }) {
  const components = hsmTemplates.buildComponents({
    nome,
    segmento,
    produtos_servico: produtoDemandado,
  });

  // 1. Tentar template aprovado
  let result = await sendTemplate(to, templateName, hsmTemplates.TEMPLATE_LANGUAGE, components);

  // Cachear contexto pra possível retry em 131049 (só se template foi aceito
  // pela Meta; se já falhou na chamada inicial, retry não vai mudar nada).
  if (result.success && result.messageId) {
    recordHSMSend(result.messageId, {
      to,
      templateName,
      languageCode: hsmTemplates.TEMPLATE_LANGUAGE,
      components,
    });
  }

  // 2. Fallback texto simples (válido só dentro da janela de 24h da Meta)
  if (!result.success) {
    console.warn(`⚠️ Template ${templateName} falhou para ${to}: ${JSON.stringify(result.error)}. Enviando texto simples (fallback)...`);
    result = await sendTextMessage(to, fallbackText);
    if (result.success) {
      console.log(`✅ Texto simples enviado para ${to} (fallback de ${templateName})`);
    }
  }

  await logWhatsApp(to, `${logLabel} → nome=${nome}, segmento=${segmento}, produto=${produtoDemandado}`, result.success ? 'sent' : 'error', result);
  return result;
}

// ─── HSM INÍCIO (template `hsmbra` por padrão) ───
// Disparado QUANDO o admin clica em "Gerar Match" → vai para a primeira ponta:
//   • Match Assoc × Empresa: vai para o ASSOCIADO
//   • MatchB2B Assoc × Assoc: vai para o ASSOCIADO ORIGEM (menor ID)
async function sendHSMInicio(to, nome, segmento, produtoDemandado) {
  const fallbackText = hsmTemplates.renderFallbackInicio({
    nome, segmento, produtos_servico: produtoDemandado,
  });
  return await sendHSMComFallback({
    to, nome, segmento, produtoDemandado,
    templateName: hsmTemplates.TEMPLATE_INICIO,
    fallbackText,
    logLabel: `HSM ${hsmTemplates.TEMPLATE_INICIO}`,
  });
}

// ─── HSM AVANÇO (template `hsmbrac` por padrão) ───
// Disparado AUTOMATICAMENTE quando o primeiro contato responde "interesse":
//   • Match Assoc × Empresa: vai para a EMPRESA (a outra ponta)
//   • MatchB2B Assoc × Assoc: vai para o ASSOCIADO DESTINO
async function sendHSMAvanco(to, nome, segmento, produtoDemandado) {
  const fallbackText = hsmTemplates.renderFallbackAvanco({
    nome, segmento, produtos_servico: produtoDemandado,
  });
  return await sendHSMComFallback({
    to, nome, segmento, produtoDemandado,
    templateName: hsmTemplates.TEMPLATE_AVANCO,
    fallbackText,
    logLabel: `HSM ${hsmTemplates.TEMPLATE_AVANCO}`,
  });
}

// ─── ALIAS de retrocompatibilidade ───
// Mantém o nome antigo `sendHSMBra1` apontando para `sendHSMInicio` para
// não quebrar `webhookController.sendHSM` que ainda chama o nome antigo.
// Pode ser removido depois que o webhookController migrar para sendHSMInicio.
const sendHSMBra1 = sendHSMInicio;

// ═══════════════════════════════════════════════════════════
// HSM hsmbraevent — Convite para evento
// Parâmetros: {{nome}}, {{nome_evento}}, {{descricao_evento}}
// ═══════════════════════════════════════════════════════════

async function sendHSMEvento(to, nome, nomeEvento, descricaoEvento) {
  const config = getConfig();
  if (!config.accessToken || !config.phoneNumberId) {
    return { success: false, error: 'WhatsApp não configurado (token ou phone number ID ausente)' };
  }

  const components = hsmTemplates.buildEventoComponents({
    nome,
    nome_evento: nomeEvento,
    descricao_evento: descricaoEvento,
  });

  // 1. Tentar template aprovado
  let result = await sendTemplate(to, hsmTemplates.TEMPLATE_EVENTO, hsmTemplates.TEMPLATE_LANGUAGE, components);

  // Cachear pra retry em 131049
  if (result.success && result.messageId) {
    recordHSMSend(result.messageId, {
      to,
      templateName: hsmTemplates.TEMPLATE_EVENTO,
      languageCode: hsmTemplates.TEMPLATE_LANGUAGE,
      components,
    });
  }

  // 2. Fallback de texto livre (válido só dentro da janela de 24h da Meta)
  if (!result.success) {
    console.warn(`⚠️ Template ${hsmTemplates.TEMPLATE_EVENTO} falhou para ${to}: ${JSON.stringify(result.error)}. Enviando texto simples (fallback)...`);
    const fallbackText = hsmTemplates.renderFallbackEvento({
      nome, nome_evento: nomeEvento, descricao_evento: descricaoEvento,
    });
    result = await sendTextMessage(to, fallbackText);
    if (result.success) {
      console.log(`✅ Texto simples enviado para ${to} (fallback de ${hsmTemplates.TEMPLATE_EVENTO})`);
    }
  }

  await logWhatsApp(to,
    `HSM ${hsmTemplates.TEMPLATE_EVENTO} → nome=${nome}, evento=${nomeEvento}`,
    result.success ? 'sent' : 'error', result);
  return result;
}

// ─── ENVIO EM LOTE PARA EVENTO ───
// Recebe { eventoId, alvos: [{ tipo: 'empresa'|'associado', id }] } e dispara
// hsmbraevent pra cada alvo. Lê nome+telefone do banco, registra activityLog.
//
// Comportamento:
// - Se entidade não tiver telefone → registra falha, segue.
// - Se Meta falhar → registra falha com motivo, segue (não para o lote).
async function sendEventoInviteBulk(eventoId, alvos) {
  const evento = await prisma.evento.findUnique({ where: { id: parseInt(eventoId) } });
  if (!evento) {
    return { error: 'Evento não encontrado', success: false, total: 0, sent: 0, failed: 0, details: [] };
  }

  const results = [];
  for (const alvo of alvos) {
    try {
      let entidade, phone, nome;

      if (alvo.tipo === 'empresa') {
        entidade = await prisma.empresa.findUnique({ where: { id: parseInt(alvo.id) } });
        if (!entidade) {
          results.push({ tipo: 'empresa', id: alvo.id, success: false, error: 'Empresa não encontrada' });
          continue;
        }
        phone = entidade.telefone;
        nome = entidade.nome;
      } else if (alvo.tipo === 'associado') {
        entidade = await prisma.associado.findUnique({ where: { id: parseInt(alvo.id) } });
        if (!entidade) {
          results.push({ tipo: 'associado', id: alvo.id, success: false, error: 'Associado não encontrado' });
          continue;
        }
        phone = entidade.whatsapp || entidade.telefone;
        nome = entidade.nome;
      } else {
        results.push({ tipo: alvo.tipo, id: alvo.id, success: false, error: `Tipo inválido: ${alvo.tipo}` });
        continue;
      }

      if (!phone) {
        results.push({ tipo: alvo.tipo, id: alvo.id, nome, success: false, error: `${nome} sem telefone/whatsapp cadastrado` });
        continue;
      }

      const result = await sendHSMEvento(
        phone,
        nome,
        evento.nome,
        evento.descricao || 'Encontro estratégico de networking e oportunidades comerciais'
      );

      results.push({
        tipo: alvo.tipo, id: alvo.id, nome, phone,
        success: result.success,
        error: result.success ? undefined : (result.error || 'Falha desconhecida'),
      });

      if (result.success) {
        // Cria EventoParticipante com confirmado=false (PENDENTE) — empresa
        // foi convidada mas ainda não respondeu confirmando presença.
        // Anti-duplicação: usa upsert pra evitar erro se já existe.
        if (alvo.tipo === 'empresa') {
          try {
            await prisma.eventoParticipante.upsert({
              where: {
                eventoId_empresaId: {
                  eventoId: parseInt(eventoId),
                  empresaId: parseInt(alvo.id),
                },
              },
              update: {}, // se já existe, preserva confirmado atual
              create: {
                eventoId: parseInt(eventoId),
                empresaId: parseInt(alvo.id),
                confirmado: false,
              },
            });
          } catch (e) {
            console.warn(`⚠️ Falha ao criar EventoParticipante para empresa#${alvo.id}: ${e.message}`);
          }
        }

        await prisma.activityLog.create({
          data: {
            action: 'EVENTO_INVITE_SENT',
            entity: alvo.tipo === 'empresa' ? 'Empresa' : 'Associado',
            entityId: parseInt(alvo.id),
            details: {
              eventoId: parseInt(eventoId),
              eventoNome: evento.nome,
              via: 'WhatsApp',
              template: hsmTemplates.TEMPLATE_EVENTO,
            },
          },
        }).catch(() => null);
      }
    } catch (err) {
      console.error(`❌ Erro ao enviar convite evento para ${alvo.tipo}#${alvo.id}:`, err.message);
      results.push({ tipo: alvo.tipo, id: alvo.id, success: false, error: err.message });
    }
  }

  return {
    eventoId: parseInt(eventoId),
    eventoNome: evento.nome,
    total: results.length,
    sent: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    details: results,
  };
}

// ═══════════════════════════════════════════════════════════
// HSM SINERGIA NO EVENTO — Handshake 2 etapas dentro de evento
// Etapa 1: hsm_evento_empresa_associado → para o ASSOCIADO
// Etapa 2: REUTILIZA hsmbrac (TEMPLATE_AVANCO) → para a EMPRESA, disparada
//          automaticamente quando o associado responder com interesse.
//
// Cria match (Assoc×Empresa) em PENDING quando dispara etapa 1, igual ao
// fluxo hsmbra/hsmbrac, mas marcando analiseIA.fluxo='evento_sinergia' pra rastreio.
// ═══════════════════════════════════════════════════════════

async function sendHSMEventoSinergiaInicio(to, nome, nomeEvento) {
  const config = getConfig();
  if (!config.accessToken || !config.phoneNumberId) {
    return { success: false, error: 'WhatsApp não configurado' };
  }
  const components = hsmTemplates.buildEventoSinergiaInicioComponents({
    nome, nome_evento: nomeEvento,
  });

  let result = await sendTemplate(to, hsmTemplates.TEMPLATE_EVENTO_SINERGIA_INICIO, hsmTemplates.TEMPLATE_LANGUAGE, components);

  // Cachear pra retry em 131049
  if (result.success && result.messageId) {
    recordHSMSend(result.messageId, {
      to,
      templateName: hsmTemplates.TEMPLATE_EVENTO_SINERGIA_INICIO,
      languageCode: hsmTemplates.TEMPLATE_LANGUAGE,
      components,
    });
  }

  if (!result.success) {
    console.warn(`⚠️ Template ${hsmTemplates.TEMPLATE_EVENTO_SINERGIA_INICIO} falhou para ${to}: ${JSON.stringify(result.error)}. Enviando texto livre (fallback)...`);
    const fallback = hsmTemplates.renderFallbackEventoSinergiaInicio({ nome, nome_evento: nomeEvento });
    result = await sendTextMessage(to, fallback);
  }
  await logWhatsApp(to, `HSM ${hsmTemplates.TEMPLATE_EVENTO_SINERGIA_INICIO} → ${nome}`,
    result.success ? 'sent' : 'error', result);
  return result;
}

// ─── ENVIO EM LOTE: SINERGIA NO EVENTO (etapa 1 = associado) ───
// Recebe { eventoId, pares: [{ empresaId, associadoId }, ...] }
// Pra cada par:
//   1. Cria/garante o Match (empresaId × associadoId) em PENDING (anti-duplicação respeitada)
//   2. Marca match com contextoEvento = eventoId (campo analiseIA.eventoOrigem)
//   3. Dispara HSM etapa 1 PRO ASSOCIADO
//   4. Quando associado responder no WhatsApp → webhookController dispara etapa 2 pra empresa
async function sendEventoSinergiaInicioBulk(eventoId, pares) {
  const evento = await prisma.evento.findUnique({ where: { id: parseInt(eventoId) } });
  if (!evento) {
    return { error: 'Evento não encontrado', success: false, total: 0, sent: 0, failed: 0, details: [] };
  }

  const results = [];
  for (const par of pares) {
    try {
      const empresaId = parseInt(par.empresaId);
      const associadoId = parseInt(par.associadoId);

      const empresa = await prisma.empresa.findUnique({ where: { id: empresaId } });
      const associado = await prisma.associado.findUnique({ where: { id: associadoId } });
      if (!empresa || !associado) {
        results.push({ empresaId, associadoId, success: false, error: 'Empresa ou associado não encontrado' });
        continue;
      }

      const phone = associado.whatsapp || associado.telefone;
      if (!phone) {
        results.push({ empresaId, associadoId, nome: associado.nome, success: false, error: `${associado.nome} sem WhatsApp/telefone cadastrado` });
        continue;
      }

      // 1. Criar/garantir match (anti-duplicação): se já existe, preserva.
      let match = await prisma.match.findUnique({
        where: { empresaId_associadoId: { empresaId, associadoId } },
      });
      let isNewMatch = false;
      if (!match) {
        // SCORE: não calculamos aqui. Score é gerado pelo cron horário e pelos
        // hooks de cadastro/edição de empresa/associado. Aqui só registramos o
        // match com score 0 (placeholder); o cron pega na próxima rodada.
        match = await prisma.match.create({
          data: {
            empresaId,
            associadoId,
            score: 0,
            produto: empresa.produtosDemandados?.split(',')[0]?.trim() || empresa.setor || 'Conexão no evento',
            observacoes: `Sinergia identificada no evento "${evento.nome}"`,
            status: 'PENDING',
            prioridade: 'media',
            analiseIA: {
              origemEventoId: parseInt(eventoId),
              origemEventoNome: evento.nome,
              fluxo: 'evento_sinergia',
              criadoEm: new Date().toISOString(),
            },
          },
        });
        isNewMatch = true;
      } else if (match.status === 'PENDING') {
        // Match já existe em PENDING — anota o evento na analiseIA mas preserva score/produto.
        await prisma.match.update({
          where: { id: match.id },
          data: {
            analiseIA: {
              ...(match.analiseIA || {}),
              eventoSinergiaIds: [
                ...((match.analiseIA && match.analiseIA.eventoSinergiaIds) || []),
                parseInt(eventoId),
              ],
            },
          },
        });
      }
      // Se match não-PENDING (CONTACTED+), não toca — regra v15 (anti-regeneração).

      // 2. Disparar HSM etapa 1 pro associado
      const result = await sendHSMEventoSinergiaInicio(phone, associado.nome, evento.nome);

      results.push({
        empresaId, associadoId, matchId: match.id,
        empresa: empresa.nome, associado: associado.nome, phone,
        success: result.success,
        error: result.success ? undefined : (result.error || 'Falha desconhecida'),
      });

      if (result.success) {
        // Atualiza status do match pra CONTACTED só se ainda estava PENDING
        if (match.status === 'PENDING') {
          await prisma.match.update({
            where: { id: match.id },
            data: { status: 'CONTACTED' },
          });
        }
        await prisma.activityLog.create({
          data: {
            action: 'EVENTO_SINERGIA_SENT',
            entity: 'Match',
            entityId: match.id,
            details: {
              eventoId: parseInt(eventoId),
              eventoNome: evento.nome,
              empresa: empresa.nome,
              associado: associado.nome,
              template: hsmTemplates.TEMPLATE_EVENTO_SINERGIA_INICIO,
            },
          },
        }).catch(() => null);
      }
    } catch (err) {
      console.error(`❌ Erro evento sinergia ${par.empresaId}×${par.associadoId}:`, err.message);
      results.push({ empresaId: par.empresaId, associadoId: par.associadoId, success: false, error: err.message });
    }
  }

  return {
    eventoId: parseInt(eventoId),
    eventoNome: evento.nome,
    total: results.length,
    sent: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    details: results,
  };
}

// ─── ENVIAR HSM INÍCIO EM LOTE PARA MATCHES Assoc × Empresa ───
// MUDANÇA v15 (handshake 2 etapas): só envia para o ASSOCIADO.
// A empresa só recebe o HSM avanço (hsmbrac) quando o associado aceitar.
async function sendMatchHSMBulk(matchIds) {
  const results = [];

  for (const matchId of matchIds) {
    try {
      const match = await prisma.match.findUnique({
        where: { id: matchId },
        include: { empresa: true, associado: true },
      });

      if (!match) {
        results.push({ matchId, success: false, error: 'Match não encontrado' });
        continue;
      }

      // Só dispara HSM se o match estiver em PENDING (anti-duplicação).
      // Match já contactado/aceito/rejeitado não recebe HSM novamente.
      if (match.status !== 'PENDING') {
        console.log(`⏭️ Match #${matchId} pulado: status=${match.status} (anti-duplicação)`);
        results.push({
          matchId,
          target: 'associado',
          success: false,
          skipped: true,
          error: `Match já está em ${match.status} — HSM não re-enviado`,
        });
        continue;
      }

      const assocPhone = match.associado.whatsapp || match.associado.telefone;
      if (!assocPhone) {
        console.warn(`⚠️ Associado ${match.associado.nome} sem WhatsApp/telefone cadastrado`);
        results.push({
          matchId,
          target: 'associado',
          success: false,
          error: `Associado ${match.associado.nome} sem telefone`,
        });
        continue;
      }

      console.log(`📤 [INÍCIO] Enviando hsmbra para associado ${match.associado.nome} → ${assocPhone}`);

      // O texto fala do que a EMPRESA está buscando — o associado é quem
      // tem o que oferecer. Por isso `produtos_servico` = necessidade da empresa.
      const produtosServico =
        match.produto
        || match.empresa.necessidades
        || match.empresa.produtosDemandados
        || (match.associado.servicos ? match.associado.servicos.split(',')[0].trim() : null)
        || 'Oportunidades comerciais';

      const result = await sendHSMInicio(
        assocPhone,
        match.associado.nome,
        match.associado.segmento || 'Geral',
        produtosServico
      );

      results.push({
        matchId,
        target: 'associado',
        phone: assocPhone,
        success: result.success,
        error: result.success ? undefined : result.error,
      });

      // Status: PENDING → CONTACTED (aguardando resposta do associado)
      if (result.success) {
        await prisma.match.update({
          where: { id: matchId },
          data: { status: 'CONTACTED' },
        });
      }
    } catch (error) {
      console.error(`❌ Erro match ${matchId}:`, error.message);
      results.push({ matchId, success: false, error: error.message });
    }
  }

  return results;
}

// ─── ENVIAR HSM INÍCIO EM LOTE PARA MATCHES Assoc × Assoc (B2B) ───
// Só envia para o associadoOrigem (menor ID, por convenção do schema).
// O associadoDestino só recebe HSM avanço quando origem aceitar.
async function sendMatchB2BHSMBulk(matchB2BIds) {
  const results = [];

  for (const id of matchB2BIds) {
    try {
      const m = await prisma.matchB2B.findUnique({
        where: { id },
        include: { origem: true, destino: true },
      });

      if (!m) {
        results.push({ matchB2BId: id, success: false, error: 'MatchB2B não encontrado' });
        continue;
      }

      if (m.status !== 'PENDING') {
        console.log(`⏭️ MatchB2B #${id} pulado: status=${m.status}`);
        results.push({
          matchB2BId: id,
          target: 'origem',
          success: false,
          skipped: true,
          error: `MatchB2B já está em ${m.status}`,
        });
        continue;
      }

      const origemPhone = m.origem.whatsapp || m.origem.telefone;
      if (!origemPhone) {
        console.warn(`⚠️ Associado ORIGEM ${m.origem.nome} sem WhatsApp/telefone`);
        results.push({
          matchB2BId: id,
          target: 'origem',
          success: false,
          error: `${m.origem.nome} sem telefone`,
        });
        continue;
      }

      // Texto fala do que o DESTINO oferece (o usuário origem vai conhecer o destino)
      const produtosServico =
        (m.destino.servicos ? m.destino.servicos.split(',')[0].trim() : null)
        || (m.destino.produtosOferecidos ? m.destino.produtosOferecidos.split(',')[0].trim() : null)
        || m.servicoDestino
        || 'Sinergia comercial estratégica';

      console.log(`📤 [INÍCIO B2B] Enviando hsmbra para ${m.origem.nome} → ${origemPhone}`);

      const result = await sendHSMInicio(
        origemPhone,
        m.origem.nome,
        m.origem.segmento || 'Geral',
        produtosServico
      );

      results.push({
        matchB2BId: id,
        target: 'origem',
        phone: origemPhone,
        success: result.success,
        error: result.success ? undefined : result.error,
      });

      if (result.success) {
        await prisma.matchB2B.update({
          where: { id },
          data: { status: 'CONTACTED' },
        });
      }
    } catch (error) {
      console.error(`❌ Erro matchB2B ${id}:`, error.message);
      results.push({ matchB2BId: id, success: false, error: error.message });
    }
  }

  return results;
}

// ═══════════════════════════════════════════════════════════
// HSM BULK PARA MATCHES Candidato × Vaga
// ═══════════════════════════════════════════════════════════
// Fluxo:
//   Etapa 1 (PENDING → CONTACTED): hsmbra → ASSOCIADO dono da vaga
//     "Encontramos um candidato com perfil que combina com a sua vaga X"
//   Etapa 2 (INTERESTED → CONFIRMED): hsmbrac → CANDIDATO
//     Disparado quando associado responde "sim" no fluxo de conversa.
//
// O associado decide primeiro porque ele é o dono da vaga; só depois o
// candidato é abordado pra liberar o contato.
async function sendMatchVagaHSMBulk(matchVagaIds) {
  const results = [];

  for (const matchId of matchVagaIds) {
    try {
      const matchVaga = await prisma.matchVaga.findUnique({
        where: { id: matchId },
        include: {
          candidato: { include: { universidade: true } },
          vaga: { include: { associado: true } },
        },
      });

      if (!matchVaga) {
        results.push({ matchVagaId: matchId, success: false, error: 'MatchVaga não encontrado' });
        continue;
      }

      // Anti-duplicação: só dispara HSM em PENDING
      if (matchVaga.status !== 'PENDING') {
        console.log(`⏭️ MatchVaga #${matchId} pulado: status=${matchVaga.status} (anti-duplicação)`);
        results.push({
          matchVagaId: matchId,
          target: 'associado',
          success: false,
          skipped: true,
          error: `MatchVaga já está em ${matchVaga.status} — HSM não re-enviado`,
        });
        continue;
      }

      const associado = matchVaga.vaga.associado;
      const candidato = matchVaga.candidato;
      const vaga = matchVaga.vaga;

      const assocPhone = associado.whatsapp || associado.telefone;
      if (!assocPhone) {
        console.warn(`⚠️ Associado ${associado.nome} (vaga#${vaga.id}) sem WhatsApp/telefone`);
        results.push({
          matchVagaId: matchId,
          target: 'associado',
          success: false,
          error: `Associado ${associado.nome} sem telefone`,
        });
        continue;
      }

      console.log(`📤 [INÍCIO-VAGA] Enviando hsmbra para associado ${associado.nome} → ${assocPhone} (candidato: ${candidato.nome}, vaga: ${vaga.titulo})`);

      // Reuso do template hsmbra com adaptação semântica:
      //   nome             = associado (quem recebe)
      //   segmento         = curso/área do candidato (o que está sendo apresentado)
      //   produtos_servico = título da vaga (referência do que casa com candidato)
      const segmentoCandidato =
        candidato.curso
        || (candidato.habilidades ? candidato.habilidades.split(',')[0].trim() : null)
        || 'Profissional qualificado';

      const tituloVaga = vaga.titulo || 'Vaga em aberto';

      const result = await sendHSMInicio(
        assocPhone,
        associado.nome,
        segmentoCandidato,
        tituloVaga
      );

      results.push({
        matchVagaId: matchId,
        target: 'associado',
        phone: assocPhone,
        success: result.success,
        error: result.success ? undefined : result.error,
      });

      // Status: PENDING → CONTACTED (aguardando resposta do associado)
      if (result.success) {
        await prisma.matchVaga.update({
          where: { id: matchId },
          data: { status: 'CONTACTED' },
        });
      }
    } catch (error) {
      console.error(`❌ Erro matchVaga ${matchId}:`, error.message);
      results.push({ matchVagaId: matchId, success: false, error: error.message });
    }
  }

  return results;
}


module.exports = {
  sendTextMessage,
  sendTemplate,
  sendInteractiveButtons,
  markAsRead,
  processIncomingMessage,
  sendBulkMatchNotifications,
  notifyEmpresaMatch,
  sendHSMInicio,
  sendHSMAvanco,
  sendHSMEvento,
  sendHSMEventoSinergiaInicio,
  sendHSMBra1,
  sendMatchHSMBulk,
  sendMatchB2BHSMBulk,
  sendMatchVagaHSMBulk,                     // novo: HSM em massa para matches Candidato × Vaga
  sendEventoInviteBulk,
  sendEventoSinergiaInicioBulk,
  retryHSMOn131049: enqueueRetryOnFailure,
  enqueueRetryOnFailure,
  getConfig,
  conversationStates,
};

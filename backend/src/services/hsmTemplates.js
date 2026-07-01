// ═══════════════════════════════════════════════════════════
// BRATECC Connect AI — Templates HSM (Meta WhatsApp)
// ═══════════════════════════════════════════════════════════
//
// Centraliza:
//   • Nome do template aprovado na Meta (lado servidor — `name` no payload)
//   • Texto de fallback (lado livre — usado se o template falhar OU se a
//     janela de 24h estiver aberta e quisermos texto livre)
//   • Parâmetros nomeados ({{nome}}, {{segmento}}, {{produtos_servico}})
//
// FLUXO DE 2 ETAPAS:
//   1. HSM INÍCIO (`hsmbra`) → para o PRIMEIRO contato da cadeia
//      (associado em Assoc×Empresa, associadoOrigem em B2B)
//   2. HSM AVANÇO (`hsmbrac`) → para o SEGUNDO contato, disparado
//      automaticamente quando o primeiro responder com interesse
//      (empresa em Assoc×Empresa, associadoDestino em B2B)
//
// Os nomes dos templates são configuráveis via env vars.
// Os textos são travados aqui (mude direto no arquivo se precisar).
// ═══════════════════════════════════════════════════════════

const TEMPLATE_INICIO = process.env.HSM_TEMPLATE_INICIO || 'hsmbra';
const TEMPLATE_AVANCO = process.env.HSM_TEMPLATE_AVANCO || 'hsmbrac';
const TEMPLATE_EVENTO = process.env.HSM_TEMPLATE_EVENTO || 'hsmbraevent';
// Sinergia dentro de evento — handshake 2 etapas:
//   etapa 1: hsm_evento_empresa_associado → enviado AO ASSOCIADO (template novo)
//   etapa 2: REUTILIZA hsmbrac (TEMPLATE_AVANCO já configurado), pra simplificar
//            e não exigir mais um template aprovado na Meta.
const TEMPLATE_EVENTO_SINERGIA_INICIO = process.env.HSM_TEMPLATE_EVENTO_SINERGIA_INICIO || 'hsm_evento_empresa_associado';
const TEMPLATE_LANGUAGE = process.env.HSM_TEMPLATE_LANGUAGE || 'pt_BR';

// ─── TEXTOS DOS HSM (use {{...}} para parâmetros) ───
// Esses textos são usados:
//   (a) Como fallback quando o template aprovado falhar
//   (b) Como referência para você cadastrar/aprovar o template na Meta
//       com o MESMO conteúdo

// IMPORTANTE: o texto abaixo precisa bater EXATAMENTE com o template
// aprovado na Meta (caracter por caracter). Se divergir:
//   - O TEMPLATE aprovado continua entregando normalmente (a Meta usa o que
//     foi aprovado, não o que mandamos no payload)
//   - O FALLBACK de texto livre (este texto, enviado quando template falha)
//     vai diferir do que a empresa aprovou — não bloqueia entrega mas perde
//     consistência com o que está documentado.

const TEXTO_INICIO =
  'Olá, {{nome}}, tudo bem?\n' +
  'Identificamos que a sua empresa atua com {{segmento}} e pode ter sinergia ' +
  'com oportunidades ativas dentro da nossa rede, especialmente relacionadas ' +
  'a {{produtos_servico}}\n' +
  'Temos empresas buscando exatamente esse tipo de solução e acreditamos que ' +
  'pode haver um fit interessante para geração de negócios.\n' +
  'Faz sentido avaliarmos uma conexão rápida para explorar essa oportunidade?';

const TEXTO_AVANCO =
  'Olá, {{nome}}, tudo bem?\n' +
  'Temos uma novidade Encontramos uma empresa dentro da nossa rede com forte ' +
  'aderência ao que você busca em {{segmento}}.\n' +
  'Ela demonstrou interesse em se conectar com você para explorar oportunidades ' +
  'relacionadas a {{produtos_servico}}.\n' +
  'Faz sentido avançarmos com essa conexão?\n' +
  'Se sim, posso organizar uma introdução rápida entre vocês 🤝';

// ─── HSM EVENTO (template `hsmbraevent`) ───
// Disparado quando o admin convida empresa ou associado pra um evento específico.
// Parâmetros: {{nome}}, {{nome_evento}}, {{descricao_evento}}.
const TEXTO_EVENTO =
  'Olá, {{nome}}, tudo bem? Temos uma oportunidade de participação no evento ' +
  '{{nome_evento}}. Sobre o evento: {{descricao_evento}}. Acreditamos que esse ' +
  'encontro pode ser relevante para você. Deseja confirmar seu cadastro?';

// ─── HSM EVENTO SINERGIA — ETAPA 1 (template `hsm_evento_empresa_associado`) ───
// Enviado AO ASSOCIADO. Aviso de matchmaking dentro do contexto do evento.
// Parâmetros: {{nome}}, {{nome_evento}}.
const TEXTO_EVENTO_SINERGIA_INICIO =
  'Olá, {{nome}}, tudo bem? No evento - {{nome_evento}}, encontramos algumas ' +
  'empresas que pode ter sinergia com você. Faz sentido promovermos essa ' +
  'conexão durante o evento?';

// Etapa 2 do fluxo de sinergia em evento reutiliza TEXTO_AVANCO (hsmbrac) —
// não tem texto dedicado nesse arquivo.

// ─── Substituir placeholders ({{x}}) por valores reais ───
function render(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const v = vars[key];
    return v != null && v !== '' ? String(v) : `[${key}]`;
  });
}

// ─── Construir os `components` no formato Meta ───
// Usamos parâmetros nomeados (parameter_name) — disponível em Cloud API v17+.
// Se o template foi aprovado com parâmetros posicionais, troque para
// `parameters: [{ type: 'text', text: ... }, ...]` (sem `parameter_name`).
function buildComponents({ nome, segmento, produtos_servico }) {
  return [
    {
      type: 'body',
      parameters: [
        { type: 'text', parameter_name: 'nome', text: nome || 'Empresa' },
        { type: 'text', parameter_name: 'segmento', text: segmento || 'Geral' },
        {
          type: 'text',
          parameter_name: 'produtos_servico',
          text: produtos_servico || 'Serviços diversos',
        },
      ],
    },
  ];
}

// ─── Renderizar fallback de texto livre ───
function renderFallbackInicio(vars) {
  return render(TEXTO_INICIO, {
    nome: vars.nome || 'Empresa',
    segmento: vars.segmento || 'Geral',
    produtos_servico: vars.produtos_servico || 'Serviços diversos',
  });
}

function renderFallbackAvanco(vars) {
  return render(TEXTO_AVANCO, {
    nome: vars.nome || 'Empresa',
    segmento: vars.segmento || 'Geral',
    produtos_servico: vars.produtos_servico || 'Serviços diversos',
  });
}

// ─── Componentes Meta para o template hsmbraevent ───
// Parâmetros nomeados: nome, nome_evento, descricao_evento.
function buildEventoComponents({ nome, nome_evento, descricao_evento }) {
  return [
    {
      type: 'body',
      parameters: [
        { type: 'text', parameter_name: 'nome', text: nome || 'Empresa' },
        { type: 'text', parameter_name: 'nome_evento', text: nome_evento || 'Evento BRATECC' },
        {
          type: 'text',
          parameter_name: 'descricao_evento',
          // Meta limita parâmetros de body em ~1024 chars; cortamos pra 600 por segurança.
          text: (descricao_evento || 'Encontro estratégico de networking e oportunidades comerciais').slice(0, 600),
        },
      ],
    },
  ];
}

function renderFallbackEvento(vars) {
  return render(TEXTO_EVENTO, {
    nome: vars.nome || 'Empresa',
    nome_evento: vars.nome_evento || 'Evento BRATECC',
    descricao_evento: vars.descricao_evento || 'Encontro estratégico de networking e oportunidades comerciais',
  });
}

// ─── Componentes Meta para hsm_evento_empresa_associado (etapa 1) ───
// Parâmetros nomeados: nome, nome_evento.
function buildEventoSinergiaInicioComponents({ nome, nome_evento }) {
  return [
    {
      type: 'body',
      parameters: [
        { type: 'text', parameter_name: 'nome', text: nome || 'Associado' },
        { type: 'text', parameter_name: 'nome_evento', text: nome_evento || 'Evento BRATECC' },
      ],
    },
  ];
}

function renderFallbackEventoSinergiaInicio(vars) {
  return render(TEXTO_EVENTO_SINERGIA_INICIO, {
    nome: vars.nome || 'Associado',
    nome_evento: vars.nome_evento || 'Evento BRATECC',
  });
}

module.exports = {
  TEMPLATE_INICIO,
  TEMPLATE_AVANCO,
  TEMPLATE_EVENTO,
  TEMPLATE_EVENTO_SINERGIA_INICIO,
  TEMPLATE_LANGUAGE,
  TEXTO_INICIO,
  TEXTO_AVANCO,
  TEXTO_EVENTO,
  TEXTO_EVENTO_SINERGIA_INICIO,
  buildComponents,
  buildEventoComponents,
  buildEventoSinergiaInicioComponents,
  renderFallbackInicio,
  renderFallbackAvanco,
  renderFallbackEvento,
  renderFallbackEventoSinergiaInicio,
};

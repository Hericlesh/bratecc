// ═══════════════════════════════════════════════════════════
// BRATECC Connect AI — Scoring Service
// ═══════════════════════════════════════════════════════════
//
// Responsável por recalcular o score de matches existentes via Gemini.
//
// Diferente do `aiService.gerarMatchInteligente` (que descobre matches NOVOS
// para uma empresa, processando lote de associados), este serviço recebe um
// par já existente e devolve um score atualizado + nova justificativa.
//
// REGRA DE OURO: só recalcula matches em status PENDING.
// Matches em CONTACTED/INTERESTED/CONFIRMED/REJECTED são imutáveis — uma vez
// que o WhatsApp já entrou na cadeia, mexer no score causaria inconsistência
// entre o que o sistema mostra e o que a outra ponta já viu.
//
// Disparado em:
//   • empresaController.update / associadoController.update (após save)
//   • cron job de hora em hora (scoringCron)
// ═══════════════════════════════════════════════════════════

const prisma = require('../config/database');
const { callGemini, calcularPrioridade } = require('./aiService');

// ─── PROMPT PARA SCORE DE PAR ───
function buildPairPrompt(empresa, associado) {
  return `Avalie a compatibilidade comercial entre a EMPRESA e o ASSOCIADO abaixo.

EMPRESA:
- Nome: ${empresa.nome}
- Setor: ${empresa.setor || 'não informado'}
- Tipo: ${empresa.tipo || 'não informado'}
- Localização: ${empresa.cidade || ''}${empresa.estado ? ', ' + empresa.estado : ''}
- Necessidades: ${empresa.necessidades || 'não informado'}
- Produtos demandados: ${empresa.produtosDemandados || 'não informado'}
- Produtos oferecidos: ${empresa.produtosOferecidos || 'não informado'}
- Descrição: ${empresa.descricao || 'não informado'}

ASSOCIADO:
- Nome: ${associado.nome}
- Segmento: ${associado.segmento || 'não informado'}
- Serviços: ${associado.servicos || 'não informado'}
- Produtos oferecidos: ${associado.produtosOferecidos || 'não informado'}
- Categorias: ${(associado.categorias || []).join(', ') || 'não informado'}
- Descrição: ${associado.descricao || 'não informado'}

Responda APENAS com um objeto JSON, sem texto antes ou depois, no formato:
{
  "score": <número de 0 a 100>,
  "produto": "<produto/serviço principal de sinergia, máx 60 chars>",
  "oportunidade": "<resumo da oportunidade de negócio, máx 200 chars>",
  "justificativa": "<por que esse score, máx 300 chars>"
}

Critérios de pontuação:
- 90-100: sinergia forte e direta (associado oferece exatamente o que empresa demanda)
- 70-89: sinergia clara em vários pontos
- 50-69: sinergia parcial ou exploratória
- 30-49: sinergia indireta, possível mas requer ajuste
- 0-29: sem sinergia aparente`;
}

// ─── CALCULAR SCORE DE 1 PAR (Gemini) ───
async function recalcularScorePar(empresa, associado) {
  const prompt = buildPairPrompt(empresa, associado);
  const systemInstruction = 'Você é um analista de matching comercial. Responda apenas em JSON válido, sem markdown.';

  try {
    const response = await callGemini(prompt, systemInstruction);

    // Tentar parsear JSON da resposta
    const cleaned = response
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();

    const data = JSON.parse(cleaned);

    if (typeof data.score !== 'number' || data.score < 0 || data.score > 100) {
      throw new Error(`Score inválido recebido: ${data.score}`);
    }

    return {
      score: Math.round(data.score),
      produto: data.produto || null,
      oportunidade: data.oportunidade || null,
      justificativa: data.justificativa || null,
    };
  } catch (err) {
    console.warn(`⚠️  Falha ao recalcular score (empresa=${empresa.id} × associado=${associado.id}): ${err.message}`);
    return null;
  }
}

// ─── ATUALIZAR SCORE DE 1 MATCH NO BANCO ───
// Retorna: { atualizado: bool, scoreAntigo, scoreNovo } | null se pulou
async function atualizarScoreMatch(matchId) {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: { empresa: true, associado: true },
  });

  if (!match) return null;

  // GUARDA: só PENDING. Outros status são imutáveis.
  if (match.status !== 'PENDING') {
    return { skipped: true, reason: `status=${match.status}` };
  }

  const novo = await recalcularScorePar(match.empresa, match.associado);
  if (!novo) return { skipped: true, reason: 'gemini_falhou' };

  if (novo.score === match.score) {
    return { atualizado: false, scoreAntigo: match.score, scoreNovo: novo.score };
  }

  const prioridade = calcularPrioridade(novo.score);

  await prisma.match.update({
    where: { id: matchId },
    data: {
      score: novo.score,
      produto: novo.produto || match.produto,
      observacoes: novo.oportunidade || match.observacoes,
      prioridade: prioridade.nivel,
      analiseIA: {
        ...(match.analiseIA || {}),
        ultimoRecalculo: new Date().toISOString(),
        scoreAnterior: match.score,
        justificativa: novo.justificativa,
      },
    },
  });

  return {
    atualizado: true,
    scoreAntigo: match.score,
    scoreNovo: novo.score,
  };
}

// ─── ATUALIZAR TODOS OS MATCHES PENDING DE UMA EMPRESA ───
async function atualizarScoresEmpresa(empresaId) {
  const matches = await prisma.match.findMany({
    where: { empresaId: parseInt(empresaId), status: 'PENDING' },
    select: { id: true },
  });

  console.log(`♻️  Recalculando ${matches.length} match(es) PENDING da empresa #${empresaId}...`);
  const results = { total: matches.length, atualizados: 0, ignorados: 0, falhas: 0 };

  for (const m of matches) {
    const r = await atualizarScoreMatch(m.id);
    if (!r) results.falhas++;
    else if (r.skipped) results.ignorados++;
    else if (r.atualizado) results.atualizados++;
  }

  console.log(`   ↳ ${results.atualizados} atualizados, ${results.ignorados} ignorados, ${results.falhas} falhas`);
  return results;
}

// ─── ATUALIZAR TODOS OS MATCHES PENDING DE UM ASSOCIADO ───
async function atualizarScoresAssociado(associadoId) {
  const matches = await prisma.match.findMany({
    where: { associadoId: parseInt(associadoId), status: 'PENDING' },
    select: { id: true },
  });

  console.log(`♻️  Recalculando ${matches.length} match(es) PENDING do associado #${associadoId}...`);
  const results = { total: matches.length, atualizados: 0, ignorados: 0, falhas: 0 };

  for (const m of matches) {
    const r = await atualizarScoreMatch(m.id);
    if (!r) results.falhas++;
    else if (r.skipped) results.ignorados++;
    else if (r.atualizado) results.atualizados++;
  }

  console.log(`   ↳ ${results.atualizados} atualizados, ${results.ignorados} ignorados, ${results.falhas} falhas`);
  return results;
}

// ─── ATUALIZAR TODOS OS MATCHES PENDING DO BANCO (cron) ───
async function atualizarTodosScoresPending() {
  // Pega matches PENDING, excluindo os de empresas restritas a evento
  // (eventoOrigemId != null) — essas empresas não devem ter score recalculado
  // porque elas só existem no contexto do evento que originou a inscrição.
  const matches = await prisma.match.findMany({
    where: {
      status: 'PENDING',
      empresa: { eventoOrigemId: null },
    },
    select: { id: true },
  });

  console.log(`⏰ [cron] Recalculando scores de ${matches.length} match(es) PENDING...`);
  const startTime = Date.now();
  const results = { total: matches.length, atualizados: 0, ignorados: 0, falhas: 0 };

  for (const m of matches) {
    const r = await atualizarScoreMatch(m.id);
    if (!r) results.falhas++;
    else if (r.skipped) results.ignorados++;
    else if (r.atualizado) results.atualizados++;
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(`⏰ [cron] Concluído em ${elapsed}s · ${results.atualizados} atualizados, ${results.ignorados} ignorados, ${results.falhas} falhas`);
  return results;
}

module.exports = {
  recalcularScorePar,
  atualizarScoreMatch,
  atualizarScoresEmpresa,
  atualizarScoresAssociado,
  atualizarTodosScoresPending,
};

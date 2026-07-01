// ═══════════════════════════════════════════════════════════
// MATCH VAGA SERVICE
// ═══════════════════════════════════════════════════════════
// Mesma lógica do scoringService (Empresa × Associado), mas pra par
// (Candidato × Vaga). Score gerado pelo Gemini. Atualiza só status PENDING.

const prisma = require('../config/database');
const { callGemini } = require('./aiService');

// ─── PROMPT BUILDER ───
function buildPairPrompt(candidato, vaga) {
  return `Avalie a aderência entre este CANDIDATO e esta VAGA. Retorne JSON com:
{
  "score": <0-100>,
  "oportunidade": "<resumo curto da aderência ou da fit>",
  "justificativa": "<2-3 frases explicando o score>"
}

Score 0-100 reflete a chance real de fit profissional, considerando:
- Match de habilidades / requisitos técnicos
- Compatibilidade do curso e período com a vaga
- Disponibilidade do candidato vs modalidade da vaga (estágio/CLT/etc)
- Alinhamento de localização (se vaga é presencial)
- Idiomas exigidos vs idiomas do candidato

Não filtre por score mínimo — sempre retorne um número, mesmo baixo.

CANDIDATO:
- Nome: ${candidato.nome}
- Curso: ${candidato.curso || '(não informado)'}
- Período: ${candidato.periodo || '(não informado)'}
- Habilidades: ${candidato.habilidades || '(não informado)'}
- Experiências: ${candidato.experiencias || '(não informado)'}
- Idiomas: ${candidato.idiomas || '(não informado)'}
- Disponibilidade: ${candidato.disponibilidade || '(não informado)'}
- Localização: ${candidato.cidade ? `${candidato.cidade}, ${candidato.estado || ''}` : '(não informado)'}

VAGA:
- Título: ${vaga.titulo}
- Área: ${vaga.area || '(não informado)'}
- Modalidade: ${vaga.modalidade || '(não informado)'}
- Local: ${vaga.local || '(não informado)'}
- Descrição: ${vaga.descricao || '(não informado)'}
- Requisitos: ${vaga.requisitos || '(não informado)'}
- Salário: ${vaga.salario || '(não informado)'}

Responda APENAS com o JSON.`;
}

// ─── CALCULAR SCORE DE UM PAR (sem persistir) ───
async function recalcularScorePar(candidato, vaga) {
  const prompt = buildPairPrompt(candidato, vaga);
  const systemInstruction = 'Você é um recrutador especialista em matching profissional. Responda apenas em JSON válido, sem markdown.';

  try {
    const response = await callGemini(prompt, systemInstruction);

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
      oportunidade: data.oportunidade || null,
      justificativa: data.justificativa || null,
    };
  } catch (err) {
    console.warn(`⚠️ Falha ao calcular score (candidato=${candidato.id} × vaga=${vaga.id}): ${err.message}`);
    return null;
  }
}

// ─── ATUALIZAR SCORE DE 1 MATCH NO BANCO ───
async function atualizarScoreMatch(matchId) {
  const match = await prisma.matchVaga.findUnique({
    where: { id: matchId },
    include: { candidato: true, vaga: true },
  });

  if (!match) return null;
  if (match.status !== 'PENDING') {
    return { atualizado: false, motivo: 'status != PENDING' };
  }

  const novo = await recalcularScorePar(match.candidato, match.vaga);
  if (!novo) return { atualizado: false, motivo: 'gemini falhou' };

  if (novo.score === match.score) {
    return { atualizado: false, motivo: 'score igual' };
  }

  await prisma.matchVaga.update({
    where: { id: matchId },
    data: {
      score: novo.score,
      observacoes: novo.oportunidade || match.observacoes,
      analiseIA: { ...(match.analiseIA || {}), justificativa: novo.justificativa, atualizadoEm: new Date().toISOString() },
    },
  });

  return { atualizado: true, scoreAntigo: match.score, scoreNovo: novo.score };
}

// ─── ATUALIZAR SCORES DE 1 CANDIDATO ───
async function atualizarScoresCandidato(candidatoId) {
  const matches = await prisma.matchVaga.findMany({
    where: { candidatoId, status: 'PENDING' },
    select: { id: true },
  });
  let ok = 0, fail = 0;
  for (const m of matches) {
    const r = await atualizarScoreMatch(m.id);
    if (r?.atualizado) ok++; else fail++;
  }
  return { ok, fail };
}

// ─── ATUALIZAR SCORES DE 1 VAGA ───
async function atualizarScoresVaga(vagaId) {
  const matches = await prisma.matchVaga.findMany({
    where: { vagaId, status: 'PENDING' },
    select: { id: true },
  });
  let ok = 0, fail = 0;
  for (const m of matches) {
    const r = await atualizarScoreMatch(m.id);
    if (r?.atualizado) ok++; else fail++;
  }
  return { ok, fail };
}

// ─── CRON: ATUALIZAR TODOS PENDING ───
async function atualizarTodosScoresPending() {
  const matches = await prisma.matchVaga.findMany({
    where: { status: 'PENDING' },
    select: { id: true },
  });
  console.log(`[scoringMatchVaga] Recalculando ${matches.length} match-vagas em PENDING...`);
  let ok = 0, fail = 0;
  for (const m of matches) {
    const r = await atualizarScoreMatch(m.id);
    if (r?.atualizado) ok++; else fail++;
  }
  console.log(`[scoringMatchVaga] Concluído: ${ok} atualizados, ${fail} pulados/falhas.`);
  return { ok, fail };
}

module.exports = {
  recalcularScorePar,
  atualizarScoreMatch,
  atualizarScoresCandidato,
  atualizarScoresVaga,
  atualizarTodosScoresPending,
};

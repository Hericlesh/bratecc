// ═══════════════════════════════════════════════════════════
// BRATECC Connect AI — Cron de recalculo de scores
// ═══════════════════════════════════════════════════════════
//
// Roda em background recalculando scores de matches PENDING via Gemini.
//
// Configuração via env:
//   • SCORE_CRON_ENABLED  (default: 'true')   liga/desliga
//   • SCORE_CRON_PATTERN  (default: '0 * * * *')   cron pattern (hora cheia)
//
// Padrões úteis:
//   '0 * * * *'    → toda hora cheia (default)
//   '0 */2 * * *'  → de 2 em 2 horas
//   '0 3 * * *'    → todo dia às 03:00
//   '*/15 * * * *' → de 15 em 15 minutos (só pra teste)
//
// O cron NÃO roda imediatamente no boot — espera o próximo tick.
// Para forçar um recalculo manual, use:
//   POST /api/ai/recalcular-scores  (admin only)
// ═══════════════════════════════════════════════════════════

const cron = require('node-cron');
const scoringService = require('./scoringService');
const matchVagaService = require('./matchVagaService');

let task = null;
let lastRun = null;
let lastResult = null;

function startScoreCron() {
  const enabled = (process.env.SCORE_CRON_ENABLED || 'true').toLowerCase() !== 'false';
  if (!enabled) {
    console.log('⏰ Score cron desabilitado (SCORE_CRON_ENABLED=false)');
    return;
  }

  const pattern = process.env.SCORE_CRON_PATTERN || '0 * * * *';

  if (!cron.validate(pattern)) {
    console.error(`❌ SCORE_CRON_PATTERN inválido: "${pattern}". Usando default '0 * * * *'.`);
    return startScoreCronWith('0 * * * *');
  }

  return startScoreCronWith(pattern);
}

function startScoreCronWith(pattern) {
  if (task) {
    task.stop();
  }

  task = cron.schedule(pattern, async () => {
    try {
      lastRun = new Date();
      // Roda os dois recalcs em paralelo: matches normais (Empresa × Associado)
      // e match-vagas (Candidato × Vaga). Resultado vai pro lastResult agregado.
      const [resultMatch, resultVaga] = await Promise.allSettled([
        scoringService.atualizarTodosScoresPending(),
        matchVagaService.atualizarTodosScoresPending(),
      ]);
      lastResult = {
        match: resultMatch.status === 'fulfilled' ? resultMatch.value : { error: resultMatch.reason?.message },
        matchVaga: resultVaga.status === 'fulfilled' ? resultVaga.value : { error: resultVaga.reason?.message },
      };
    } catch (err) {
      console.error('❌ Erro no cron de scores:', err.message);
      lastResult = { error: err.message };
    }
  });

  console.log(`⏰ Score cron ativado · pattern="${pattern}" · próximo tick conforme agenda`);
  return task;
}

function stopScoreCron() {
  if (task) {
    task.stop();
    task = null;
    console.log('⏰ Score cron parado');
  }
}

function getCronStatus() {
  return {
    enabled: !!task,
    pattern: process.env.SCORE_CRON_PATTERN || '0 * * * *',
    lastRun: lastRun ? lastRun.toISOString() : null,
    lastResult,
  };
}

module.exports = {
  startScoreCron,
  stopScoreCron,
  getCronStatus,
};

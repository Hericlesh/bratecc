// ═══════════════════════════════════════════════════════════
// WORKER DE RETRY DE HSMs WHATSAPP
// ═══════════════════════════════════════════════════════════
// Processa a tabela `WhatsappRetryQueue` a cada N segundos:
//   1. Pega itens com status=PENDING e nextAttemptAt <= now()
//   2. Marca como SENDING (lock soft pra evitar processamento duplo)
//   3. Chama sendTemplate(toPhone, templateName, languageCode, params)
//   4. Conforme resultado:
//      • Meta retorna 200 → status=PENDING + attempts++ + agenda próximo retry
//        (status final SENDING→DELIVERED só vem via webhook deliverySuccess)
//      • Meta retorna erro → status=PENDING + attempts++ + backoff maior
//      • Atingiu maxAttempts → status=ABANDONED
//
// Backoff: 30s, 1min, 2min, 5min, 10min, 30min, 1h, 2h, 4h, 8h.
// (Segue até maxAttempts; depois ABANDONED.)
//
// Quando o webhook recebe `delivered` ou `read` para o lastMessageId,
// marca o item como DELIVERED (em handleStatusUpdate).

const prisma = require('../config/database');

// Backoff em segundos por tentativa (índice 0 = primeiro retry)
const BACKOFF_SECONDS = [
  30,        // 1ª tentativa: 30s após falha
  60,        // 2ª: 1min
  120,       // 3ª: 2min
  300,       // 4ª: 5min
  600,       // 5ª: 10min
  1800,      // 6ª: 30min
  3600,      // 7ª: 1h
  7200,      // 8ª: 2h
  14400,     // 9ª: 4h
  28800,     // 10ª: 8h
];

const WORKER_INTERVAL_MS = 30 * 1000; // a cada 30s
const BATCH_SIZE = 5;                 // máximo de itens processados por tick (rate limit Meta)

let workerHandle = null;
let isProcessing = false;

function nextDelaySeconds(attempts) {
  // attempts é o número de tentativas FEITAS (1 = já fez uma vez, agora vai pra segunda)
  const idx = Math.min(attempts, BACKOFF_SECONDS.length - 1);
  return BACKOFF_SECONDS[idx];
}

async function processBatch() {
  if (isProcessing) {
    return;
  }
  isProcessing = true;

  try {
    const now = new Date();

    // Pega itens prontos pra retry
    const items = await prisma.whatsappRetryQueue.findMany({
      where: {
        status: 'PENDING',
        nextAttemptAt: { lte: now },
      },
      orderBy: { nextAttemptAt: 'asc' },
      take: BATCH_SIZE,
    });

    if (items.length === 0) {
      return;
    }

    console.log(`[RetryWorker] Processando ${items.length} item(s) da fila WhatsApp...`);

    // Lazy require pra evitar ciclo de dependência
    const whatsappService = require('./whatsappService');

    for (const item of items) {
      // Lock soft: marca como SENDING. Se outro tick rodar enquanto este trabalha,
      // o where status=PENDING evita pegar de novo.
      try {
        await prisma.whatsappRetryQueue.update({
          where: { id: item.id },
          data: { status: 'SENDING', lastAttemptAt: now },
        });
      } catch (err) {
        console.warn(`[RetryWorker] Falha ao lockar item #${item.id}:`, err.message);
        continue;
      }

      const attempts = item.attempts + 1;
      console.log(`[RetryWorker] Tentativa ${attempts}/${item.maxAttempts} → ${item.templateName} para ${item.toPhone}`);

      try {
        const result = await whatsappService.sendTemplate(
          item.toPhone,
          item.templateName,
          item.languageCode,
          item.params
        );

        if (result.success && result.messageId) {
          // Meta aceitou. NÃO marca DELIVERED ainda — espera webhook confirmar.
          // Se atingiu maxAttempts e ainda assim a Meta aceitou, considera entregue
          // pois é o melhor sinal que temos.
          if (attempts >= item.maxAttempts) {
            await prisma.whatsappRetryQueue.update({
              where: { id: item.id },
              data: {
                status: 'DELIVERED',
                attempts,
                lastMessageId: result.messageId,
                completedAt: new Date(),
              },
            });
            console.log(`[RetryWorker] ✅ Item #${item.id} marcado DELIVERED (tentativas esgotadas mas Meta aceitou).`);
          } else {
            // Volta pra PENDING com próximo retry agendado. Se webhook reportar
            // delivered antes desse próximo tick, será marcado DELIVERED.
            const nextDelay = nextDelaySeconds(attempts);
            const nextAt = new Date(Date.now() + nextDelay * 1000);
            await prisma.whatsappRetryQueue.update({
              where: { id: item.id },
              data: {
                status: 'PENDING',
                attempts,
                lastMessageId: result.messageId,
                nextAttemptAt: nextAt,
              },
            });
            console.log(`[RetryWorker] ✅ Item #${item.id} aceito pela Meta (msg=${result.messageId}). Próximo check em ${nextDelay}s caso webhook reporte falha.`);
          }
        } else {
          // Falha imediata na chamada à Meta
          const errCode = result.code || null;
          const errMsg = result.error || 'Falha desconhecida';

          // Erros irrecuperáveis (sem retry):
          //   132001 → template não existe
          //   131026 → número não está no WhatsApp / bloqueou business
          //   190    → token inválido (sistêmico — todos vão falhar)
          const irrecuperaveis = [132001, 131026, 190];
          const abandonar = irrecuperaveis.includes(errCode) || attempts >= item.maxAttempts;

          await prisma.whatsappRetryQueue.update({
            where: { id: item.id },
            data: {
              status: abandonar ? 'ABANDONED' : 'PENDING',
              attempts,
              lastErrorCode: errCode,
              lastErrorMsg: String(errMsg).substring(0, 500),
              nextAttemptAt: abandonar ? new Date() : new Date(Date.now() + nextDelaySeconds(attempts) * 1000),
              completedAt: abandonar ? new Date() : null,
            },
          });
          if (abandonar) {
            console.warn(`[RetryWorker] ❌ Item #${item.id} ABANDONADO (code=${errCode}, attempts=${attempts}/${item.maxAttempts}).`);
          } else {
            const nextDelay = nextDelaySeconds(attempts);
            console.warn(`[RetryWorker] ⏳ Item #${item.id} falhou (code=${errCode}); próximo retry em ${nextDelay}s.`);
          }
        }
      } catch (err) {
        // Exceção (erro de rede, timeout, etc) — agenda novo retry
        const abandonar = attempts >= item.maxAttempts;
        await prisma.whatsappRetryQueue.update({
          where: { id: item.id },
          data: {
            status: abandonar ? 'ABANDONED' : 'PENDING',
            attempts,
            lastErrorMsg: String(err.message || err).substring(0, 500),
            nextAttemptAt: abandonar ? new Date() : new Date(Date.now() + nextDelaySeconds(attempts) * 1000),
            completedAt: abandonar ? new Date() : null,
          },
        }).catch(() => {});
        console.error(`[RetryWorker] Exceção em #${item.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[RetryWorker] Erro geral:', err.message);
  } finally {
    isProcessing = false;
  }
}

// ─── ENFILEIRAR UM RETRY ───
// Chamado pelo handleStatusUpdate quando webhook reporta failed (especialmente 131049).
// Recebe o context original do envio (template + params + destinatário) e o erro.
async function enqueueRetry({
  toPhone,
  templateName,
  languageCode,
  params,
  originalMessageId,
  errorCode,
  errorMessage,
  matchId = null,
  matchB2BId = null,
  context = null,
  maxAttempts = 10,
}) {
  // Anti-duplicação: se já existe item PENDING/SENDING pro mesmo originalMessageId, não cria de novo
  if (originalMessageId) {
    const existente = await prisma.whatsappRetryQueue.findFirst({
      where: {
        originalMessageId,
        status: { in: ['PENDING', 'SENDING'] },
      },
    });
    if (existente) {
      console.log(`[RetryWorker] Já existe retry pendente pro message_id ${originalMessageId} (queue#${existente.id}) — não duplico.`);
      return existente;
    }
  }

  const nextAt = new Date(Date.now() + BACKOFF_SECONDS[0] * 1000);

  const item = await prisma.whatsappRetryQueue.create({
    data: {
      toPhone,
      templateName,
      languageCode: languageCode || 'pt_BR',
      params,
      originalMessageId,
      matchId,
      matchB2BId,
      context,
      maxAttempts,
      lastErrorCode: errorCode || null,
      lastErrorMsg: errorMessage ? String(errorMessage).substring(0, 500) : null,
      nextAttemptAt: nextAt,
      status: 'PENDING',
    },
  });

  console.log(`[RetryWorker] ➕ Enfileirado #${item.id}: ${templateName} → ${toPhone} (próx tentativa em ${BACKOFF_SECONDS[0]}s, code=${errorCode || 'n/a'})`);
  return item;
}

// ─── MARCAR COMO DELIVERED VIA WEBHOOK ───
// Quando o webhook recebe `delivered` ou `read` para o último message_id de
// um retry, marca como concluído.
async function markDeliveredByMessageId(messageId) {
  if (!messageId) return null;
  try {
    const item = await prisma.whatsappRetryQueue.findFirst({
      where: {
        lastMessageId: messageId,
        status: { in: ['PENDING', 'SENDING'] },
      },
    });
    if (!item) return null;

    await prisma.whatsappRetryQueue.update({
      where: { id: item.id },
      data: {
        status: 'DELIVERED',
        completedAt: new Date(),
      },
    });
    console.log(`[RetryWorker] ✅ Item #${item.id} marcado DELIVERED via webhook (msg=${messageId})`);
    return item;
  } catch (err) {
    console.warn('[RetryWorker] Erro ao marcar DELIVERED:', err.message);
    return null;
  }
}

// ─── ESTADO DA FILA (pra debug/admin) ───
async function getQueueStats() {
  const stats = await prisma.whatsappRetryQueue.groupBy({
    by: ['status'],
    _count: true,
  });
  const map = { PENDING: 0, SENDING: 0, DELIVERED: 0, ABANDONED: 0 };
  for (const s of stats) map[s.status] = s._count;
  return map;
}

// ─── BOOT DO WORKER ───
function startWorker() {
  if (workerHandle) {
    console.warn('[RetryWorker] Já rodando — não inicio de novo.');
    return;
  }
  console.log(`[RetryWorker] Iniciando · intervalo=${WORKER_INTERVAL_MS}ms · batch=${BATCH_SIZE} · backoff=[${BACKOFF_SECONDS.join(',')}]s`);

  // Primeira execução imediata pra processar o que ficou pendente entre restarts
  processBatch().catch(err => console.error('[RetryWorker] Erro no boot:', err));

  workerHandle = setInterval(() => {
    processBatch().catch(err => console.error('[RetryWorker] Erro no tick:', err));
  }, WORKER_INTERVAL_MS);

  // Limpeza graceful em SIGTERM
  process.on('SIGTERM', stopWorker);
}

function stopWorker() {
  if (workerHandle) {
    clearInterval(workerHandle);
    workerHandle = null;
    console.log('[RetryWorker] Parado.');
  }
}

module.exports = {
  startWorker,
  stopWorker,
  enqueueRetry,
  markDeliveredByMessageId,
  getQueueStats,
  processBatch, // exposto pra trigger manual via endpoint admin se quiser
};

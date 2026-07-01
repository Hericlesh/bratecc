-- ═══════════════════════════════════════════════════════════
-- WHATSAPP RETRY QUEUE (manual migration)
-- ═══════════════════════════════════════════════════════════
-- Cria a tabela `whatsapp_retry_queue` para persistir tentativas de reenvio
-- de HSMs que falharam (em especial 131049 — ecosystem engagement block).
-- O worker `whatsappRetryWorker` (em src/services/) processa a fila a cada 30s.
--
-- Como rodar (caso `prisma db push` não pegue automaticamente):
--   docker compose exec postgres psql -U bratecc -d bratecc_db \
--     -f /tmp/manual_whatsapp_retry_queue.sql
--
-- Ou (mais limpo):
--   docker compose exec backend npx prisma db push --accept-data-loss

-- Enum de status
DO $$ BEGIN
  CREATE TYPE "WhatsappRetryStatus" AS ENUM ('PENDING', 'SENDING', 'DELIVERED', 'ABANDONED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Tabela
CREATE TABLE IF NOT EXISTS "whatsapp_retry_queue" (
  "id"                SERIAL PRIMARY KEY,
  "toPhone"           TEXT NOT NULL,
  "templateName"      TEXT NOT NULL,
  "languageCode"      TEXT NOT NULL DEFAULT 'pt_BR',
  "params"            JSONB NOT NULL,

  "originalMessageId" TEXT,
  "matchId"           INTEGER,
  "matchB2BId"        INTEGER,
  "context"           TEXT,

  "status"            "WhatsappRetryStatus" NOT NULL DEFAULT 'PENDING',
  "attempts"          INTEGER NOT NULL DEFAULT 0,
  "maxAttempts"       INTEGER NOT NULL DEFAULT 10,
  "lastErrorCode"     INTEGER,
  "lastErrorMsg"      TEXT,
  "lastAttemptAt"     TIMESTAMP(3),
  "nextAttemptAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastMessageId"     TEXT,

  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt"       TIMESTAMP(3)
);

-- Índices
CREATE INDEX IF NOT EXISTS "whatsapp_retry_queue_status_nextAttemptAt_idx"
  ON "whatsapp_retry_queue" ("status", "nextAttemptAt");
CREATE INDEX IF NOT EXISTS "whatsapp_retry_queue_originalMessageId_idx"
  ON "whatsapp_retry_queue" ("originalMessageId");
CREATE INDEX IF NOT EXISTS "whatsapp_retry_queue_toPhone_idx"
  ON "whatsapp_retry_queue" ("toPhone");

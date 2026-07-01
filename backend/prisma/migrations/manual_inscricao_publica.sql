-- ═══════════════════════════════════════════════════════════════
-- MIGRATION: Inscrição pública de empresas em eventos
-- ═══════════════════════════════════════════════════════════════
-- 1. Adiciona slug + flag de ativação em eventos (link público)
-- 2. Adiciona eventoOrigemId em empresas (empresa restrita ao evento)
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE "eventos"
  ADD COLUMN IF NOT EXISTS "inscricaoSlug" TEXT,
  ADD COLUMN IF NOT EXISTS "inscricaoAtiva" BOOLEAN NOT NULL DEFAULT true;

-- Slug é único quando preenchido (nullable + unique)
CREATE UNIQUE INDEX IF NOT EXISTS "eventos_inscricaoSlug_key"
  ON "eventos"("inscricaoSlug") WHERE "inscricaoSlug" IS NOT NULL;

ALTER TABLE "empresas"
  ADD COLUMN IF NOT EXISTS "eventoOrigemId" INTEGER;

-- FK com SET NULL: se o evento é deletado, a empresa fica sem vínculo de origem
-- (mas continua existindo; admin decide se mantém ou remove)
ALTER TABLE "empresas"
  DROP CONSTRAINT IF EXISTS "fk_empresas_evento_origem";

ALTER TABLE "empresas"
  ADD CONSTRAINT "fk_empresas_evento_origem"
  FOREIGN KEY ("eventoOrigemId") REFERENCES "eventos"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "idx_empresas_evento_origem"
  ON "empresas"("eventoOrigemId");

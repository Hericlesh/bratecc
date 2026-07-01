-- ═══════════════════════════════════════════════════════════════
-- MIGRATION: Adiciona campo tipoPessoa em associados
-- ═══════════════════════════════════════════════════════════════
-- Apenas metadado: "FISICA" ou "JURIDICA". Não afeta regras de negócio.
-- Nullable porque registros antigos não têm esse dado.

ALTER TABLE "associados"
  ADD COLUMN IF NOT EXISTS "tipoPessoa" TEXT;

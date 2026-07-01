-- ═══════════════════════════════════════════════════════════════
-- MIGRATION MANUAL: CHECK constraint em matches_b2b
-- ═══════════════════════════════════════════════════════════════
-- Força que associadoOrigem seja sempre < associadoDestino, garantindo
-- que não existam registros duplicados do tipo (A, B) e (B, A).
-- Combinado com o @@unique([associadoOrigem, associadoDestino]) do schema,
-- garante unicidade simétrica do par de associados.
--
-- Como aplicar:
--   psql -U usuario -d bratecc_db -f manual_matchb2b_check.sql
--
-- Como reverter:
--   ALTER TABLE matches_b2b DROP CONSTRAINT chk_matchb2b_ordered_pair;
-- ═══════════════════════════════════════════════════════════════

-- Antes de adicionar o CHECK, normaliza registros existentes:
-- se algum par (A, B) tem A > B, troca origem/destino de posição
-- (só executa se houver necessidade — seguro em banco vazio também)
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id, "associadoOrigem", "associadoDestino", "servicoOrigem", "servicoDestino"
           FROM matches_b2b
           WHERE "associadoOrigem" > "associadoDestino"
  LOOP
    UPDATE matches_b2b
    SET "associadoOrigem"  = r."associadoDestino",
        "associadoDestino" = r."associadoOrigem",
        "servicoOrigem"    = r."servicoDestino",
        "servicoDestino"   = r."servicoOrigem"
    WHERE id = r.id;
  END LOOP;
END $$;

-- Remove possíveis duplicatas que surgiram da normalização acima
-- (mantém o registro mais recente)
DELETE FROM matches_b2b a
USING matches_b2b b
WHERE a.id < b.id
  AND a."associadoOrigem" = b."associadoOrigem"
  AND a."associadoDestino" = b."associadoDestino";

-- Adiciona o CHECK constraint
ALTER TABLE matches_b2b
  ADD CONSTRAINT chk_matchb2b_ordered_pair
  CHECK ("associadoOrigem" < "associadoDestino");

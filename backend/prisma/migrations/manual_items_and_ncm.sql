-- ═══════════════════════════════════════════════════════════════
-- MIGRATION: Items e NcmCache
-- ═══════════════════════════════════════════════════════════════
-- Cria as tabelas para itens individuais de produtos/serviços
-- (OFERECIDOS ou DEMANDADOS) e o cache local de códigos NCM.
--
-- Esta migration NÃO remove os campos antigos produtosOferecidos/
-- produtosDemandados de empresas/associados — eles ficam como legado.
-- ═══════════════════════════════════════════════════════════════

-- Enum de tipo do item
DO $$ BEGIN
  CREATE TYPE "TipoItem" AS ENUM ('OFERECIDO', 'DEMANDADO');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Tabela items
CREATE TABLE IF NOT EXISTS "items" (
  "id" SERIAL PRIMARY KEY,
  "nome" TEXT NOT NULL,
  "tipo" "TipoItem" NOT NULL,
  "ncmCodigo" TEXT,
  "ncmDescricao" TEXT,
  "empresaId" INTEGER,
  "associadoId" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fk_items_empresa" FOREIGN KEY ("empresaId")
    REFERENCES "empresas"("id") ON DELETE CASCADE,
  CONSTRAINT "fk_items_associado" FOREIGN KEY ("associadoId")
    REFERENCES "associados"("id") ON DELETE CASCADE,
  CONSTRAINT "chk_items_owner"
    CHECK (
      ("empresaId" IS NOT NULL AND "associadoId" IS NULL) OR
      ("empresaId" IS NULL AND "associadoId" IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS "idx_items_empresa_tipo"
  ON "items"("empresaId", "tipo");
CREATE INDEX IF NOT EXISTS "idx_items_associado_tipo"
  ON "items"("associadoId", "tipo");
CREATE INDEX IF NOT EXISTS "idx_items_ncm"
  ON "items"("ncmCodigo");

-- Trigger pra updatedAt automático
CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_timestamp_items ON "items";
CREATE TRIGGER set_timestamp_items
BEFORE UPDATE ON "items"
FOR EACH ROW
EXECUTE FUNCTION trigger_set_timestamp();

-- Tabela ncm_cache
CREATE TABLE IF NOT EXISTS "ncm_cache" (
  "codigo" TEXT PRIMARY KEY,
  "descricao" TEXT NOT NULL,
  "capitulo" TEXT,
  "atualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "idx_ncm_descricao"
  ON "ncm_cache"("descricao");

DROP TRIGGER IF EXISTS set_timestamp_ncm_cache ON "ncm_cache";
CREATE TRIGGER set_timestamp_ncm_cache
BEFORE UPDATE ON "ncm_cache"
FOR EACH ROW
EXECUTE FUNCTION trigger_set_timestamp();

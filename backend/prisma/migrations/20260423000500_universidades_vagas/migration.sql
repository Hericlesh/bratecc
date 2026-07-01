-- ═══════════════════════════════════════════════════════════
-- UNIVERSIDADES, CANDIDATOS, VAGAS, MATCH_VAGAS
-- ═══════════════════════════════════════════════════════════
-- Módulo de empregabilidade BRATECC Connect:
--   • universidades — entidade que cadastra estudantes
--   • candidatos — perfis profissionais cadastrados pelas universidades
--   • vagas — oportunidades de emprego cadastradas pelos associados
--   • match_vagas — cruzamento candidato × vaga gerado pela IA
-- Também adiciona o role 'UNIVERSIDADE' ao enum Role (login próprio).
-- Idempotente (IF NOT EXISTS) para ser seguro em bancos já sincronizados via db push.

-- 1. Adiciona UNIVERSIDADE ao enum Role
DO $$ BEGIN
  ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'UNIVERSIDADE';
EXCEPTION WHEN others THEN NULL; END $$;

-- 2. Tabela universidades
CREATE TABLE IF NOT EXISTS "universidades" (
  "id"          SERIAL PRIMARY KEY,
  "nome"        TEXT NOT NULL,
  "sigla"       TEXT,
  "cidade"      TEXT,
  "estado"      TEXT,
  "email"       TEXT NOT NULL UNIQUE,
  "telefone"    TEXT,
  "responsavel" TEXT,
  "descricao"   TEXT,
  "ativo"       BOOLEAN NOT NULL DEFAULT true,
  "userId"      INTEGER UNIQUE,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "universidades_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "universidades_estado_cidade_idx" ON "universidades" ("estado", "cidade");

-- 3. Tabela candidatos
CREATE TABLE IF NOT EXISTS "candidatos" (
  "id"               SERIAL PRIMARY KEY,
  "universidadeId"   INTEGER NOT NULL,
  "nome"             TEXT NOT NULL,
  "email"            TEXT,
  "telefone"         TEXT,
  "whatsapp"         TEXT,
  "curso"            TEXT,
  "periodo"          TEXT,
  "habilidades"      TEXT,
  "experiencias"     TEXT,
  "curriculoUrl"     TEXT,
  "disponibilidade"  TEXT,
  "idiomas"          TEXT,
  "cidade"           TEXT,
  "estado"           TEXT,
  "ativo"            BOOLEAN NOT NULL DEFAULT true,
  "classificacaoIA"  JSONB,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "candidatos_universidadeId_fkey" FOREIGN KEY ("universidadeId") REFERENCES "universidades"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "candidatos_universidadeId_idx" ON "candidatos" ("universidadeId");

-- 4. Tabela vagas
CREATE TABLE IF NOT EXISTS "vagas" (
  "id"            SERIAL PRIMARY KEY,
  "associadoId"   INTEGER NOT NULL,
  "titulo"        TEXT NOT NULL,
  "area"          TEXT,
  "modalidade"    TEXT,
  "local"         TEXT,
  "descricao"     TEXT,
  "requisitos"    TEXT,
  "beneficios"    TEXT,
  "salario"       TEXT,
  "aberta"        BOOLEAN NOT NULL DEFAULT true,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "vagas_associadoId_fkey" FOREIGN KEY ("associadoId") REFERENCES "associados"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "vagas_associadoId_aberta_idx" ON "vagas" ("associadoId", "aberta");

-- 5. Tabela match_vagas
CREATE TABLE IF NOT EXISTS "match_vagas" (
  "id"            SERIAL PRIMARY KEY,
  "candidatoId"   INTEGER NOT NULL,
  "vagaId"        INTEGER NOT NULL,
  "score"         INTEGER NOT NULL,
  "status"        "StatusMatch" NOT NULL DEFAULT 'PENDING',
  "observacoes"   TEXT,
  "analiseIA"     JSONB,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "match_vagas_candidatoId_fkey" FOREIGN KEY ("candidatoId") REFERENCES "candidatos"("id") ON DELETE CASCADE,
  CONSTRAINT "match_vagas_vagaId_fkey" FOREIGN KEY ("vagaId") REFERENCES "vagas"("id") ON DELETE CASCADE,
  CONSTRAINT "match_vagas_candidatoId_vagaId_key" UNIQUE ("candidatoId", "vagaId")
);

CREATE INDEX IF NOT EXISTS "match_vagas_status_idx" ON "match_vagas" ("status");

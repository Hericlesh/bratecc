-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'ASSOCIADO');

-- CreateEnum
CREATE TYPE "TipoEmpresa" AS ENUM ('EXPORTADOR', 'IMPORTADOR', 'AMBOS');

-- CreateEnum
CREATE TYPE "StatusEvento" AS ENUM ('PLANEJADO', 'ATIVO', 'FINALIZADO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "StatusMatch" AS ENUM ('PENDING', 'CONTACTED', 'INTERESTED', 'CONFIRMED', 'REJECTED');

-- CreateEnum
CREATE TYPE "TipoMatchEvento" AS ENUM ('EMPRESA_EMPRESA', 'EMPRESA_ASSOCIADO', 'ASSOCIADO_EMPRESA');

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "senha" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'ASSOCIADO',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "empresas" (
    "id" SERIAL NOT NULL,
    "nome" TEXT NOT NULL,
    "setor" TEXT NOT NULL,
    "porte" TEXT,
    "cidade" TEXT NOT NULL,
    "estado" TEXT NOT NULL,
    "tipo" "TipoEmpresa" NOT NULL,
    "email" TEXT NOT NULL,
    "telefone" TEXT,
    "descricao" TEXT,
    "necessidades" TEXT,
    "produtosOferecidos" TEXT,
    "produtosDemandados" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "classificacaoIA" JSONB,

    CONSTRAINT "empresas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "associados" (
    "id" SERIAL NOT NULL,
    "nome" TEXT NOT NULL,
    "segmento" TEXT NOT NULL,
    "porte" TEXT,
    "email" TEXT NOT NULL,
    "telefone" TEXT,
    "whatsapp" TEXT,
    "servicos" TEXT,
    "produtosOferecidos" TEXT,
    "produtosDemandados" TEXT,
    "descricao" TEXT,
    "categorias" TEXT[],
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "classificacaoIA" JSONB,
    "userId" INTEGER,

    CONSTRAINT "associados_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eventos" (
    "id" SERIAL NOT NULL,
    "nome" TEXT NOT NULL,
    "local" TEXT NOT NULL,
    "data" TIMESTAMP(3) NOT NULL,
    "dataFim" TIMESTAMP(3),
    "descricao" TEXT,
    "numeroWhatsapp" TEXT,
    "status" "StatusEvento" NOT NULL DEFAULT 'PLANEJADO',
    "categorias" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "eventos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matches" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "associadoId" INTEGER NOT NULL,
    "score" INTEGER NOT NULL,
    "status" "StatusMatch" NOT NULL DEFAULT 'PENDING',
    "produto" TEXT,
    "observacoes" TEXT,
    "prioridade" TEXT,
    "analiseIA" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matches_b2b" (
    "id" SERIAL NOT NULL,
    "associadoOrigem" INTEGER NOT NULL,
    "associadoDestino" INTEGER NOT NULL,
    "score" INTEGER NOT NULL,
    "status" "StatusMatch" NOT NULL DEFAULT 'PENDING',
    "sinergia" TEXT,
    "servicoOrigem" TEXT,
    "servicoDestino" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "matches_b2b_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evento_participantes" (
    "id" SERIAL NOT NULL,
    "eventoId" INTEGER NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "confirmado" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evento_participantes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evento_associados" (
    "id" SERIAL NOT NULL,
    "eventoId" INTEGER NOT NULL,
    "associadoId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evento_associados_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matches_evento" (
    "id" SERIAL NOT NULL,
    "eventoId" INTEGER NOT NULL,
    "tipoMatch" "TipoMatchEvento" NOT NULL,
    "entidade1Id" INTEGER NOT NULL,
    "entidade2Id" INTEGER NOT NULL,
    "score" INTEGER NOT NULL,
    "status" "StatusMatch" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "matches_evento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_logs" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" INTEGER,
    "details" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "empresas_email_key" ON "empresas"("email");

-- CreateIndex
CREATE UNIQUE INDEX "associados_email_key" ON "associados"("email");

-- CreateIndex
CREATE UNIQUE INDEX "associados_userId_key" ON "associados"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "matches_empresaId_associadoId_key" ON "matches"("empresaId", "associadoId");

-- CreateIndex
CREATE UNIQUE INDEX "matches_b2b_associadoOrigem_associadoDestino_key" ON "matches_b2b"("associadoOrigem", "associadoDestino");

-- CreateIndex
CREATE UNIQUE INDEX "evento_participantes_eventoId_empresaId_key" ON "evento_participantes"("eventoId", "empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "evento_associados_eventoId_associadoId_key" ON "evento_associados"("eventoId", "associadoId");

-- AddForeignKey
ALTER TABLE "associados" ADD CONSTRAINT "associados_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_associadoId_fkey" FOREIGN KEY ("associadoId") REFERENCES "associados"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches_b2b" ADD CONSTRAINT "matches_b2b_associadoOrigem_fkey" FOREIGN KEY ("associadoOrigem") REFERENCES "associados"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches_b2b" ADD CONSTRAINT "matches_b2b_associadoDestino_fkey" FOREIGN KEY ("associadoDestino") REFERENCES "associados"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evento_participantes" ADD CONSTRAINT "evento_participantes_eventoId_fkey" FOREIGN KEY ("eventoId") REFERENCES "eventos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evento_participantes" ADD CONSTRAINT "evento_participantes_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evento_associados" ADD CONSTRAINT "evento_associados_eventoId_fkey" FOREIGN KEY ("eventoId") REFERENCES "eventos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evento_associados" ADD CONSTRAINT "evento_associados_associadoId_fkey" FOREIGN KEY ("associadoId") REFERENCES "associados"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches_evento" ADD CONSTRAINT "matches_evento_eventoId_fkey" FOREIGN KEY ("eventoId") REFERENCES "eventos"("id") ON DELETE CASCADE ON UPDATE CASCADE;


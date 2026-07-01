#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// Setup do banco — aplica todas as migrations SQL diretamente via pg
// ═══════════════════════════════════════════════════════════════
// Ideal para quem não quer depender do `prisma migrate` (que exige
// versão compatível do CLI). Este script:
//   1. Conecta via DATABASE_URL (ou DATABASE_URL do .env)
//   2. Aplica cada migration em ordem alfabética
//   3. Usa IF NOT EXISTS quando possível — é idempotente
//   4. Gera o Prisma Client ao final
//
// Uso:
//   npm run db:setup
//
// Equivale a: criar tabelas + rodar as manuais + gerar client
// ═══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Carrega .env local (se existir)
try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch {
  // dotenv opcional
}

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('❌ DATABASE_URL não encontrada. Defina no .env ou como variável de ambiente.');
  process.exit(1);
}

async function main() {
  // pg é dependência do @prisma/client, vem junto
  let Client;
  try {
    Client = require('pg').Client;
  } catch {
    console.error('❌ Módulo `pg` não encontrado. Rode: npm install pg');
    process.exit(1);
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  console.log('✅ Conectado ao banco');

  const migrationsDir = path.join(__dirname, '..', 'prisma', 'migrations');
  const dirs = fs.readdirSync(migrationsDir)
    .filter(f => {
      const full = path.join(migrationsDir, f);
      return fs.statSync(full).isDirectory() && /^\d{14}_/.test(f);
    })
    .sort();

  if (dirs.length === 0) {
    console.error('❌ Nenhuma migration encontrada em prisma/migrations/');
    process.exit(1);
  }

  for (const dir of dirs) {
    const sqlPath = path.join(migrationsDir, dir, 'migration.sql');
    if (!fs.existsSync(sqlPath)) {
      console.warn(`⚠️  ${dir}: sem migration.sql — pulando`);
      continue;
    }
    const sql = fs.readFileSync(sqlPath, 'utf8');
    console.log(`📦 Aplicando ${dir}...`);
    try {
      await client.query(sql);
      console.log(`   ✅ OK`);
    } catch (err) {
      // Erros "already exists" não são fatais (idempotente)
      const msg = String(err.message || '');
      if (msg.includes('already exists') || err.code === '42P07' || err.code === '42710') {
        console.log(`   ⏭️  Já existia (pulado)`);
        continue;
      }
      console.error(`   ❌ Erro: ${err.message}`);
      await client.end();
      process.exit(1);
    }
  }

  await client.end();
  console.log('');
  console.log('🎉 Banco pronto! Gerando Prisma Client...');

  // Gera o client a partir do schema atual
  try {
    execSync('npx prisma generate', {
      cwd: path.join(__dirname, '..'),
      stdio: 'inherit'
    });
  } catch (err) {
    console.warn('⚠️  Falha ao gerar Prisma Client. Rode manualmente: npx prisma generate');
  }

  console.log('');
  console.log('✨ Setup completo! Você pode rodar:');
  console.log('   npm run dev       # inicia o backend');
  console.log('   npm run db:seed   # popula dados de exemplo (opcional)');
}

main().catch(err => {
  console.error('❌ Erro fatal:', err);
  process.exit(1);
});

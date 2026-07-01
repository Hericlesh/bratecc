// ═══════════════════════════════════════════════════════════
// BRATECC Connect AI — Seed MÍNIMO
// ═══════════════════════════════════════════════════════════
//
// Apaga TUDO do banco e cria APENAS 1 usuário ADMIN.
// Sem empresas, sem associados, sem eventos, sem matches, sem items.
// O admin cadastra tudo manualmente depois pela interface.
//
// Uso:
//   • Local: node prisma/seed-minimal.js
//   • Docker: RUN_DB_SEED=minimal docker compose up -d --build
//   • Make:  make seed-minimal
//
// Credenciais (configuráveis via env):
//   • ADMIN_EMAIL    (default: admin@bratecc.com)
//   • ADMIN_PASSWORD (default: admin123)
//
// ═══════════════════════════════════════════════════════════

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Iniciando seed MÍNIMO (banco zerado, só admin)...\n');

  // ─── LIMPAR TUDO ───
  // Ordem importa: filhos antes de pais para evitar FK violation.
  console.log('🗑️  Limpando todos os dados existentes...');
  await prisma.activityLog.deleteMany();
  await prisma.matchEvento.deleteMany();
  await prisma.eventoAssociado.deleteMany();
  await prisma.eventoParticipante.deleteMany();
  await prisma.matchB2B.deleteMany();
  await prisma.match.deleteMany();
  await prisma.item.deleteMany();
  await prisma.evento.deleteMany();
  await prisma.associado.deleteMany();
  await prisma.empresa.deleteMany();
  await prisma.user.deleteMany();
  // NcmCache não é apagado — é cache da Siscomex, demora pra repopular.

  console.log('✅ Banco limpo.\n');

  // ─── CRIAR USUÁRIO ADMIN ───
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@bratecc.com';
  const adminPasswordPlain = process.env.ADMIN_PASSWORD || 'admin123';
  const adminPassword = await bcrypt.hash(adminPasswordPlain, 10);

  await prisma.user.create({
    data: {
      email: adminEmail,
      senha: adminPassword,
      role: 'ADMIN',
    },
  });
  console.log('👤 Admin criado.');

  // ─── CADASTROS DE TESTE: Associado Hericles + Empresa Zeo Tec ───
  // Solicitados pelo cliente para testar o fluxo de match em ambiente limpo.
  // Editáveis depois pela interface admin.

  const hericles = await prisma.associado.create({
    data: {
      nome: 'Hericles',
      tipoPessoa: 'FISICA',
      segmento: 'Technology',
      email: 'hericleshsv3@gmail.com',
      telefone: '+5534999786778',
      whatsapp: '+5534999786778',
      servicos: 'Consultoria em tecnologia, software, sistemas',
      produtosOferecidos: 'Soluções de software, automação',
      categorias: ['Technology'],
      ativo: true,
    },
  });
  console.log(`🤝 Associado criado: ${hericles.nome} <${hericles.email}> (${hericles.whatsapp})`);

  const zeoTec = await prisma.empresa.create({
    data: {
      nome: 'Zeo Tec',
      setor: 'Technology',
      cidade: 'Uberlândia',
      estado: 'MG',
      tipo: 'AMBOS',
      email: 'hericlessoares9889@gmail.com',
      telefone: '+5534991959100',
      necessidades: 'Consultoria em tecnologia e automação',
      produtosDemandados: 'Software, sistemas, automação',
      ativo: true,
    },
  });
  console.log(`🏢 Empresa criada: ${zeoTec.nome} <${zeoTec.email}> (${zeoTec.telefone})`);

  // ─── GERAR MATCHES VIA GEMINI ───
  // Mesmo fluxo do empresaController/associadoController.create: par-a-par.
  // Toda combinação ganha score, sem filtro de score mínimo.
  let matchesCriados = 0;
  if (process.env.GEMINI_API_KEY) {
    try {
      console.log('\n🤖 Calculando matches via Gemini para combinações criadas...');
      const scoringService = require('../src/services/scoringService');

      const empresas = await prisma.empresa.findMany({ where: { ativo: true } });
      const associados = await prisma.associado.findMany({ where: { ativo: true } });

      for (const emp of empresas) {
        for (const assoc of associados) {
          const existe = await prisma.match.findUnique({
            where: { empresaId_associadoId: { empresaId: emp.id, associadoId: assoc.id } },
          });
          if (existe) continue;

          const score = await scoringService.recalcularScorePar(emp, assoc);
          if (!score) {
            console.warn(`   ⚠️ Gemini não retornou score para ${emp.nome} × ${assoc.nome} — pulando`);
            continue;
          }

          const prioridade = score.score >= 80 ? 'alta' : score.score >= 60 ? 'media' : 'baixa';
          try {
            await prisma.match.create({
              data: {
                empresaId: emp.id,
                associadoId: assoc.id,
                score: score.score,
                produto: score.produto,
                observacoes: score.oportunidade,
                status: 'PENDING',
                prioridade,
                analiseIA: { justificativa: score.justificativa, geradoEm: new Date().toISOString() },
              },
            });
            console.log(`   ✓ ${emp.nome} × ${assoc.nome} → score ${score.score}`);
            matchesCriados++;
          } catch (e) {
            console.warn(`   ⚠️ Falha ao salvar match ${emp.nome} × ${assoc.nome}: ${e.message}`);
          }
        }
      }
    } catch (err) {
      console.warn(`⚠️ Geração Gemini durante seed falhou: ${err.message}`);
    }
  } else {
    console.warn('⚠️ GEMINI_API_KEY não configurada — pulando cálculo automático de matches no seed.');
    console.warn('   Use o botão "Gerar Matches" na interface admin depois.');
  }

  console.log(`
✅ Seed mínimo concluído!

📊 Estado do banco:
   • 1 usuário ADMIN
   • 1 associado (Hericles)
   • 1 empresa (Zeo Tec)
   • 0 eventos
   • ${matchesCriados} matche(s) Gemini

🔐 Credenciais:
   • Email: ${adminEmail}
   • Senha: ${adminPasswordPlain}

➡️  Faça login → vá em "Assoc × Empresa".
   ${matchesCriados > 0
     ? `O match Hericles × Zeo Tec já está com score Gemini real.`
     : `Use o botão "Gerar Matches" pra criar os matches via IA.`}
`);
}

main()
  .catch((e) => {
    console.error('❌ Erro no seed mínimo:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

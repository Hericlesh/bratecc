// ═══════════════════════════════════════════════════════════
// BRATECC Connect AI - Seed do Banco de Dados
// ═══════════════════════════════════════════════════════════

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Iniciando seed do banco de dados...\n');

  // ─── LIMPAR DADOS EXISTENTES ───
  console.log('🗑️  Limpando dados existentes...');
  await prisma.activityLog.deleteMany();
  await prisma.matchEvento.deleteMany();
  await prisma.eventoAssociado.deleteMany();
  await prisma.eventoParticipante.deleteMany();
  await prisma.matchB2B.deleteMany();
  await prisma.match.deleteMany();
  await prisma.evento.deleteMany();
  await prisma.associado.deleteMany();
  await prisma.empresa.deleteMany();
  await prisma.user.deleteMany();

  // ─── CRIAR USUÁRIOS ───
  console.log('👤 Criando usuários...');
  
  const adminPassword = await bcrypt.hash('admin123', 10);
  const fintechPassword = await bcrypt.hash('fintech123', 10);
  const logisticsPassword = await bcrypt.hash('logistics123', 10);
  const legalPassword = await bcrypt.hash('legal123', 10);
  const techPassword = await bcrypt.hash('tech123', 10);
  const agroPassword = await bcrypt.hash('agro123', 10);

  const adminUser = await prisma.user.create({
    data: {
      email: 'admin@bratecc.com',
      senha: adminPassword,
      role: 'ADMIN'
    }
  });

  const fintechUser = await prisma.user.create({
    data: {
      email: 'fintech@bratecc.com',
      senha: fintechPassword,
      role: 'ASSOCIADO'
    }
  });

  const logisticsUser = await prisma.user.create({
    data: {
      email: 'logistics@bratecc.com',
      senha: logisticsPassword,
      role: 'ASSOCIADO'
    }
  });

  const legalUser = await prisma.user.create({
    data: {
      email: 'legal@bratecc.com',
      senha: legalPassword,
      role: 'ASSOCIADO'
    }
  });

  const techUser = await prisma.user.create({
    data: {
      email: 'tech@bratecc.com',
      senha: techPassword,
      role: 'ASSOCIADO'
    }
  });

  const agroUser = await prisma.user.create({
    data: {
      email: 'agro@bratecc.com',
      senha: agroPassword,
      role: 'ASSOCIADO'
    }
  });

  console.log(`   ✓ Admin: admin@bratecc.com / admin123`);
  console.log(`   ✓ FinTech: fintech@bratecc.com / fintech123`);
  console.log(`   ✓ Logistics: logistics@bratecc.com / logistics123`);
  console.log(`   ✓ Legal: legal@bratecc.com / legal123`);
  console.log(`   ✓ Tech: tech@bratecc.com / tech123`);

  // ─── CRIAR ASSOCIADOS ───
  console.log('\n🏢 Criando associados...');

  const associados = await Promise.all([
    prisma.associado.create({
      data: {
        nome: 'FinTech Brasil',
        segmento: 'Financial Services',
        porte: 'Médio',
        email: 'fintech@bratecc.com',
        telefone: '+55 11 3333-0001',
        whatsapp: '+55 11 99999-0001',
        servicos: 'Trade Finance Solutions, cartas de crédito e seguros de exportação',
        produtosOferecidos: 'Trade Finance, Cartas de Crédito, Seguros de Exportação, Hedge Cambial',
        produtosDemandados: 'Clientes exportadores, parcerias com bancos internacionais',
        descricao: 'Especialistas em soluções financeiras para comércio exterior Brasil-EUA',
        categorias: ['Financial', 'Trade Finance'],
        userId: fintechUser.id
      }
    }),
    prisma.associado.create({
      data: {
        nome: 'Global Logistics BR',
        segmento: 'Logistics',
        porte: 'Grande',
        email: 'logistics@bratecc.com',
        telefone: '+55 11 3333-0002',
        whatsapp: '+55 11 99999-0002',
        servicos: 'Customs Clearance, desembaraço aduaneiro e frete internacional',
        produtosOferecidos: 'Desembaraço Aduaneiro, Frete Marítimo, Frete Aéreo, Armazenagem',
        produtosDemandados: 'Clientes com volume de importação/exportação',
        descricao: 'Logística internacional completa com foco no corredor Brasil-Texas',
        categorias: ['Logistics', 'Supply Chain'],
        userId: logisticsUser.id
      }
    }),
    prisma.associado.create({
      data: {
        nome: 'Legal Partners',
        segmento: 'Legal',
        porte: 'Pequeno',
        email: 'legal@bratecc.com',
        telefone: '+55 11 3333-0003',
        whatsapp: '+55 11 99999-0003',
        servicos: 'Legal Compliance, Regulatory Advisory e contratos internacionais',
        produtosOferecidos: 'Consultoria Jurídica, Contratos Internacionais, Compliance, Due Diligence',
        produtosDemandados: 'Empresas em processo de internacionalização',
        descricao: 'Escritório especializado em direito comercial internacional',
        categorias: ['Legal', 'Compliance'],
        userId: legalUser.id
      }
    }),
    prisma.associado.create({
      data: {
        nome: 'TechBR Solutions',
        segmento: 'Technology',
        porte: 'Médio',
        email: 'tech@bratecc.com',
        telefone: '+55 11 3333-0004',
        whatsapp: '+55 11 99999-0004',
        servicos: 'IT Infrastructure, Cloud Services e integração de sistemas',
        produtosOferecidos: 'Cloud Computing, ERP, Integração de Sistemas, Cybersecurity',
        produtosDemandados: 'Parcerias com empresas de tecnologia americanas',
        descricao: 'Soluções tecnológicas para empresas em expansão internacional',
        categorias: ['Technology', 'IT'],
        userId: techUser.id
      }
    }),
    prisma.associado.create({
      data: {
        nome: 'AgroBR Consulting',
        segmento: 'Agriculture & Food',
        porte: 'Pequeno',
        email: 'agro@bratecc.com',
        telefone: '+55 11 3333-0005',
        whatsapp: '+55 11 99999-0005',
        servicos: 'Consultoria agrícola, certificações de exportação de alimentos, rastreabilidade',
        produtosOferecidos: 'Consultoria Agro, Certificação USDA/FDA, Rastreabilidade, Análise de Mercado',
        produtosDemandados: 'Importadores de alimentos, distribuidores no Texas, parcerias com supermercados',
        descricao: 'Consultoria especializada em exportação de produtos agrícolas brasileiros para os EUA',
        categorias: ['Agriculture', 'Food', 'Consulting'],
        userId: agroUser.id
      }
    })
  ]);

  console.log(`   ✓ ${associados.length} associados criados`);

  // ─── CRIAR EMPRESAS ───
  console.log('\n🏭 Criando empresas...');

  const empresas = await Promise.all([
    prisma.empresa.create({
      data: {
        nome: 'Texas Energy Solutions',
        setor: 'Energy',
        porte: 'Grande',
        cidade: 'Houston',
        estado: 'Texas',
        tipo: 'EXPORTADOR',
        email: 'contact@texasenergy.com',
        telefone: '+1 713 555-0101',
        descricao: 'Fornecedor de equipamentos de energia solar e eólica',
        necessidades: 'Trade finance e logística internacional',
        produtosOferecidos: 'Painéis solares, turbinas eólicas, inversores, baterias',
        produtosDemandados: 'Trade finance, seguros de exportação, logística para América Latina'
      }
    }),
    prisma.empresa.create({
      data: {
        nome: 'Lone Star Logistics',
        setor: 'Logistics',
        porte: 'Médio',
        cidade: 'Dallas',
        estado: 'Texas',
        tipo: 'AMBOS',
        email: 'info@lonestar.com',
        telefone: '+1 214 555-0102',
        descricao: 'Empresa de logística e transporte internacional',
        necessidades: 'Parcerias com fornecedores brasileiros',
        produtosOferecidos: 'Transporte multimodal, armazenagem, cross-docking',
        produtosDemandados: 'Parcerias com despachantes brasileiros, consultoria jurídica'
      }
    }),
    prisma.empresa.create({
      data: {
        nome: 'Austin Tech Exporters',
        setor: 'Technology',
        porte: 'Médio',
        cidade: 'Austin',
        estado: 'Texas',
        tipo: 'EXPORTADOR',
        email: 'hello@austintech.com',
        telefone: '+1 512 555-0103',
        descricao: 'Exportadora de software e serviços de TI',
        necessidades: 'Certificações e consultoria para mercado brasileiro',
        produtosOferecidos: 'Software SaaS, consultoria em TI, desenvolvimento customizado',
        produtosDemandados: 'Representação comercial, suporte legal, certificações'
      }
    }),
    prisma.empresa.create({
      data: {
        nome: 'Rio Grande Imports',
        setor: 'Food',
        porte: 'Pequeno',
        cidade: 'El Paso',
        estado: 'Texas',
        tipo: 'IMPORTADOR',
        email: 'contact@rgimports.com',
        telefone: '+1 915 555-0104',
        descricao: 'Importadora de alimentos e bebidas brasileiras',
        necessidades: 'Fornecedores de alimentos brasileiros',
        produtosOferecidos: 'Rede de distribuição no Texas, conhecimento do mercado local',
        produtosDemandados: 'Café especial, açaí, cachaça, castanhas, frutas tropicais'
      }
    }),
    prisma.empresa.create({
      data: {
        nome: 'Gulf Coast Trading',
        setor: 'Energy',
        porte: 'Grande',
        cidade: 'Corpus Christi',
        estado: 'Texas',
        tipo: 'AMBOS',
        email: 'trade@gulfcoast.com',
        telefone: '+1 361 555-0105',
        descricao: 'Trading de commodities energéticas',
        necessidades: 'Financiamento e hedge cambial',
        produtosOferecidos: 'Trading de petróleo, gás natural, derivados',
        produtosDemandados: 'Trade finance, hedge cambial, seguros de commodity'
      }
    }),
    prisma.empresa.create({
      data: {
        nome: 'San Antonio Foods',
        setor: 'Food',
        porte: 'Médio',
        cidade: 'San Antonio',
        estado: 'Texas',
        tipo: 'EXPORTADOR',
        email: 'export@safoods.com',
        telefone: '+1 210 555-0106',
        descricao: 'Exportadora de produtos alimentícios texanos',
        necessidades: 'Logística e compliance para exportação ao Brasil',
        produtosOferecidos: 'Carnes, temperos, molhos, produtos tex-mex',
        produtosDemandados: 'Logística refrigerada, registro ANVISA, representação comercial'
      }
    }),
    prisma.empresa.create({
      data: {
        nome: 'Dallas Manufacturing',
        setor: 'Industry',
        porte: 'Grande',
        cidade: 'Dallas',
        estado: 'Texas',
        tipo: 'EXPORTADOR',
        email: 'sales@dallasmfg.com',
        telefone: '+1 972 555-0107',
        descricao: 'Fabricante de equipamentos industriais',
        necessidades: 'Trade finance e seguros de exportação',
        produtosOferecidos: 'Máquinas industriais, equipamentos de automação, peças',
        produtosDemandados: 'Financiamento de exportação, seguros, logística de cargas pesadas'
      }
    })
  ]);

  console.log(`   ✓ ${empresas.length} empresas criadas`);

  // ─── CRIAR EVENTOS ───
  console.log('\n📅 Criando eventos...');

  const eventos = await Promise.all([
    prisma.evento.create({
      data: {
        nome: 'Brasil Energy Breakfast 2026',
        local: 'Houston Convention Center',
        data: new Date('2026-05-07T08:00:00'),
        dataFim: new Date('2026-05-07T12:00:00'),
        descricao: 'Café da manhã de negócios focado no setor de energia Brasil-Texas. Oportunidade única para networking e matches B2B.',
        numeroWhatsapp: '+1-555-ENERGY-2026',
        status: 'ATIVO',
        categorias: ['Energy', 'Trade', 'Finance']
      }
    }),
    prisma.evento.create({
      data: {
        nome: 'Brazil-TX Business Forum',
        local: 'Dallas Trade Center',
        data: new Date('2026-06-20T09:00:00'),
        dataFim: new Date('2026-06-21T18:00:00'),
        descricao: 'Fórum de negócios Brasil-Texas com palestras, workshops e rodadas de negócio.',
        numeroWhatsapp: '+1-555-FORUM-2026',
        status: 'PLANEJADO',
        categorias: ['Business', 'Networking', 'Trade']
      }
    }),
    prisma.evento.create({
      data: {
        nome: 'Tech Connect 2026',
        local: 'Austin Convention Center',
        data: new Date('2026-08-15T10:00:00'),
        dataFim: new Date('2026-08-16T17:00:00'),
        descricao: 'Evento de tecnologia e inovação conectando startups e empresas de tecnologia do Brasil e Texas.',
        numeroWhatsapp: '+1-555-TECH-2026',
        status: 'PLANEJADO',
        categorias: ['Technology', 'Innovation', 'Startups']
      }
    })
  ]);

  console.log(`   ✓ ${eventos.length} eventos criados`);

  // ─── CRIAR MATCHES ───
  console.log('\n🎯 Criando matches...');

  const matches = await Promise.all([
    prisma.match.create({
      data: {
        empresaId: empresas[0].id, // Texas Energy Solutions
        associadoId: associados[0].id, // FinTech Brasil
        score: 92,
        produto: 'Trade Finance',
        status: 'CONFIRMED',
        prioridade: 'alta',
        observacoes: 'Match confirmado - negociação em andamento para financiamento de exportação'
      }
    }),
    prisma.match.create({
      data: {
        empresaId: empresas[1].id, // Lone Star Logistics
        associadoId: associados[1].id, // Global Logistics BR
        score: 88,
        produto: 'Customs Clearance',
        status: 'INTERESTED',
        prioridade: 'alta',
        observacoes: 'Interesse mútuo em parceria de desembaraço aduaneiro'
      }
    }),
    prisma.match.create({
      data: {
        empresaId: empresas[3].id, // Rio Grande Imports
        associadoId: associados[2].id, // Legal Partners
        score: 82,
        produto: 'Legal Compliance',
        status: 'CONTACTED',
        prioridade: 'media',
        observacoes: 'Primeiro contato realizado para consultoria de compliance'
      }
    }),
    prisma.match.create({
      data: {
        empresaId: empresas[2].id, // Austin Tech Exporters
        associadoId: associados[0].id, // FinTech Brasil
        score: 79,
        produto: 'Financial Services',
        status: 'PENDING',
        prioridade: 'media'
      }
    }),
    prisma.match.create({
      data: {
        empresaId: empresas[6].id, // Dallas Manufacturing
        associadoId: associados[0].id, // FinTech Brasil
        score: 75,
        produto: 'Trade Finance',
        status: 'PENDING',
        prioridade: 'media'
      }
    }),
    prisma.match.create({
      data: {
        empresaId: empresas[4].id, // Gulf Coast Trading
        associadoId: associados[0].id, // FinTech Brasil
        score: 71,
        produto: 'Trade Finance',
        status: 'PENDING',
        prioridade: 'baixa'
      }
    }),
    prisma.match.create({
      data: {
        empresaId: empresas[5].id, // San Antonio Foods
        associadoId: associados[1].id, // Global Logistics BR
        score: 85,
        produto: 'Export Logistics',
        status: 'INTERESTED',
        prioridade: 'alta',
        observacoes: 'Interesse em logística refrigerada para exportação ao Brasil'
      }
    })
  ]);

  console.log(`   ✓ ${matches.length} matches criados`);

  // ─── CRIAR MATCHES B2B ───
  console.log('\n🤝 Criando matches B2B...');

  const matchesB2B = await Promise.all([
    prisma.matchB2B.create({
      data: {
        associadoOrigem: associados[0].id, // FinTech Brasil
        associadoDestino: associados[1].id, // Global Logistics BR
        score: 94,
        servicoOrigem: 'Trade Finance Solutions',
        servicoDestino: 'Customs Clearance',
        sinergia: 'Financiamento + Logística = Solução completa para exportação',
        status: 'CONFIRMED'
      }
    }),
    prisma.matchB2B.create({
      data: {
        associadoOrigem: associados[2].id, // Legal Partners
        associadoDestino: associados[0].id, // FinTech Brasil
        score: 89,
        servicoOrigem: 'Legal Compliance',
        servicoDestino: 'Trade Finance',
        sinergia: 'Conformidade legal + Financiamento = Operações seguras',
        status: 'INTERESTED'
      }
    }),
    prisma.matchB2B.create({
      data: {
        associadoOrigem: associados[3].id, // TechBR Solutions
        associadoDestino: associados[1].id, // Global Logistics BR
        score: 86,
        servicoOrigem: 'IT Infrastructure',
        servicoDestino: 'Customs Clearance',
        sinergia: 'Tecnologia + Logística = Rastreamento inteligente',
        status: 'PENDING'
      }
    }),
    prisma.matchB2B.create({
      data: {
        associadoOrigem: associados[4].id, // AgroBR Consulting
        associadoDestino: associados[1].id, // Global Logistics BR
        score: 91,
        servicoOrigem: 'Certificação USDA/FDA',
        servicoDestino: 'Frete Internacional',
        sinergia: 'Certificação Agro + Logística = Exportação completa de alimentos',
        status: 'INTERESTED'
      }
    }),
    prisma.matchB2B.create({
      data: {
        associadoOrigem: associados[4].id, // AgroBR Consulting
        associadoDestino: associados[0].id, // FinTech Brasil
        score: 83,
        servicoOrigem: 'Consultoria Agro',
        servicoDestino: 'Trade Finance',
        sinergia: 'Consultoria Agro + Financiamento = Cadeia completa do agronegócio',
        status: 'CONTACTED'
      }
    })
  ]);

  console.log(`   ✓ ${matchesB2B.length} matches B2B criados`);

  // ─── ADICIONAR PARTICIPANTES AOS EVENTOS ───
  console.log('\n📋 Adicionando participantes aos eventos...');

  await prisma.eventoParticipante.createMany({
    data: [
      { eventoId: eventos[0].id, empresaId: empresas[0].id, confirmado: true },
      { eventoId: eventos[0].id, empresaId: empresas[4].id, confirmado: true },
      { eventoId: eventos[0].id, empresaId: empresas[6].id, confirmado: false },
      { eventoId: eventos[1].id, empresaId: empresas[1].id, confirmado: true },
      { eventoId: eventos[1].id, empresaId: empresas[2].id, confirmado: true },
      { eventoId: eventos[1].id, empresaId: empresas[3].id, confirmado: true },
      { eventoId: eventos[2].id, empresaId: empresas[2].id, confirmado: true }
    ]
  });

  await prisma.eventoAssociado.createMany({
    data: [
      { eventoId: eventos[0].id, associadoId: associados[0].id },
      { eventoId: eventos[0].id, associadoId: associados[1].id },
      { eventoId: eventos[1].id, associadoId: associados[0].id },
      { eventoId: eventos[1].id, associadoId: associados[1].id },
      { eventoId: eventos[1].id, associadoId: associados[2].id },
      { eventoId: eventos[2].id, associadoId: associados[3].id },
      { eventoId: eventos[0].id, associadoId: associados[4].id }
    ]
  });

  console.log(`   ✓ Participantes adicionados aos eventos`);

  // ─── RESUMO ───
  console.log('\n' + '═'.repeat(55));
  console.log('✅ SEED CONCLUÍDO COM SUCESSO!');
  console.log('═'.repeat(55));
  console.log(`
📊 Resumo:
   • 6 usuários (1 admin + 5 associados)
   • ${associados.length} associados
   • ${empresas.length} empresas
   • ${eventos.length} eventos
   • ${matches.length} matches
   • ${matchesB2B.length} matches B2B

🔐 Credenciais de acesso:
   • Admin: admin@bratecc.com / admin123
   • FinTech Brasil: fintech@bratecc.com / fintech123
   • Global Logistics: logistics@bratecc.com / logistics123
   • Legal Partners: legal@bratecc.com / legal123
   • TechBR Solutions: tech@bratecc.com / tech123
   • AgroBR Consulting: agro@bratecc.com / agro123
  `);
}

main()
  .catch((e) => {
    console.error('❌ Erro no seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

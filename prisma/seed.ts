import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Iniciando seed do banco de dados...')

  // Criar usuários
  const adminPassword = await bcrypt.hash('admin123', 10)
  const associadoPassword = await bcrypt.hash('associado123', 10)

  const admin = await prisma.user.upsert({
    where: { email: 'admin@bratecc.com' },
    update: {},
    create: {
      email: 'admin@bratecc.com',
      password: adminPassword,
      name: 'Administrador',
      role: 'ADMIN',
    },
  })

  const associadoUser = await prisma.user.upsert({
    where: { email: 'associado@bratecc.com' },
    update: {},
    create: {
      email: 'associado@bratecc.com',
      password: associadoPassword,
      name: 'FinTech Brasil',
      role: 'ASSOCIADO',
    },
  })

  console.log('✅ Usuários criados')

  // Criar associados
  const fintech = await prisma.associado.create({
    data: {
      name: 'FinTech Brasil',
      email: 'contato@fintechbrasil.com',
      whatsapp: '+5511999999999',
      segmento: 'Financial',
      servicos: 'Trade Finance Solutions, Financiamento para operações de comércio exterior, cartas de crédito internacionais, câmbio e hedge cambial',
      categorias: ['Financial', 'Legal'],
    },
  })

  const logistics = await prisma.associado.create({
    data: {
      name: 'Global Logistics BR',
      email: 'contato@globallogistics.com.br',
      whatsapp: '+5511988888888',
      segmento: 'Logistics',
      servicos: 'Desembaraço aduaneiro completo, transporte internacional, armazenagem e distribuição',
      categorias: ['Logistics', 'Legal'],
    },
  })

  const legal = await prisma.associado.create({
    data: {
      name: 'Legal Partners',
      email: 'contato@legalpartners.com.br',
      whatsapp: '+5511977777777',
      segmento: 'Legal',
      servicos: 'Assessoria jurídica para comércio internacional, compliance regulatório, certificações e documentação',
      categorias: ['Legal', 'Financial'],
    },
  })

  console.log('✅ Associados criados')

  // Criar produtos
  await prisma.produto.create({
    data: {
      associadoId: fintech.id,
      name: 'Trade Finance Solutions',
      categoria: 'Financial',
      descricao: 'Financiamento para operações de comércio exterior com taxas competitivas',
      buscaParceria: ['Logistics', 'Legal'],
    },
  })

  console.log('✅ Produtos criados')

  // Criar empresas
  const texasEnergy = await prisma.empresa.create({
    data: {
      name: 'Texas Energy Solutions',
      setor: 'Energy',
      cidade: 'Houston',
      estado: 'Texas',
      tipo: 'Exportador',
      email: 'contact@texasenergy.com',
      whatsapp: '+1-555-0001',
      necessidades: 'Exportamos equipamentos de energia solar para América Latina e precisamos de financiamento trade finance e suporte logístico para desembaraço aduaneiro',
    },
  })

  await prisma.empresa.create({
    data: {
      name: 'Lone Star Logistics',
      setor: 'Logistics',
      cidade: 'Dallas',
      estado: 'Texas',
      tipo: 'Ambos',
      email: 'info@lonestarlogistics.com',
      necessidades: 'Desembaraço aduaneiro completo e parcerias com fornecedores brasileiros de produtos alimentícios',
    },
  })

  await prisma.empresa.create({
    data: {
      name: 'Austin Tech Exporters',
      setor: 'Technology',
      cidade: 'Austin',
      estado: 'Texas',
      tipo: 'Exportador',
      email: 'hello@austintech.com',
      necessidades: 'Certificações internacionais e consultoria para exportação de software e serviços de TI para o Brasil',
    },
  })

  console.log('✅ Empresas criadas')

  // Criar evento
  await prisma.evento.create({
    data: {
      name: 'Brasil Energy Breakfast 2026',
      dataInicio: new Date('2026-05-07T08:00:00'),
      dataFim: new Date('2026-05-07T12:00:00'),
      local: 'Houston Convention Center',
      whatsapp: '+1-555-BREAKFAST-2026',
      status: 'ATIVO',
      categorias: ['Energy', 'Technology', 'Logistics'],
      descricao: 'Rodada de negócios focada em energia renovável entre empresas do Texas e Brasil',
      participantes: 45,
      matches: 128,
    },
  })

  console.log('✅ Evento criado')

  // Criar alguns matches de exemplo
  await prisma.match.create({
    data: {
      empresaId: texasEnergy.id,
      associadoId: fintech.id,
      score: 92,
      status: 'CONFIRMED',
      empresaNeed: texasEnergy.necessidades,
      associadoService: fintech.servicos,
    },
  })

  console.log('✅ Matches criados')

  console.log('🎉 Seed concluído com sucesso!')
  console.log('\n📧 Credenciais de acesso:')
  console.log('Admin: admin@bratecc.com / admin123')
  console.log('Associado: associado@bratecc.com / associado123')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

// ═══════════════════════════════════════════════════════════
// BRATECC Connect AI - Backend Server
// ═══════════════════════════════════════════════════════════

require('dotenv').config();

const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const routes = require('./routes');
const prisma = require('./config/database');

const app = express();
const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST || '0.0.0.0';

const publicDir = path.join(__dirname, 'public');
const serveSpa = fs.existsSync(path.join(publicDir, 'index.html'));

// ─── MIDDLEWARES ───
// Mesma origem (deploy único): permite qualquer origem refletida. Só API: FRONTEND_URL fixo.
app.use(cors(
  serveSpa
    ? { origin: true, credentials: true }
    : { origin: process.env.FRONTEND_URL || 'http://localhost:3000', credentials: true }
));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Logging
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// ─── ROTAS ───
app.use('/api', routes);

// ─── HEALTH CHECK ───
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV 
  });
});

// ─── SPA estático (build do frontend em src/public) ───
if (serveSpa) {
  app.use(express.static(publicDir));
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(publicDir, 'index.html'));
  });
}

// ─── 404 ───
app.use((req, res) => {
  res.status(404).json({ error: 'Rota não encontrada' });
});

// ─── ERROR HANDLER ───
app.use((err, req, res, next) => {
  console.error('Erro:', err);
  res.status(500).json({ 
    error: 'Erro interno do servidor',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// ─── INICIAR SERVIDOR ───
// Escuta em 0.0.0.0 (Railway/Docker). HTTP sobe antes do Prisma para o healthcheck não falhar por DB lento/SSL.
const startServer = async () => {
  await new Promise((resolve, reject) => {
    const server = app.listen(PORT, HOST, () => {
      console.log(`
╔═══════════════════════════════════════════════════════════╗
║   🚀 BRATECC Connect AI — http://${HOST}:${PORT}
║   Ambiente: ${process.env.NODE_ENV || 'development'}
╚═══════════════════════════════════════════════════════════╝
      `);
      resolve(server);
    });
    server.on('error', reject);
  });

  try {
    await prisma.$connect();
    console.log('✅ Conectado ao PostgreSQL');

    // Iniciar cron de recalculo de scores (depende do Prisma conectado)
    const scoringCron = require('./services/scoringCron');
    scoringCron.startScoreCron();

    // Iniciar worker de retry de HSMs (processa fila whatsapp_retry_queue)
    const retryWorker = require('./services/whatsappRetryWorker');
    retryWorker.startWorker();
  } catch (error) {
    console.error('⚠️ PostgreSQL indisponível no boot (API vai falhar até corrigir DATABASE_URL / SSL):', error.message);
  }
};

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Encerrando servidor...');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Encerrando servidor...');
  await prisma.$disconnect();
  process.exit(0);
});

startServer();

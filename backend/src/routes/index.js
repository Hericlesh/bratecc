// ═══════════════════════════════════════════════════════════
// Rotas da API BRATECC Connect
// ═══════════════════════════════════════════════════════════

const express = require('express');
const router = express.Router();

// Controllers
const authController = require('../controllers/authController');
const empresaController = require('../controllers/empresaController');
const associadoController = require('../controllers/associadoController');
const eventoController = require('../controllers/eventoController');
const matchController = require('../controllers/matchController');
const aiController = require('../controllers/aiController');
const webhookController = require('../controllers/webhookController');
const itemController = require('../controllers/itemController');
const publicInscricaoController = require('../controllers/publicInscricaoController');
const universidadeController = require('../controllers/universidadeController');
const candidatoController = require('../controllers/candidatoController');
const vagaController = require('../controllers/vagaController');
const matchVagaController = require('../controllers/matchVagaController');

// Middleware
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

// ═══════════════════════════════════════
// ROTAS PÚBLICAS
// ═══════════════════════════════════════

// Auth
router.post('/auth/login', authController.login);

// ─── WEBHOOK META WHATSAPP (PÚBLICO — a Meta precisa acessar sem auth) ───
router.get('/webhook/meta', webhookController.verifyWebhook);
router.post('/webhook/meta', webhookController.receiveWebhook);

// ─── INSCRIÇÃO PÚBLICA EM EVENTOS ───
// Qualquer um com o slug pode acessar. Proteção:
//   • Slug aleatório (~50 bits)
//   • Evento precisa ter inscricaoAtiva=true e não ter terminado
//   • Captcha opcional (ativado via env vars CAPTCHA_PROVIDER/CAPTCHA_SECRET)
router.get('/public/inscricao/:slug', publicInscricaoController.getEventoInscricao);
router.post('/public/inscricao/:slug', publicInscricaoController.submitInscricao);

// ═══════════════════════════════════════
// ROTAS PROTEGIDAS (requer autenticação)
// ═══════════════════════════════════════

// Auth
router.get('/auth/me', authMiddleware, authController.me);
router.post('/auth/users', authMiddleware, adminMiddleware, authController.createUser);

// ─── EMPRESAS ───
router.get('/empresas', authMiddleware, empresaController.getAll);
router.get('/empresas/stats', authMiddleware, empresaController.getStats);
router.get('/empresas/:id', authMiddleware, empresaController.getById);
router.post('/empresas', authMiddleware, adminMiddleware, empresaController.create);
router.post('/empresas/import', authMiddleware, adminMiddleware, empresaController.createMany);
router.put('/empresas/:id', authMiddleware, adminMiddleware, empresaController.update);
router.delete('/empresas/:id', authMiddleware, adminMiddleware, empresaController.remove);

// ─── ASSOCIADOS ───
router.get('/associados', authMiddleware, associadoController.getAll);
router.get('/associados/stats', authMiddleware, associadoController.getStats);
router.get('/associados/:id', authMiddleware, associadoController.getById);
router.post('/associados', authMiddleware, adminMiddleware, associadoController.create);
router.post('/associados/import', authMiddleware, adminMiddleware, associadoController.createMany);
router.put('/associados/:id', authMiddleware, adminMiddleware, associadoController.update);
router.delete('/associados/:id', authMiddleware, adminMiddleware, associadoController.remove);
router.post('/associados/:id/reset-senha', authMiddleware, adminMiddleware, associadoController.resetSenha);

// ─── EVENTOS ───
router.get('/eventos', authMiddleware, eventoController.getAll);
router.get('/eventos/stats', authMiddleware, eventoController.getStats);
router.get('/eventos/:id', authMiddleware, eventoController.getById);
router.post('/eventos', authMiddleware, adminMiddleware, eventoController.create);
router.put('/eventos/:id', authMiddleware, adminMiddleware, eventoController.update);
router.patch('/eventos/:id/toggle-status', authMiddleware, adminMiddleware, eventoController.toggleStatus);
router.delete('/eventos/:id', authMiddleware, adminMiddleware, eventoController.remove);
router.post('/eventos/:id/participantes', authMiddleware, adminMiddleware, eventoController.addParticipante);
router.delete('/eventos/:id/participantes/:empresaId', authMiddleware, adminMiddleware, eventoController.removeParticipante);
router.patch('/eventos/:id/participantes/:empresaId/confirmar', authMiddleware, adminMiddleware, eventoController.toggleConfirmacaoParticipante);
router.post('/eventos/:id/associados', authMiddleware, adminMiddleware, eventoController.addAssociado);
router.delete('/eventos/:id/associados/:associadoId', authMiddleware, adminMiddleware, eventoController.removeAssociado);
router.get('/eventos/:id/matches', authMiddleware, eventoController.getMatches);
router.patch('/eventos/:id/matches/:matchId/status', authMiddleware, eventoController.updateMatchStatus);
router.patch('/eventos/:id/inscricao', authMiddleware, adminMiddleware, eventoController.toggleInscricao);
router.post('/eventos/:id/inscricao/regenerate', authMiddleware, adminMiddleware, eventoController.regenerateInscricaoSlug);

// ─── ITEMS (produtos/serviços oferecidos ou demandados) ───
// Rotas NCM vêm ANTES de /items/:id pra evitar colisão com o :id
router.get('/items/ncm/search', authMiddleware, itemController.searchNcm);
router.post('/items/ncm/refresh', authMiddleware, adminMiddleware, itemController.refreshNcm);
router.get('/items/ncm/:codigo', authMiddleware, itemController.getNcm);

router.get('/items', authMiddleware, itemController.getAll);
router.get('/items/:id', authMiddleware, itemController.getById);
router.post('/items', authMiddleware, adminMiddleware, itemController.create);
router.put('/items/:id', authMiddleware, adminMiddleware, itemController.update);
router.delete('/items/:id', authMiddleware, adminMiddleware, itemController.remove);

// ─── MATCHES ───
router.get('/matches', authMiddleware, matchController.getAll);
router.get('/matches/stats', authMiddleware, matchController.getStats);
router.get('/matches/:id', authMiddleware, matchController.getById);
router.post('/matches', authMiddleware, adminMiddleware, matchController.create);
router.patch('/matches/:id/status', authMiddleware, matchController.updateStatus);
router.delete('/matches/:id', authMiddleware, adminMiddleware, matchController.remove);
router.post('/matches/generate/:empresaId', authMiddleware, adminMiddleware, matchController.generateForEmpresa);

// ─── INTELIGÊNCIA ARTIFICIAL ───
router.post('/ai/classificar/empresa/:id', authMiddleware, adminMiddleware, aiController.classificarEmpresa);
router.post('/ai/classificar/associado/:id', authMiddleware, adminMiddleware, aiController.classificarAssociado);
router.post('/ai/matches/:empresaId', authMiddleware, adminMiddleware, aiController.gerarMatchesInteligentes);
router.post('/ai/matches-b2b', authMiddleware, adminMiddleware, aiController.gerarMatchesB2B);
router.post('/ai/analisar-evento/:eventoId', authMiddleware, adminMiddleware, aiController.analisarEvento);
router.get('/ai/resumo-executivo', authMiddleware, aiController.gerarResumoExecutivo);
router.post('/ai/chat', authMiddleware, aiController.chatIA);
router.post('/ai/recalcular-scores', authMiddleware, adminMiddleware, aiController.recalcularScores);
router.get('/ai/cron-status', authMiddleware, adminMiddleware, aiController.cronStatus);

// ─── WHATSAPP (PROTEGIDO) ───
router.post('/whatsapp/send', authMiddleware, adminMiddleware, webhookController.sendMessage);
router.post('/whatsapp/send-bulk', authMiddleware, adminMiddleware, webhookController.sendBulk);
router.post('/whatsapp/send-hsm', authMiddleware, adminMiddleware, webhookController.sendHSM);
router.post('/whatsapp/send-hsm-matches', authMiddleware, adminMiddleware, webhookController.sendHSMMatches);
router.post('/whatsapp/send-hsm-matches-b2b', authMiddleware, adminMiddleware, webhookController.sendHSMMatchesB2B);
router.post('/whatsapp/send-hsm-matches-vaga', authMiddleware, adminMiddleware, webhookController.sendHSMMatchesVaga);
router.post('/whatsapp/send-evento-invite', authMiddleware, adminMiddleware, webhookController.sendEventoInvite);
router.post('/whatsapp/send-evento-sinergia', authMiddleware, adminMiddleware, webhookController.sendEventoSinergia);

// Fila de retry (admin)
router.get('/whatsapp/retry-queue', authMiddleware, adminMiddleware, webhookController.listRetryQueue);
router.post('/whatsapp/retry-queue/:id/force', authMiddleware, adminMiddleware, webhookController.forceRetryQueueItem);
router.post('/whatsapp/retry-queue/:id/abandon', authMiddleware, adminMiddleware, webhookController.abandonRetryQueueItem);
router.get('/whatsapp/diagnostico', authMiddleware, adminMiddleware, webhookController.diagnostico);
router.post('/whatsapp/test', authMiddleware, adminMiddleware, webhookController.testSend);
router.get('/whatsapp/status', authMiddleware, webhookController.getStatus);

// ─── UNIVERSIDADES ───
router.get('/universidades', authMiddleware, universidadeController.getAll);
router.get('/universidades/stats', authMiddleware, adminMiddleware, universidadeController.getStats);
router.get('/universidades/:id', authMiddleware, universidadeController.getById);
router.post('/universidades', authMiddleware, adminMiddleware, universidadeController.create);
router.put('/universidades/:id', authMiddleware, adminMiddleware, universidadeController.update);
router.delete('/universidades/:id', authMiddleware, adminMiddleware, universidadeController.remove);
router.post('/universidades/:id/reset-senha', authMiddleware, adminMiddleware, universidadeController.resetSenha);

// ─── CANDIDATOS ───
// Universidade só vê/edita os próprios (controller força por req.userId).
router.get('/candidatos', authMiddleware, candidatoController.getAll);
router.get('/candidatos/:id', authMiddleware, candidatoController.getById);
router.post('/candidatos', authMiddleware, candidatoController.create);
router.put('/candidatos/:id', authMiddleware, candidatoController.update);
router.delete('/candidatos/:id', authMiddleware, candidatoController.remove);

// ─── VAGAS ───
// Associado só vê/edita as próprias (controller força por req.userId).
router.get('/vagas', authMiddleware, vagaController.getAll);
router.get('/vagas/:id', authMiddleware, vagaController.getById);
router.post('/vagas', authMiddleware, vagaController.create);
router.put('/vagas/:id', authMiddleware, vagaController.update);
router.delete('/vagas/:id', authMiddleware, vagaController.remove);

// ─── MATCH VAGAS (Candidato × Vaga) ───
router.get('/match-vagas', authMiddleware, matchVagaController.getAll);
router.post('/match-vagas', authMiddleware, matchVagaController.create);
router.patch('/match-vagas/:id', authMiddleware, matchVagaController.updateStatus);
router.post('/match-vagas/gerar', authMiddleware, adminMiddleware, matchVagaController.gerar);
router.post('/match-vagas/recalcular', authMiddleware, adminMiddleware, matchVagaController.recalcular);

// ─── DASHBOARD ───
router.get('/dashboard/stats', authMiddleware, async (req, res) => {
  const prisma = require('../config/database');
  
  try {
    const [
      totalEmpresas,
      totalAssociados,
      totalEventos,
      totalMatches,
      matchesConfirmed,
      eventosAtivos
    ] = await Promise.all([
      prisma.empresa.count({ where: { ativo: true } }),
      prisma.associado.count({ where: { ativo: true } }),
      prisma.evento.count(),
      prisma.match.count(),
      prisma.match.count({ where: { status: 'CONFIRMED' } }),
      prisma.evento.count({ where: { status: 'ATIVO' } })
    ]);

    const taxaConversao = totalMatches > 0 
      ? Math.round((matchesConfirmed / totalMatches) * 100) 
      : 0;

    res.json({
      empresas: totalEmpresas,
      associados: totalAssociados,
      eventos: totalEventos,
      eventosAtivos,
      matches: totalMatches,
      matchesConfirmed,
      taxaConversao
    });
  } catch (error) {
    console.error('Erro ao buscar stats do dashboard:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

module.exports = router;

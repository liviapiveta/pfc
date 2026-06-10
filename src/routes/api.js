const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const authController = require('../controllers/authController');
const suapController = require('../controllers/suapController');
const adminController = require('../controllers/adminController');
const adminAuth = require('../middleware/adminAuth');
const conquistaController = require('../controllers/conquistaController');

// ── Autenticação (sem middleware) ──────────────────────────────
router.post('/auth/login', authController.login);
router.post('/auth/logout', auth, authController.logout);
router.get('/auth/me', auth, authController.me);

// ── Dados SUAP (requer autenticação) ──────────────────────────
router.get('/dados-pessoais', auth, suapController.getDadosPessoais);
router.get('/periodos', auth, suapController.getPeriodos);
router.get('/boletim/:ano/:periodo', auth, suapController.getBoletim);
router.get('/projetos/pesquisa', auth, suapController.getProjetosPesquisa);
router.get('/projetos/extensao', auth, suapController.getProjetosExtensao);
router.get('/calendario', auth, suapController.getCalendario);

// ── Projetos internos / solicitações de participação (aluno) ──
router.get('/projetos-internos/:tipo', auth, suapController.getProjetosInternos);
router.post('/projetos-internos/:id/solicitar', auth, suapController.solicitarParticipacao);
router.post('/projetos-suap/:suapId/solicitar', auth, suapController.solicitarParticipacaoSuap);
router.delete('/projetos-internos/:id/solicitacao', auth, suapController.cancelarSolicitacao);
router.delete('/projetos-suap/:suapId/solicitacao', auth, suapController.cancelarSolicitacaoSuap);

// ── Preferências (persistidas no MongoDB) ─────────────────────
router.put('/preferencias', auth, suapController.updatePreferencias);

// ── Administração ─────────────────────────────────────────────
router.post('/admin/login', adminController.login);
router.post('/admin/logout', adminController.logout);

// Estatísticas
router.get('/admin/stats', adminAuth, adminController.stats);

// Projetos (pesquisa / extensão)
//  - GET /admin/projetos/pesquisa | /extensao → lista por tipo
//  - GET /admin/projetos/:id                  → um projeto (edição)
router.get('/admin/projetos/:tipoOuId', adminAuth, adminController.getProjetos);
router.post('/admin/projetos', adminAuth, adminController.criarProjeto);
router.put('/admin/projetos/:id', adminAuth, adminController.atualizarProjeto);
router.delete('/admin/projetos/:id', adminAuth, adminController.deletarProjeto);

// Eventos
router.get('/admin/eventos', adminAuth, adminController.getEventos);
router.get('/admin/eventos/:id', adminAuth, adminController.getEvento);
router.post('/admin/eventos', adminAuth, adminController.criarEvento);
router.put('/admin/eventos/:id', adminAuth, adminController.atualizarEvento);
router.delete('/admin/eventos/:id', adminAuth, adminController.deletarEvento);

// Solicitações de participação
router.get('/admin/solicitacoes', adminAuth, adminController.getSolicitacoes);
router.put('/admin/solicitacoes/:id', adminAuth, adminController.decidirSolicitacao);

// Catálogo de projetos do SUAP (espelho local, somente leitura)
router.get('/admin/projetos-suap/:tipo', adminAuth, adminController.getProjetosSuap);

module.exports = router;

// ── Conquistas (gamificação) — catálogo e concessão (admin) ───
router.get('/admin/conquistas', adminAuth, conquistaController.getConquistas);
router.get('/admin/conquistas/:id', adminAuth, conquistaController.getConquista);
router.post('/admin/conquistas', adminAuth, conquistaController.criarConquista);
router.put('/admin/conquistas/:id', adminAuth, conquistaController.atualizarConquista);
router.delete('/admin/conquistas/:id', adminAuth, conquistaController.deletarConquista);

// Concessão manual a um aluno
router.post('/admin/conquistas/:id/conceder', adminAuth, conquistaController.concederConquista);
router.get('/admin/alunos/:matricula/conquistas', adminAuth, conquistaController.getConquistasDoAluno);
router.delete('/admin/conquistas-concedidas/:registroId', adminAuth, conquistaController.revogarConcessao);
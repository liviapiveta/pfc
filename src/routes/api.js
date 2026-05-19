const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const authController = require('../controllers/authController');
const suapController = require('../controllers/suapController');

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

// ── Preferências (persistidas no MongoDB) ─────────────────────
router.put('/preferencias', auth, suapController.updatePreferencias);

module.exports = router;
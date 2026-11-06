const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const authController = require('../controllers/authController');
const suapController = require('../controllers/suapController');
const adminController = require('../controllers/adminController');
const adminAuth = require('../middleware/adminAuth');
const conquistaController = require('../controllers/conquistaController');

// ── Autenticação (sem middleware) ──────────────────────────────
// IDs do MongoDB inválidos na URL → 400 (antes estouravam CastError → 500)
const mongoose = require('mongoose');
const validarId = (req, res, next, valor) =>
  mongoose.isValidObjectId(valor) ? next() : res.status(400).json({ erro: 'ID inválido' });
router.param('id', validarId);
router.param('registroId', validarId);

const limiteTaxa = require('../middleware/limiteTaxa');
const limiteLogin = limiteTaxa({ max: 10 });
const limiteAdmin = limiteTaxa({ max: 20 });
const limiteEmail = limiteTaxa({ max: 5, mensagem: 'Muitos pedidos de e-mail. Aguarde alguns minutos.' });

router.post('/auth/login', limiteLogin, authController.login);
router.post('/auth/logout', auth, authController.logout);
router.get('/auth/me', auth, authController.me);

// ── Dados SUAP (requer autenticação) ──────────────────────────
router.get('/dados-pessoais', auth, suapController.getDadosPessoais);
router.get('/periodos', auth, suapController.getPeriodos);
router.get('/boletim/:ano/:periodo', auth, suapController.getBoletim);
router.get('/projetos/pesquisa', auth, suapController.getProjetosPesquisa);
router.get('/projetos/extensao', auth, suapController.getProjetosExtensao);

// ── Projetos internos / solicitações de participação (aluno) ──
router.get('/projetos-internos/:tipo', auth, suapController.getProjetosInternos);
router.post('/projetos-internos/:id/solicitar', auth, suapController.solicitarParticipacao);
router.post('/projetos-suap/:suapId/solicitar', auth, suapController.solicitarParticipacaoSuap);
router.delete('/projetos-internos/:id/solicitacao', auth, suapController.cancelarSolicitacao);
router.delete('/projetos-suap/:suapId/solicitacao', auth, suapController.cancelarSolicitacaoSuap);

// ── Eventos e validação de presença (aluno) ───────────────────
const presencaController = require('../controllers/presencaController');
const { TIPOS_ARQUIVO, TAM_MAX_ARQUIVO } = require('../services/presencaService');
const lerArquivo = express.raw({ type: TIPOS_ARQUIVO, limit: TAM_MAX_ARQUIVO });
const corpoArquivo = (req, res, next) =>
  lerArquivo(req, res, (err) => {
    if (err?.type === 'entity.too.large') return res.status(413).json({ erro: 'O arquivo passa de 4 MB.' });
    return next(err);
  });
// Por ALUNO (não por IP: no campus todos usam o mesmo Wi-Fi) — barra quem fica testando QR
const limiteQr = limiteTaxa({ max: 15, chave: (req) => `${req.user?.matricula}|${req.params.chave}` });
router.get('/eventos', auth, presencaController.listarEventos);
router.post('/eventos/:chave/qrcode', auth, limiteQr, presencaController.validarPorQr);
router.post('/eventos/:chave/certificado', auth, corpoArquivo, presencaController.enviarCertificado);
router.delete('/eventos/:chave/presenca', auth, presencaController.cancelarPresenca);

// ── Preferências (persistidas no MongoDB) ─────────────────────
router.put('/preferencias', auth, suapController.updatePreferencias);

// ── Administração ─────────────────────────────────────────────
// Login em 2 etapas: 1) e-mail autorizado? 2) senha
router.post('/admin/login/email', limiteAdmin, adminController.verificarEmail);
router.post('/admin/login', limiteAdmin, adminController.login);
router.post('/admin/logout', adminController.logout);
router.get('/admin/me', adminAuth, adminController.me);

// Cadastro / redefinição de senha pelo link enviado por e-mail
router.post('/admin/senha/esqueci', limiteEmail, adminController.esqueciSenha);
router.get('/admin/senha/token/:token', adminController.validarToken);
router.post('/admin/senha/definir', limiteAdmin, adminController.definirSenha);

// Contas do painel (apenas desenvolvedor pode gerenciar)
router.get('/admin/contas', adminAuth, adminAuth.apenasDev, adminController.getContas);
router.post('/admin/contas', adminAuth, adminAuth.apenasDev, adminController.criarConta);
router.post('/admin/contas/importar', adminAuth, adminAuth.apenasDev, adminController.importarServidores);
router.put('/admin/contas/:id', adminAuth, adminAuth.apenasDev, adminController.atualizarConta);
router.post('/admin/contas/:id/convite', adminAuth, adminAuth.apenasDev, adminController.enviarConvite);
router.delete('/admin/contas/:id', adminAuth, adminAuth.apenasDev, adminController.deletarConta);

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

// Eventos do SUAP (configuração) e presenças para decidir — qualquer professor
router.get('/admin/eventos-suap', adminAuth, presencaController.listarEventosSuap);
router.put('/admin/eventos-suap/:suapId', adminAuth, presencaController.configurarEventoSuap);
router.post('/admin/padrao-qr', adminAuth, presencaController.sugerirPadraoQr);
router.get('/admin/presencas', adminAuth, presencaController.listarPresencas);
router.get('/admin/presencas/:id/arquivo', adminAuth, presencaController.verArquivo);
router.put('/admin/presencas/:id', adminAuth, presencaController.decidirPresenca);

// Exportar CSV (cada um exporta só o que já vê no painel)
const exportController = require('../controllers/exportController');
router.get('/admin/exportar/solicitacoes', adminAuth, exportController.solicitacoes);
router.get('/admin/exportar/ranking', adminAuth, exportController.ranking);
router.get('/admin/exportar/presencas', adminAuth, exportController.presencas);

// Solicitações de participação
router.get('/admin/solicitacoes', adminAuth, adminController.getSolicitacoes);
router.put('/admin/solicitacoes/:id', adminAuth, adminController.decidirSolicitacao);

// Catálogo de projetos do SUAP (espelho local, somente leitura)
router.get('/admin/projetos-suap/:tipo', adminAuth, adminController.getProjetosSuap);

// Histórico (auditoria) — só desenvolvedor; Estatísticas — todos os servidores
router.get('/admin/historico', adminAuth, adminAuth.apenasDev, adminController.getHistorico);
router.get('/admin/estatisticas', adminAuth, adminController.getEstatisticas);

// ── Conquistas (gamificação) — catálogo e concessão (admin) ───
router.get('/admin/conquistas', adminAuth, conquistaController.getConquistas);
router.get('/admin/conquistas/:id', adminAuth, conquistaController.getConquista);
router.post('/admin/conquistas', adminAuth, adminAuth.apenasDev, conquistaController.criarConquista);
router.put('/admin/conquistas/:id', adminAuth, adminAuth.apenasDev, conquistaController.atualizarConquista);
router.delete('/admin/conquistas/:id', adminAuth, adminAuth.apenasDev, conquistaController.deletarConquista);

// Concessão manual a um aluno
router.post('/admin/conquistas/:id/conceder', adminAuth, conquistaController.concederConquista);
router.get('/admin/alunos/:matricula/conquistas', adminAuth, conquistaController.getConquistasDoAluno);
router.delete('/admin/conquistas-concedidas/:registroId', adminAuth, conquistaController.revogarConcessao);

// ── Conquistas do aluno (portal) ──────────────────────────────
router.get('/minhas-conquistas', auth, conquistaController.getMinhasConquistas);

// ── Ranking (aluno) ───────────────────────────────────────────
router.get('/ranking', auth, conquistaController.getRanking);

// ── Dashboard (aluno) ─────────────────────────────────────────
router.get('/dashboard', auth, conquistaController.getDashboard);

// ── Minha Trajetória (aluno) ──────────────────────────────────
router.get('/trajetoria', auth, conquistaController.getTrajetoria);

// Novidades (aviso com confetes de conquista nova / subiu de nível)
router.get('/novidades', auth, conquistaController.getNovidades);
router.post('/novidades/vistas', auth, conquistaController.marcarNovidadesVistas);

// ── Diagnóstico: o servidor consegue falar com o SUAP? ─────────
// Envia um login falso. 401 = SUAP acessível (só recusou a senha falsa).
// 403/405/timeout = o SUAP está bloqueando o IP deste servidor.
// Testa a URL do .env (SUAP_BASE_URL) E a URL oficial, para achar erro de configuração.
router.get('/diagnostico-suap', async (req, res) => {
  const axios = require('axios');
  require('../services/suapService'); // aplica os headers de navegador
  const OFICIAL = 'https://suap.ifpr.edu.br/api';
  const doEnv = process.env.SUAP_BASE_URL;

  const testar = async (base) => {
    const url = `${String(base).replace(/\/+$/, '')}/token/pair`;
    const inicio = Date.now();
    try {
      const r = await axios.post(url, { username: 'diagnostico', password: 'x' }, {
        timeout: 10000, validateStatus: () => true, maxRedirects: 0,
      });
      const corpo = typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
      const ok = r.status === 401 || r.status === 400;
      return {
        url, status: r.status, ms: Date.now() - inicio, acessivel: ok,
        veredito: ok ? 'OK: o SUAP responde a este servidor.'
          : (r.status === 403 || r.status === 405 || /captcha|awswaf/i.test(corpo))
            ? 'BLOQUEADO: firewall do SUAP recusou este servidor.'
            : 'URL ERRADA ou resposta inesperada (não parece o SUAP).',
        servidor: r.headers?.server || null,
        location: r.headers?.location || null,
        trecho: corpo.slice(0, 200),
      };
    } catch (e) {
      return { url, acessivel: false, veredito: 'Sem resposta', erro: e.code || e.message, ms: Date.now() - inicio };
    }
  };

  let ipServidor = null;
  try { ipServidor = (await axios.get('https://api.ipify.org?format=json', { timeout: 5000 })).data.ip; } catch {}

  return res.json({
    SUAP_BASE_URL_configurada: doEnv || '(não definida — usando a oficial)',
    regiao_vercel: process.env.VERCEL_REGION || null,
    ip_servidor: ipServidor,
    teste_url_configurada: doEnv ? await testar(doEnv) : null,
    teste_url_oficial: await testar(OFICIAL),
  });
});

module.exports = router;
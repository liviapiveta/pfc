const jwt = require('jsonwebtoken');
const User = require('../models/User');
const suapService = require('../services/suapService');
const conquistaEngine = require('../services/conquistaEngine');

/**
 * Verifica, em segundo plano, as conquistas automáticas de NOTA do aluno.
 * Busca o boletim do período letivo mais recente e deixa o motor conceder
 * o que for devido. Roda no login para não depender de uma aba de boletim.
 * Falhas aqui NUNCA afetam o login (são apenas logadas).
 */
const verificarConquistasBoletim = async (token, matricula) => {
  const periodos = await suapService.getMeusPeriodosLetivos(token);
  if (!Array.isArray(periodos) || !periodos.length) return;

  // Período mais recente (maior ano; em empate, maior período)
  const atual = [...periodos].sort(
    (a, b) =>
      (b.ano_letivo - a.ano_letivo) || (b.periodo_letivo - a.periodo_letivo)
  )[0];
  if (!atual) return;

  const boletim = await suapService.getBoletim(
    token,
    atual.ano_letivo,
    atual.periodo_letivo
  );
  await conquistaEngine.processarBoletim(matricula, boletim, {
    ano: atual.ano_letivo,
    periodo: atual.periodo_letivo,
  });
};

/**
 * POST /api/auth/login
 */
const login = async (req, res) => {
  try {
    const { matricula, senha } = req.body;

    if (!matricula || !senha) {
      return res.status(400).json({ erro: 'Matrícula e senha são obrigatórios' });
    }

    // ── 1. Autentica no SUAP ─────────────────────────────────────
    let authData;
    try {
      authData = await suapService.autenticar(matricula, senha);
    } catch (err) {
      const status = err.response?.status;
      console.error('Erro autenticação SUAP:', status, err.response?.data || err.message);

      if (status === 400 || status === 401) {
        return res.status(401).json({ erro: 'Matrícula ou senha inválidos' });
      }
      return res.status(500).json({ erro: 'Erro ao autenticar no SUAP' });
    }

    const { access: accessToken, refresh: refreshToken } = authData;

    // ── 2. Busca dados do usuário ────────────────────────────────
    let dadosSuap;
    try {
      dadosSuap = await suapService.getMeusDados(accessToken);
    } catch (err) {
      console.error('Erro ao buscar dados SUAP:', err.response?.data || err.message);
      return res.status(500).json({ erro: 'Erro ao buscar dados do usuário' });
    }

    const nomeUsuario = dadosSuap.nome_usual || dadosSuap.nome || matricula;

    // ── 2b. Busca o curso do aluno (para o ranking por curso) ────
    // Endpoint separado do SUAP. Se falhar, não quebra o login —
    // só fica sem curso (o ranking geral continua funcionando).
    let curso = '';
    try {
      const dadosAluno = await suapService.getMeusDadosAluno(accessToken);
      curso = dadosAluno?.curso || '';
    } catch (err) {
      console.warn('Aviso: não foi possível obter o curso do aluno:', err.message);
    }

    // ── 3. Salva/atualiza usuário ────────────────────────────────
    const user = await User.findOneAndUpdate(
      { matricula },
      {
        matricula,
        suapToken: accessToken,
        suapRefreshToken: refreshToken,
        nomeUsuario,
        curso,
        ultimoAcesso: new Date(),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // ── 4. JWT interno (24h) ─────────────────────────────────────
    const internalToken = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.cookie('authToken', internalToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000,
    });

    // Em 2º plano: verifica conquistas automáticas de nota a partir do
    // boletim. Não usamos await — o login responde na hora, sem esperar
    // o SUAP. Qualquer falha é apenas logada e não afeta o login.
    verificarConquistasBoletim(accessToken, matricula).catch((e) =>
      console.error('Falha ao verificar conquistas de boletim no login:', e.message)
    );

    return res.json({
      sucesso: true,
      usuario: { id: user._id, matricula, nome: nomeUsuario },
    });
  } catch (err) {
    console.error('Erro no login:', err.response?.data || err.message);
    return res.status(500).json({ erro: 'Erro interno. Tente novamente.' });
  }
};

/**
 * POST /api/auth/logout
 */
const logout = async (req, res) => {
  try {
    if (req.user?.suapToken) {
      suapService.limparCache(req.user.suapToken);
    }
  } catch (err) {
    console.error(err.message);
  }

  res.clearCookie('authToken');
  return res.json({ sucesso: true });
};

/**
 * GET /api/auth/me
 */
const me = async (req, res) => {
  try {
    return res.json({
      matricula: req.user.matricula,
      nome: req.user.nomeUsuario,
      ultimoAcesso: req.user.ultimoAcesso,
      preferencias: req.user.preferencias || {},
    });
  } catch (err) {
    console.error(err.message);
    return res.status(500).json({ erro: 'Erro ao buscar usuário' });
  }
};

module.exports = { login, logout, me };
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const suapService = require('../services/suapService');
const cofre = require('../services/cofre');

/**
 * O access token do SUAP é um JWT: lemos o campo `exp` (sem validar a
 * assinatura — só para saber a validade). Retorna true se faltar menos
 * de 2 minutos para expirar, ou se não der para ler.
 */
const tokenSuapExpirando = (token) => {
  const dados = jwt.decode(token);
  if (!dados || !dados.exp) return true;
  return dados.exp * 1000 - Date.now() < 2 * 60 * 1000;
};

const authMiddleware = async (req, res, next) => {
  try {
    const token =
      req.cookies?.authToken ||
      req.headers.authorization?.split(' ')[1];

    if (!token) {
      if (req.originalUrl.startsWith('/api/')) {
        return res.status(401).json({ erro: 'Não autenticado' });
      }
      return res.redirect('/login');
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);

    if (!user) {
      res.clearCookie('authToken');
      if (req.originalUrl.startsWith('/api/')) {
        return res.status(401).json({ erro: 'Usuário não encontrado' });
      }
      return res.redirect('/login');
    }

    // ── Abre as chaves do SUAP (ficam criptografadas no banco) ───
    const salvoAccess = user.suapToken, salvoRefresh = user.suapRefreshToken;
    const access = cofre.abrir(salvoAccess);
    const refresh = cofre.abrir(salvoRefresh);
    if (access === null) {
      // Não deu para abrir (a chave de criptografia mudou): pede um novo login
      res.clearCookie('authToken');
      if (req.originalUrl.startsWith('/api/')) return res.status(401).json({ erro: 'Sua sessão expirou. Entre de novo.' });
      return res.redirect('/login');
    }
    // Contas de antes da criptografia: regrava as chaves já protegidas
    if (!cofre.estaFechado(salvoAccess) || (salvoRefresh && !cofre.estaFechado(salvoRefresh))) {
      User.updateOne({ _id: user._id }, { $set: {
        suapToken: cofre.fechar(access),
        ...(refresh ? { suapRefreshToken: cofre.fechar(refresh) } : {}),
      } }).catch((e) => console.warn('Aviso: não foi possível proteger os tokens antigos:', e.message));
    }
    // Daqui em diante só a memória desta requisição tem o token aberto (nada é salvo assim)
    user.suapToken = access;
    user.suapRefreshToken = refresh || '';

    // ── Renova o token SUAP só quando ele estiver expirando ──────
    // Antes isso rodava em TODA requisição: deixava tudo lento, gerava um
    // token novo a cada clique e invalidava o cache (que usa o token na chave).
    if (user.suapRefreshToken && tokenSuapExpirando(user.suapToken)) {
      try {
        const novoAccessToken = await suapService.refreshToken(
          user.suapRefreshToken
        );

        if (novoAccessToken && novoAccessToken !== user.suapToken) {
          suapService.limparCache(user.suapToken); // limpa cache do token ANTIGO
          user.suapToken = novoAccessToken;
          await User.findByIdAndUpdate(user._id, {
            suapToken: cofre.fechar(novoAccessToken),
          });
        }
      } catch (refreshErr) {
        // Se o refresh também falhou, o token SUAP está morto.
        // Não bloqueia a requisição — o controller vai retornar 401
        // quando tentar usar o token expirado.
        console.warn(
          'Aviso: falha ao renovar token SUAP (refresh expirado?):',
          refreshErr.response?.status || refreshErr.message
        );
      }
    }

    req.user = user;
    next();
  } catch (err) {
    // Só desloga quando o PRÓPRIO token é inválido. Antes, uma falha
    // momentânea do banco também apagava o cookie e expulsava o aluno.
    const erroDeToken = err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError';
    if (!erroDeToken) {
      console.error('Erro no middleware de autenticação:', err.message);
      if (req.originalUrl.startsWith('/api/')) {
        return res.status(503).json({ erro: 'Serviço indisponível no momento. Tente novamente.' });
      }
      return res.status(503).send('Serviço indisponível no momento. Tente novamente em instantes.');
    }
    res.clearCookie('authToken');
    if (req.originalUrl.startsWith('/api/')) {
      return res.status(401).json({ erro: 'Token inválido ou expirado' });
    }
    return res.redirect('/login');
  }
};

module.exports = authMiddleware;
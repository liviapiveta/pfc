const jwt = require('jsonwebtoken');
const User = require('../models/User');
const suapService = require('../services/suapService');

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

    // ── Tenta renovar o token SUAP se houver refreshToken ───────
    // O token SUAP de acesso dura ~1h; o refresh dura mais.
    // Se uma chamada falhar com 401, o controller já retorna erro
    // apropriado, mas aqui tentamos renovar proativamente sempre
    // que o usuário tiver um refreshToken salvo.
    if (user.suapRefreshToken) {
      try {
        const novoAccessToken = await suapService.refreshToken(
          user.suapRefreshToken
        );

        if (novoAccessToken && novoAccessToken !== user.suapToken) {
          user.suapToken = novoAccessToken;
          suapService.limparCache(user.suapToken); // limpa cache do token antigo
          await User.findByIdAndUpdate(user._id, {
            suapToken: novoAccessToken,
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
    res.clearCookie('authToken');
    if (req.originalUrl.startsWith('/api/')) {
      return res.status(401).json({ erro: 'Token inválido ou expirado' });
    }
    return res.redirect('/login');
  }
};

module.exports = authMiddleware;
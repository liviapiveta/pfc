const jwt = require('jsonwebtoken');

/**
 * Middleware de autenticação do painel administrativo.
 * Verifica o cookie `adminToken` (ou o header Authorization).
 * - Em rotas de API (/api/...) responde 401 em JSON.
 * - Em rotas de página redireciona para /admin/login.
 */
const adminAuth = (req, res, next) => {
  const isApi = req.originalUrl.startsWith('/api/');

  try {
    const token =
      req.cookies?.adminToken ||
      req.headers.authorization?.split(' ')[1];

    if (!token) {
      if (isApi) return res.status(401).json({ erro: 'Não autenticado' });
      return res.redirect('/admin/login');
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded.admin) {
      if (isApi) return res.status(401).json({ erro: 'Acesso negado' });
      return res.redirect('/admin/login');
    }

    req.admin = decoded;
    next();
  } catch (err) {
    res.clearCookie('adminToken');
    if (isApi) return res.status(401).json({ erro: 'Token inválido ou expirado' });
    return res.redirect('/admin/login');
  }
};

module.exports = adminAuth;
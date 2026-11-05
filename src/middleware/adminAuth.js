const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');

/**
 * Middleware de autenticação do painel administrativo.
 * Verifica o cookie `adminToken` (ou o header Authorization).
 * - Em rotas de API (/api/...) responde 401 em JSON.
 * - Em rotas de página redireciona para /admin/login.
 */
const adminAuth = async (req, res, next) => {
  const isApi = req.originalUrl.startsWith('/api/');

  try {
    const token =
      req.cookies?.adminToken ||
      req.headers.authorization?.split(' ')[1];

    if (!token) {
      if (isApi) return res.status(401).json({ erro: 'Não autenticado' });
      return res.redirect('/login?admin');
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded.admin) {
      if (isApi) return res.status(401).json({ erro: 'Acesso negado' });
      return res.redirect('/login?admin');
    }

    // Confere no banco: conta excluída/desativada perde o acesso na hora,
    // e mudanças de cargo valem sem precisar sair e entrar de novo.
    const conta = await Admin.findById(decoded.id).select('nome email cargo ativo').lean();
    if (!conta || !conta.ativo) {
      res.clearCookie('adminToken');
      if (isApi) return res.status(401).json({ erro: 'Conta sem acesso ao painel' });
      return res.redirect('/login?admin');
    }

    req.admin = { ...decoded, nome: conta.nome, email: conta.email, cargo: conta.cargo };
    next();
  } catch (err) {
    res.clearCookie('adminToken');
    if (isApi) return res.status(401).json({ erro: 'Token inválido ou expirado' });
    return res.redirect('/login?admin');
  }
};

/**
 * Middleware extra: usar DEPOIS de adminAuth nas rotas que só o cargo
 * "desenvolvedor" pode acessar (gerenciamento de contas do painel).
 */
const apenasDev = (req, res, next) => {
  if (req.admin?.cargo !== 'desenvolvedor') {
    return res.status(403).json({ erro: 'Apenas desenvolvedores podem acessar esta área' });
  }
  next();
};

adminAuth.apenasDev = apenasDev;

module.exports = adminAuth;
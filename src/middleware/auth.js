const jwt = require('jsonwebtoken');
const User = require('../models/User');

const authMiddleware = async (req, res, next) => {
  try {
    const token = req.cookies?.authToken || req.headers.authorization?.split(' ')[1];

    if (!token) {
      // Para rotas de API retorna JSON, para páginas redireciona
      if (req.path.startsWith('/api/')) {
        return res.status(401).json({ erro: 'Não autenticado' });
      }
      return res.redirect('/login');
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);

    if (!user) {
      res.clearCookie('authToken');
      return res.redirect('/login');
    }

    req.user = user;
    next();
  } catch (err) {
    res.clearCookie('authToken');
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ erro: 'Token inválido ou expirado' });
    }
    return res.redirect('/login');
  }
};

module.exports = authMiddleware;
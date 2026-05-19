const jwt = require('jsonwebtoken');
const User = require('../models/User');
const suapService = require('../services/suapService');

/**
 * POST /api/auth/login
 */
const login = async (req, res) => {
  try {
    const { matricula, senha } = req.body;

    if (!matricula || !senha) {
      return res.status(400).json({
        erro: 'Matrícula e senha são obrigatórios',
      });
    }

    /**
     * =========================
     * AUTENTICAÇÃO SUAP
     * =========================
     */

    let authData;

    try {
      authData = await suapService.autenticar(
        matricula,
        senha
      );
    } catch (err) {
      const status = err.response?.status;

      if (status === 400 || status === 401) {
        return res.status(401).json({
          erro: 'Matrícula ou senha inválidos',
        });
      }

      console.error(err.response?.data || err.message);

      return res.status(500).json({
        erro: 'Erro ao autenticar no SUAP',
      });
    }

    const accessToken = authData.access;
    const refreshToken = authData.refresh;

    /**
     * =========================
     * DADOS DO USUÁRIO
     * =========================
     */

    let dadosSuap;

    try {
      dadosSuap = await suapService.getMeusDados(
        accessToken
      );
    } catch (err) {
      console.error(
        'Erro ao buscar dados SUAP:',
        err.response?.data || err.message
      );

      return res.status(500).json({
        erro: 'Erro ao buscar dados do usuário',
      });
    }

    const nomeUsuario =
      dadosSuap.nome_usual ||
      dadosSuap.nome ||
      matricula;

    /**
     * =========================
     * SALVA/ATUALIZA USUÁRIO
     * =========================
     */

    const user = await User.findOneAndUpdate(
      { matricula },
      {
        matricula,

        // TOKENS SUAP
        suapToken: accessToken,
        suapRefreshToken: refreshToken,

        nomeUsuario,
        ultimoAcesso: new Date(),
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      }
    );

    /**
     * =========================
     * JWT INTERNO
     * =========================
     */

    const internalToken = jwt.sign(
      {
        userId: user._id,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: '24h',
      }
    );

    /**
     * =========================
     * COOKIE
     * =========================
     */

    res.cookie('authToken', internalToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000,
    });

    /**
     * =========================
     * RESPONSE
     * =========================
     */

    return res.json({
      sucesso: true,

      usuario: {
        id: user._id,
        matricula,
        nome: nomeUsuario,
      },
    });
  } catch (err) {
    console.error(
      'Erro no login:',
      err.response?.data || err.message
    );

    return res.status(500).json({
      erro: 'Erro interno. Tente novamente.',
    });
  }
};

/**
 * POST /api/auth/logout
 */
const logout = async (req, res) => {
  try {
    if (req.user?.suapToken) {
      suapService.limparCache(
        req.user.suapToken
      );
    }
  } catch (err) {
    console.error(err.message);
  }

  res.clearCookie('authToken');

  return res.json({
    sucesso: true,
  });
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
    });
  } catch (err) {
    console.error(err.message);

    return res.status(500).json({
      erro: 'Erro ao buscar usuário',
    });
  }
};

module.exports = {
  login,
  logout,
  me,
};
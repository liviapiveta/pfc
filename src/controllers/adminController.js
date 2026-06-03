const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const Projeto = require('../models/Projeto');
const Evento = require('../models/Evento');
const Solicitacao = require('../models/Solicitacao');
const ProjetoSuapCache = require('../models/ProjetoSuapCache');

/**
 * Credenciais do administrador.
 * Por padrão usuário = "admin" e senha = "admin".
 * Em produção, defina ADMIN_USER e ADMIN_PASS no arquivo .env.
 */
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin';

// ── Autenticação ──────────────────────────────────────────────

/** POST /api/admin/login */
const login = (req, res) => {
  const { usuario, senha } = req.body;

  if (!usuario || !senha) {
    return res.status(400).json({ erro: 'Usuário e senha são obrigatórios' });
  }

  if (usuario !== ADMIN_USER || senha !== ADMIN_PASS) {
    return res.status(401).json({ erro: 'Credenciais inválidas' });
  }

  const token = jwt.sign(
    { admin: true, usuario },
    process.env.JWT_SECRET,
    { expiresIn: '12h' }
  );

  res.cookie('adminToken', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 12 * 60 * 60 * 1000,
  });

  return res.json({ sucesso: true });
};

/** POST /api/admin/logout */
const logout = (req, res) => {
  res.clearCookie('adminToken');
  return res.json({ sucesso: true });
};

// ── Estatísticas ──────────────────────────────────────────────

/** GET /api/admin/stats */
const stats = async (req, res) => {
  try {
    const [pesquisa, extensao, eventos, solicitacoes] = await Promise.all([
      Projeto.countDocuments({ tipo: 'pesquisa' }),
      Projeto.countDocuments({ tipo: 'extensao' }),
      Evento.countDocuments(),
      Solicitacao.countDocuments({ status: 'pendente' }),
    ]);
    return res.json({ pesquisa, extensao, eventos, solicitacoes });
  } catch (err) {
    console.error('Erro ao buscar stats:', err.message);
    return res.status(500).json({ erro: 'Erro ao buscar estatísticas' });
  }
};

// ── Projetos (pesquisa / extensão) ────────────────────────────

/**
 * GET /api/admin/projetos/:tipoOuId
 * - Se o parâmetro for "pesquisa" ou "extensao" → retorna a LISTA daquele tipo.
 * - Caso contrário, trata como _id e retorna UM projeto (para edição).
 */
const getProjetos = async (req, res) => {
  try {
    const { tipoOuId } = req.params;

    if (tipoOuId === 'pesquisa' || tipoOuId === 'extensao') {
      const lista = await Projeto.find({ tipo: tipoOuId }).sort({ createdAt: -1 });
      return res.json(lista);
    }

    if (!mongoose.Types.ObjectId.isValid(tipoOuId)) {
      return res.status(404).json({ erro: 'Projeto não encontrado' });
    }

    const proj = await Projeto.findById(tipoOuId);
    if (!proj) return res.status(404).json({ erro: 'Projeto não encontrado' });
    return res.json(proj);
  } catch (err) {
    console.error('Erro ao buscar projetos:', err.message);
    return res.status(500).json({ erro: 'Erro ao buscar projetos' });
  }
};

/** POST /api/admin/projetos */
const criarProjeto = async (req, res) => {
  try {
    const { tipo, titulo } = req.body;

    if (tipo !== 'pesquisa' && tipo !== 'extensao') {
      return res.status(400).json({ erro: 'Tipo de projeto inválido' });
    }
    if (!titulo || !titulo.trim()) {
      return res.status(400).json({ erro: 'O título é obrigatório' });
    }

    const proj = await Projeto.create(req.body);
    return res.status(201).json(proj);
  } catch (err) {
    console.error('Erro ao criar projeto:', err.message);
    return res.status(500).json({ erro: 'Erro ao criar projeto' });
  }
};

/** PUT /api/admin/projetos/:id */
const atualizarProjeto = async (req, res) => {
  try {
    const proj = await Projeto.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!proj) return res.status(404).json({ erro: 'Projeto não encontrado' });
    return res.json(proj);
  } catch (err) {
    console.error('Erro ao atualizar projeto:', err.message);
    return res.status(500).json({ erro: 'Erro ao atualizar projeto' });
  }
};

/** DELETE /api/admin/projetos/:id */
const deletarProjeto = async (req, res) => {
  try {
    const proj = await Projeto.findByIdAndDelete(req.params.id);
    if (!proj) return res.status(404).json({ erro: 'Projeto não encontrado' });
    return res.json({ sucesso: true });
  } catch (err) {
    console.error('Erro ao excluir projeto:', err.message);
    return res.status(500).json({ erro: 'Erro ao excluir projeto' });
  }
};

// ── Eventos ───────────────────────────────────────────────────

/** GET /api/admin/eventos */
const getEventos = async (req, res) => {
  try {
    const lista = await Evento.find().sort({ data_inicio: 1 });
    return res.json(lista);
  } catch (err) {
    console.error('Erro ao buscar eventos:', err.message);
    return res.status(500).json({ erro: 'Erro ao buscar eventos' });
  }
};

/** GET /api/admin/eventos/:id */
const getEvento = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ erro: 'Evento não encontrado' });
    }
    const ev = await Evento.findById(req.params.id);
    if (!ev) return res.status(404).json({ erro: 'Evento não encontrado' });
    return res.json(ev);
  } catch (err) {
    console.error('Erro ao buscar evento:', err.message);
    return res.status(500).json({ erro: 'Erro ao buscar evento' });
  }
};

/** POST /api/admin/eventos */
const criarEvento = async (req, res) => {
  try {
    const { nome, data_inicio } = req.body;
    if (!nome || !nome.trim()) {
      return res.status(400).json({ erro: 'O nome do evento é obrigatório' });
    }
    if (!data_inicio) {
      return res.status(400).json({ erro: 'A data de início é obrigatória' });
    }
    const ev = await Evento.create(req.body);
    return res.status(201).json(ev);
  } catch (err) {
    console.error('Erro ao criar evento:', err.message);
    return res.status(500).json({ erro: 'Erro ao criar evento' });
  }
};

/** PUT /api/admin/eventos/:id */
const atualizarEvento = async (req, res) => {
  try {
    const ev = await Evento.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!ev) return res.status(404).json({ erro: 'Evento não encontrado' });
    return res.json(ev);
  } catch (err) {
    console.error('Erro ao atualizar evento:', err.message);
    return res.status(500).json({ erro: 'Erro ao atualizar evento' });
  }
};

/** DELETE /api/admin/eventos/:id */
const deletarEvento = async (req, res) => {
  try {
    const ev = await Evento.findByIdAndDelete(req.params.id);
    if (!ev) return res.status(404).json({ erro: 'Evento não encontrado' });
    return res.json({ sucesso: true });
  } catch (err) {
    console.error('Erro ao excluir evento:', err.message);
    return res.status(500).json({ erro: 'Erro ao excluir evento' });
  }
};

// ── Solicitações de participação ──────────────────────────────

/** GET /api/admin/solicitacoes  (opcional ?status=pendente|aceito|recusado) */
const getSolicitacoes = async (req, res) => {
  try {
    const filtro = {};
    if (req.query.status) filtro.status = req.query.status;

    const lista = await Solicitacao.find(filtro)
      .populate('projeto', 'titulo tipo')
      .sort({ status: 1, createdAt: -1 })
      .lean();

    // Achata os dados para o front-end (funciona p/ origem local e suap)
    const resultado = lista.map(s => ({
      _id: s._id,
      origem: s.origem || 'local',
      matricula: s.matricula,
      nomeAluno: s.nomeAluno,
      status: s.status,
      criadoEm: s.createdAt,
      projetoTitulo: s.projeto?.titulo || s.projetoTitulo || '(projeto removido)',
      projetoTipo: s.projeto?.tipo || s.tipo || null,
    }));

    return res.json(resultado);
  } catch (err) {
    console.error('Erro ao buscar solicitações:', err.message);
    return res.status(500).json({ erro: 'Erro ao buscar solicitações' });
  }
};

/** PUT /api/admin/solicitacoes/:id   body: { status: 'aceito' | 'recusado' } */
const decidirSolicitacao = async (req, res) => {
  try {
    const { status } = req.body;
    if (!['aceito', 'recusado', 'pendente'].includes(status)) {
      return res.status(400).json({ erro: 'Status inválido' });
    }

    const sol = await Solicitacao.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true, runValidators: true }
    );
    if (!sol) return res.status(404).json({ erro: 'Solicitação não encontrada' });

    return res.json({ sucesso: true, status: sol.status });
  } catch (err) {
    console.error('Erro ao decidir solicitação:', err.message);
    return res.status(500).json({ erro: 'Erro ao atualizar solicitação' });
  }
};

// ── Catálogo de projetos do SUAP (espelho local, somente leitura) ──

/** GET /api/admin/projetos-suap/:tipo  (pesquisa | extensao) */
const getProjetosSuap = async (req, res) => {
  try {
    const { tipo } = req.params;
    if (tipo !== 'pesquisa' && tipo !== 'extensao') {
      return res.status(400).json({ erro: 'Tipo inválido' });
    }
    const lista = await ProjetoSuapCache.find({ tipo }).sort({ titulo: 1 }).lean();
    return res.json(lista);
  } catch (err) {
    console.error('Erro ao buscar projetos do SUAP:', err.message);
    return res.status(500).json({ erro: 'Erro ao buscar projetos do SUAP' });
  }
};

module.exports = {
  login,
  logout,
  stats,
  getProjetos,
  criarProjeto,
  atualizarProjeto,
  deletarProjeto,
  getEventos,
  getEvento,
  criarEvento,
  atualizarEvento,
  deletarEvento,
  getSolicitacoes,
  decidirSolicitacao,
  getProjetosSuap,
};
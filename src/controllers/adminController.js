const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const Projeto = require('../models/Projeto');
const Evento = require('../models/Evento');
const Solicitacao = require('../models/Solicitacao');
const ProjetoSuapCache = require('../models/ProjetoSuapCache');
const Admin = require('../models/Admin');
const conquistaEngine = require('../services/conquistaEngine');

// ── Autenticação ──────────────────────────────────────────────

/** POST /api/admin/login */
const login = async (req, res) => {
  const { usuario, senha } = req.body;
  const email = String(usuario || '').trim().toLowerCase();

  if (!email || !senha) {
    return res.status(400).json({ erro: 'E-mail e senha são obrigatórios' });
  }

  try {
    const conta = await Admin.findOne({ email, ativo: true });
    if (!conta) {
      return res.status(401).json({ erro: 'Credenciais inválidas' });
    }

    const senhaOk = await conta.verificarSenha(senha);
    if (!senhaOk) {
      return res.status(401).json({ erro: 'Credenciais inválidas' });
    }

    conta.ultimoAcesso = new Date();
    await conta.save();

    const token = jwt.sign(
      { admin: true, id: conta._id.toString(), nome: conta.nome, email: conta.email, cargo: conta.cargo },
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
  } catch (err) {
    console.error('Erro no login admin:', err.message);
    return res.status(500).json({ erro: 'Erro ao autenticar' });
  }
};

/** POST /api/admin/logout */
const logout = (req, res) => {
  res.clearCookie('adminToken');
  return res.json({ sucesso: true });
};

/** GET /api/admin/me — retorna os dados do admin logado (nome, email, cargo) */
const me = (req, res) => {
  return res.json({
    id: req.admin.id,
    nome: req.admin.nome,
    email: req.admin.email,
    cargo: req.admin.cargo,
  });
};

// ── Gerenciamento de contas (somente desenvolvedor) ────────────

/** GET /api/admin/contas */
const getContas = async (req, res) => {
  try {
    const contas = await Admin.find().select('-senhaHash').sort({ nome: 1 }).lean();
    return res.json(contas);
  } catch (err) {
    console.error('Erro ao listar contas:', err.message);
    return res.status(500).json({ erro: 'Erro ao listar contas' });
  }
};

/** POST /api/admin/contas */
const criarConta = async (req, res) => {
  try {
    const { nome, email, senha, cargo } = req.body;
    if (!nome || !email || !senha) {
      return res.status(400).json({ erro: 'Nome, e-mail e senha são obrigatórios' });
    }
    if (senha.length < 6) {
      return res.status(400).json({ erro: 'A senha precisa ter pelo menos 6 caracteres' });
    }
    const emailNorm = String(email).trim().toLowerCase();
    const existente = await Admin.findOne({ email: emailNorm });
    if (existente) {
      return res.status(409).json({ erro: 'Já existe uma conta com este e-mail' });
    }

    const senhaHash = await Admin.gerarHash(senha);
    const conta = await Admin.create({
      nome: nome.trim(),
      email: emailNorm,
      senhaHash,
      cargo: cargo === 'desenvolvedor' ? 'desenvolvedor' : 'professor',
    });

    return res.status(201).json({
      _id: conta._id, nome: conta.nome, email: conta.email, cargo: conta.cargo, ativo: conta.ativo,
    });
  } catch (err) {
    console.error('Erro ao criar conta:', err.message);
    return res.status(500).json({ erro: 'Erro ao criar conta' });
  }
};

/** PUT /api/admin/contas/:id — edita nome, cargo e/ou status ativo */
const atualizarConta = async (req, res) => {
  try {
    const { nome, cargo, ativo } = req.body;
    const dados = {};
    if (nome !== undefined) dados.nome = nome.trim();
    if (cargo !== undefined) dados.cargo = cargo === 'desenvolvedor' ? 'desenvolvedor' : 'professor';
    if (ativo !== undefined) dados.ativo = !!ativo;

    const conta = await Admin.findByIdAndUpdate(req.params.id, dados, { new: true }).select('-senhaHash');
    if (!conta) return res.status(404).json({ erro: 'Conta não encontrada' });
    return res.json(conta);
  } catch (err) {
    console.error('Erro ao atualizar conta:', err.message);
    return res.status(500).json({ erro: 'Erro ao atualizar conta' });
  }
};

/** PUT /api/admin/contas/:id/senha — redefine a senha de uma conta */
const redefinirSenha = async (req, res) => {
  try {
    const { senha } = req.body;
    if (!senha || senha.length < 6) {
      return res.status(400).json({ erro: 'A senha precisa ter pelo menos 6 caracteres' });
    }
    const senhaHash = await Admin.gerarHash(senha);
    const conta = await Admin.findByIdAndUpdate(req.params.id, { senhaHash }, { new: true }).select('-senhaHash');
    if (!conta) return res.status(404).json({ erro: 'Conta não encontrada' });
    return res.json({ sucesso: true });
  } catch (err) {
    console.error('Erro ao redefinir senha:', err.message);
    return res.status(500).json({ erro: 'Erro ao redefinir senha' });
  }
};

/** DELETE /api/admin/contas/:id */
const deletarConta = async (req, res) => {
  try {
    if (req.params.id === req.admin.id) {
      return res.status(400).json({ erro: 'Você não pode excluir a própria conta' });
    }
    const conta = await Admin.findByIdAndDelete(req.params.id);
    if (!conta) return res.status(404).json({ erro: 'Conta não encontrada' });
    return res.json({ sucesso: true });
  } catch (err) {
    console.error('Erro ao excluir conta:', err.message);
    return res.status(500).json({ erro: 'Erro ao excluir conta' });
  }
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
      // Carimba a data da decisão quando aceita; limpa se sair de aceita.
      { status, decididoEm: status === 'aceito' ? new Date() : null },
      { new: true, runValidators: true }
    );
    if (!sol) return res.status(404).json({ erro: 'Solicitação não encontrada' });

    // Gatilho de gamificação: aceitar pode CONCEDER conquista(s) automática(s);
    // recusar/voltar a pendente pode REVOGÁ-las (se não houver mais
    // justificativa). O update acima já gravou o novo status, então a
    // reversão conta corretamente os projetos que ainda estão aceitos.
    // Nunca quebra a resposta se algo falhar aqui.
    try {
      if (sol.status === 'aceito') {
        await conquistaEngine.processarProjetoAceito(sol);
      } else {
        await conquistaEngine.reverterProjetoAceito(sol);
      }
    } catch (e) {
      console.error('Falha ao processar conquista de solicitação:', e.message);
    }

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
  me,
  getContas,
  criarConta,
  atualizarConta,
  redefinirSenha,
  deletarConta,
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
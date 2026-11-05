const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const Projeto = require('../models/Projeto');
const Evento = require('../models/Evento');
const Solicitacao = require('../models/Solicitacao');
const ProjetoSuapCache = require('../models/ProjetoSuapCache');
const Admin = require('../models/Admin');
const conquistaEngine = require('../services/conquistaEngine');
const { enviarLinkSenha } = require('../services/emailService');
const { importarServidores: importarListaServidores } = require('../services/contasService');

// ── Helpers ───────────────────────────────────────────────────

/** Aceita só links http(s) — bloqueia "javascript:" e afins em link_suap */
const linkSeguro = (v) => {
  const s = String(v || '').trim();
  if (!s) return '';
  try { return ['http:', 'https:'].includes(new URL(s).protocol) ? s : ''; } catch { return ''; }
};

const INTERVALO_REENVIO_MS = 60 * 1000; // evita spam: 1 e-mail por minuto por conta
const SENHA_MIN = 8;
const MAX_TENTATIVAS = 5;
const BLOQUEIO_MS = 15 * 60 * 1000;

const comLinkSeguro = (body = {}) => {
  const b = { ...body };
  delete b._id;
  if ('link_suap' in b) b.link_suap = linkSeguro(b.link_suap);
  return b;
};

const normEmail = (e) => String(e || '').trim().toLowerCase();

const baseUrl = (req) =>
  (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');

/** Gera token, salva e envia o e-mail "Cadastrar/Redefinir senha" */
const enviarLinkParaConta = async (req, conta, { forcar = false } = {}) => {
  const agora = Date.now();
  if (!forcar && conta.ultimoEnvioEmail && agora - conta.ultimoEnvioEmail.getTime() < INTERVALO_REENVIO_MS) {
    return { enviado: false, motivo: 'aguarde' };
  }
  const token = conta.gerarTokenSenha();
  conta.ultimoEnvioEmail = new Date();
  await conta.save();

  await enviarLinkSenha({
    nome: conta.nome,
    email: conta.email,
    link: `${baseUrl(req)}/admin/definir-senha?token=${token}`,
    redefinir: !!conta.senhaHash,
  });
  return { enviado: true };
};

const iniciarSessao = (res, conta) => {
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
};

/** Remove campos secretos antes de mandar a conta para o front */
const contaPublica = (c) => ({
  _id: c._id,
  nome: c.nome,
  email: c.email,
  area: c.area || '',
  cargo: c.cargo,
  ativo: c.ativo,
  temSenha: !!c.senhaHash,
  conviteEnviadoEm: c.ultimoEnvioEmail || null,
  ultimoAcesso: c.ultimoAcesso || null,
});

// ── Autenticação ──────────────────────────────────────────────

/**
 * POST /api/admin/login/email  { email }
 * Etapa 1 do login. Verifica se o e-mail está autorizado:
 *  - tem senha     → { etapa: 'senha' }  (front mostra o campo de senha)
 *  - não tem senha → envia o link "Cadastrar sua senha" → { etapa: 'email-enviado' }
 *  - não autorizado → 403
 */
const verificarEmail = async (req, res) => {
  const email = normEmail(req.body.email);
  if (!email) return res.status(400).json({ erro: 'Informe seu e-mail.' });

  try {
    const conta = await Admin.findOne({ email });
    if (!conta || !conta.ativo) {
      return res.status(403).json({
        erro: 'Este e-mail não tem permissão de acesso. O painel é restrito a docentes e substitutos do IFPR.',
      });
    }

    if (conta.senhaHash) {
      return res.json({ etapa: 'senha', nome: conta.nome });
    }

    try {
      await enviarLinkParaConta(req, conta);
    } catch (e) {
      console.error('Erro ao enviar e-mail de cadastro de senha:', e.message);
      return res.status(500).json({ erro: 'Não foi possível enviar o e-mail agora. Tente novamente em instantes.' });
    }
    return res.json({ etapa: 'email-enviado', email: conta.email });
  } catch (err) {
    console.error('Erro ao verificar e-mail admin:', err.message);
    return res.status(500).json({ erro: 'Erro ao verificar e-mail' });
  }
};

/** POST /api/admin/login  { email, senha } — Etapa 2 do login */
const login = async (req, res) => {
  const email = normEmail(req.body.email || req.body.usuario);
  const { senha } = req.body;

  if (!email || !senha) {
    return res.status(400).json({ erro: 'E-mail e senha são obrigatórios' });
  }

  try {
    const conta = await Admin.findOne({ email, ativo: true });
    if (!conta) return res.status(401).json({ erro: 'E-mail ou senha incorretos' });

    if (conta.bloqueadoAte && conta.bloqueadoAte > new Date()) {
      const min = Math.ceil((conta.bloqueadoAte - Date.now()) / 60000);
      return res.status(429).json({ erro: `Muitas tentativas. Tente novamente em ${min} min ou use "Esqueci minha senha".` });
    }

    if (!(await conta.verificarSenha(String(senha)))) {
      conta.tentativasFalhas = (conta.tentativasFalhas || 0) + 1;
      if (conta.tentativasFalhas >= MAX_TENTATIVAS) {
        conta.bloqueadoAte = new Date(Date.now() + BLOQUEIO_MS);
        conta.tentativasFalhas = 0;
      }
      await conta.save();
      return res.status(401).json({ erro: 'E-mail ou senha incorretos' });
    }

    conta.tentativasFalhas = 0;
    conta.bloqueadoAte = null;
    conta.ultimoAcesso = new Date();
    await conta.save();
    iniciarSessao(res, conta);
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

/** GET /api/admin/me */
const me = (req, res) => {
  return res.json({
    id: req.admin.id,
    nome: req.admin.nome,
    email: req.admin.email,
    cargo: req.admin.cargo,
  });
};

/**
 * POST /api/admin/senha/esqueci  { email }
 * Sempre responde a mesma coisa (não revela se a conta existe).
 */
const esqueciSenha = async (req, res) => {
  const email = normEmail(req.body.email);
  try {
    const conta = email ? await Admin.findOne({ email, ativo: true }) : null;
    if (conta) {
      await enviarLinkParaConta(req, conta).catch((e) =>
        console.error('Erro ao enviar e-mail de redefinição:', e.message)
      );
    }
  } catch (err) {
    console.error('Erro em esqueciSenha:', err.message);
  }
  return res.json({ sucesso: true });
};

/** Busca a conta dona de um token válido (não expirado) */
const contaPorToken = (token) => {
  if (!token || typeof token !== 'string') return null;
  return Admin.findOne({
    tokenSenhaHash: Admin.hashToken(token),
    tokenSenhaExpira: { $gt: new Date() },
    ativo: true,
  });
};

/** GET /api/admin/senha/token/:token — valida o link antes de mostrar o formulário */
const validarToken = async (req, res) => {
  try {
    const conta = await contaPorToken(req.params.token);
    if (!conta) return res.status(400).json({ valido: false, erro: 'Link inválido ou expirado.' });
    return res.json({ valido: true, nome: conta.nome, email: conta.email, redefinir: !!conta.senhaHash });
  } catch (err) {
    console.error('Erro ao validar token:', err.message);
    return res.status(500).json({ erro: 'Erro ao validar link' });
  }
};

/** POST /api/admin/senha/definir  { token, senha } — cadastra a senha e já entra */
const definirSenha = async (req, res) => {
  const { token, senha } = req.body;
  if (!senha || String(senha).length < SENHA_MIN) {
    return res.status(400).json({ erro: `A senha precisa ter pelo menos ${SENHA_MIN} caracteres.` });
  }
  try {
    const conta = await contaPorToken(token);
    if (!conta) return res.status(400).json({ erro: 'Link inválido ou expirado. Peça um novo na tela de login.' });

    conta.senhaHash = await Admin.gerarHash(String(senha));
    conta.tokenSenhaHash = null;
    conta.tokenSenhaExpira = null;
    conta.tentativasFalhas = 0;
    conta.bloqueadoAte = null;
    conta.ultimoAcesso = new Date();
    await conta.save();

    iniciarSessao(res, conta);
    return res.json({ sucesso: true });
  } catch (err) {
    console.error('Erro ao definir senha:', err.message);
    return res.status(500).json({ erro: 'Erro ao salvar a senha' });
  }
};

// ── Gerenciamento de contas (somente desenvolvedor) ────────────

/** GET /api/admin/contas */
const getContas = async (req, res) => {
  try {
    const contas = await Admin.find().sort({ nome: 1 }).lean();
    return res.json(contas.map(contaPublica));
  } catch (err) {
    console.error('Erro ao listar contas:', err.message);
    return res.status(500).json({ erro: 'Erro ao listar contas' });
  }
};

/** POST /api/admin/contas  { nome, email, cargo, area, enviarConvite } */
const criarConta = async (req, res) => {
  try {
    const { nome, email, cargo, area, enviarConvite } = req.body;
    if (!nome || !email) {
      return res.status(400).json({ erro: 'Nome e e-mail são obrigatórios' });
    }
    const emailNorm = normEmail(email);
    if (await Admin.findOne({ email: emailNorm })) {
      return res.status(409).json({ erro: 'Já existe uma conta com este e-mail' });
    }

    const conta = await Admin.create({
      nome: String(nome).trim(),
      email: emailNorm,
      area: String(area || '').trim(),
      cargo: Admin.CARGOS.includes(cargo) ? cargo : 'professor',
    });

    let conviteEnviado = false;
    if (enviarConvite) {
      try {
        conviteEnviado = (await enviarLinkParaConta(req, conta, { forcar: true })).enviado;
      } catch (e) {
        console.error('Conta criada, mas o convite falhou:', e.message);
      }
    }

    return res.status(201).json({ ...contaPublica(conta), conviteEnviado });
  } catch (err) {
    console.error('Erro ao criar conta:', err.message);
    return res.status(500).json({ erro: 'Erro ao criar conta' });
  }
};

/** PUT /api/admin/contas/:id — edita nome, área, cargo e/ou status */
const atualizarConta = async (req, res) => {
  try {
    const { nome, cargo, ativo, area } = req.body;
    const propria = req.params.id === req.admin.id;
    const dados = {};
    if (nome !== undefined) dados.nome = String(nome).trim();
    if (area !== undefined) dados.area = String(area).trim();
    if (cargo !== undefined && Admin.CARGOS.includes(cargo)) {
      if (propria && cargo !== 'desenvolvedor') {
        return res.status(400).json({ erro: 'Você não pode remover o próprio cargo de desenvolvedor(a).' });
      }
      dados.cargo = cargo;
    }
    if (ativo !== undefined) {
      if (propria && !ativo) return res.status(400).json({ erro: 'Você não pode desativar a própria conta.' });
      dados.ativo = !!ativo;
    }

    const conta = await Admin.findByIdAndUpdate(req.params.id, dados, { returnDocument: 'after' }).lean();
    if (!conta) return res.status(404).json({ erro: 'Conta não encontrada' });
    return res.json(contaPublica(conta));
  } catch (err) {
    console.error('Erro ao atualizar conta:', err.message);
    return res.status(500).json({ erro: 'Erro ao atualizar conta' });
  }
};

/** POST /api/admin/contas/:id/convite — (re)envia o link de cadastrar/redefinir senha */
const enviarConvite = async (req, res) => {
  try {
    const conta = await Admin.findById(req.params.id);
    if (!conta) return res.status(404).json({ erro: 'Conta não encontrada' });
    if (!conta.ativo) return res.status(400).json({ erro: 'Ative a conta antes de enviar o convite.' });

    await enviarLinkParaConta(req, conta, { forcar: true });
    return res.json({ sucesso: true, redefinir: !!conta.senhaHash });
  } catch (err) {
    console.error('Erro ao enviar convite:', err.message);
    return res.status(500).json({ erro: 'Não foi possível enviar o e-mail' });
  }
};

/** POST /api/admin/contas/importar — importa a lista oficial de servidores IFPR */
const importarServidores = async (req, res) => {
  try {
    const resultado = await importarListaServidores();
    return res.json(resultado);
  } catch (err) {
    console.error('Erro ao importar servidores:', err.message);
    return res.status(500).json({ erro: 'Erro ao importar a lista de servidores' });
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

    const proj = await Projeto.create(comLinkSeguro(req.body));
    return res.status(201).json(proj);
  } catch (err) {
    console.error('Erro ao criar projeto:', err.message);
    return res.status(500).json({ erro: 'Erro ao criar projeto' });
  }
};

/** PUT /api/admin/projetos/:id */
const atualizarProjeto = async (req, res) => {
  try {
    const proj = await Projeto.findByIdAndUpdate(req.params.id, comLinkSeguro(req.body), {
      returnDocument: 'after',
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
    const ev = await Evento.create(comLinkSeguro(req.body));
    return res.status(201).json(ev);
  } catch (err) {
    console.error('Erro ao criar evento:', err.message);
    return res.status(500).json({ erro: 'Erro ao criar evento' });
  }
};

/** PUT /api/admin/eventos/:id */
const atualizarEvento = async (req, res) => {
  try {
    const ev = await Evento.findByIdAndUpdate(req.params.id, comLinkSeguro(req.body), {
      returnDocument: 'after',
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
      { returnDocument: 'after', runValidators: true }
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
  verificarEmail,
  login,
  logout,
  me,
  esqueciSenha,
  validarToken,
  definirSenha,
  getContas,
  criarConta,
  atualizarConta,
  enviarConvite,
  importarServidores,
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
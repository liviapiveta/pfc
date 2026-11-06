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
const User = require('../models/User');
const ConquistaUsuario = require('../models/ConquistaUsuario');
const Auditoria = require('../models/Auditoria');
const { registrar } = require('../services/auditoria');
const { notificarAluno } = require('../services/notificacoes');
const Presenca = require('../models/Presenca');
const Comprovante = require('../models/Comprovante');
const { contagemPorEvento, lerConfigEvento, validacaoDe } = require('./presencaController');

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
  // Campos que o formulário nunca pode definir
  delete b._id; delete b.criadoPor; delete b.criadoPorEmail; delete b.podeEditar;
  delete b.createdAt; delete b.updatedAt;
  if ('link_suap' in b) b.link_suap = linkSeguro(b.link_suap);
  return b;
};

const normEmail = (e) => String(e || '').trim().toLowerCase();

/**
 * Endereço do site usado nos links dos e-mails.
 * NUNCA usa o cabeçalho Host da requisição em produção: quem faz o pedido
 * controla esse cabeçalho, e poderia fazer o e-mail "Redefinir senha"
 * (verdadeiro, enviado pelo IFPlenus) apontar para um site falso e roubar o token.
 * Ordem: 1º endereço de APP_URL → domínio de produção da Vercel → (só em
 * desenvolvimento) o host da requisição.
 */
const baseUrl = (req) => {
  const doEnv = String(process.env.APP_URL || '').split(',')[0].trim();
  if (doEnv) return doEnv.replace(/\/+$/, '');
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('APP_URL não configurado — defina o endereço do site nas variáveis de ambiente');
  }
  return `${req.protocol}://${req.get('host')}`;
};

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
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm)) {
      return res.status(400).json({ erro: 'E-mail inválido' });
    }
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

    registrar(req, 'conta.criar', `${conta.nome} <${conta.email}>`, { cargo: conta.cargo });
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
    registrar(req, 'conta.editar', `${conta.nome} <${conta.email}>`, dados);
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
    registrar(req, 'conta.convite', `${conta.nome} <${conta.email}>`);
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
    registrar(req, 'conta.importar', 'Lista oficial de servidores IFPR', resultado);
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
    registrar(req, 'conta.excluir', `${conta.nome} <${conta.email}>`);
    return res.json({ sucesso: true });
  } catch (err) {
    console.error('Erro ao excluir conta:', err.message);
    return res.status(500).json({ erro: 'Erro ao excluir conta' });
  }
};

// ── Permissões: painel do professor ───────────────────────────
// Desenvolvedor(a) vê e gerencia TUDO. Docentes e substitutos gerenciam só
// os projetos/eventos que cadastraram (ou em que são o e-mail do coordenador)
// e só as solicitações desses projetos.
const ehDev = (req) => req.admin?.cargo === 'desenvolvedor';
const escRegex = (s) => String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const regexEmail = (email) => new RegExp(`^${escRegex(email)}$`, 'i');

const filtroMeusProjetos = (req) => {
  if (ehDev(req)) return {};
  const ou = [{ criadoPor: req.admin.id }];
  // (sem e-mail, o regex /^$/ casaria com TODOS os projetos sem coordenador)
  if (req.admin.email) ou.push({ email_coordenador: regexEmail(req.admin.email) });
  return { $or: ou };
};

const podeGerirProjeto = (req, p) => ehDev(req) || !!(p && (
  p.criadoPor === req.admin.id ||
  String(p.email_coordenador || '').toLowerCase() === String(req.admin.email || '').toLowerCase()
));
const podeGerirEvento = (req, ev) => ehDev(req) || !!(ev && ev.criadoPor === req.admin.id);

/** Filtro das solicitações que este admin pode ver/decidir */
const filtroMinhasSolicitacoes = async (req) => {
  if (ehDev(req)) return {};
  const [locais, suap] = await Promise.all([
    Projeto.find(filtroMeusProjetos(req)).select('_id').lean(),
    req.admin.email
      ? ProjetoSuapCache.find({ email_coordenador: regexEmail(req.admin.email) }).select('suapId').lean()
      : Promise.resolve([]),
  ]);
  return {
    $or: [
      { origem: 'local', projeto: { $in: locais.map(p => p._id) } },
      { origem: 'suap', projetoSuapId: { $in: suap.map(p => p.suapId) } },
    ],
  };
};

// ── Estatísticas rápidas (cards da Visão geral) ───────────────

/** GET /api/admin/stats — contagens dentro do que o admin pode ver */
const stats = async (req, res) => {
  try {
    const meus = filtroMeusProjetos(req);
    const filtroSol = await filtroMinhasSolicitacoes(req);
    const [pesquisa, extensao, eventos, solicitacoes] = await Promise.all([
      Projeto.countDocuments({ ...meus, tipo: 'pesquisa' }),
      Projeto.countDocuments({ ...meus, tipo: 'extensao' }),
      Evento.countDocuments(),
      Solicitacao.countDocuments({ ...filtroSol, status: 'pendente' }),
    ]);
    return res.json({ pesquisa, extensao, eventos, solicitacoes, escopo: ehDev(req) ? 'tudo' : 'meus' });
  } catch (err) {
    console.error('Erro ao buscar stats:', err.message);
    return res.status(500).json({ erro: 'Erro ao buscar estatísticas' });
  }
};

// ── Projetos (pesquisa / extensão) ────────────────────────────

/**
 * GET /api/admin/projetos/:tipoOuId
 * - "pesquisa" | "extensao" → LISTA (professor: só os seus)
 * - _id                       → UM projeto (para edição)
 */
const getProjetos = async (req, res) => {
  try {
    const { tipoOuId } = req.params;

    if (tipoOuId === 'pesquisa' || tipoOuId === 'extensao') {
      const lista = await Projeto.find({ ...filtroMeusProjetos(req), tipo: tipoOuId }).sort({ createdAt: -1 }).lean();
      return res.json(lista.map(p => ({ ...p, podeEditar: podeGerirProjeto(req, p) })));
    }

    if (!mongoose.Types.ObjectId.isValid(tipoOuId)) {
      return res.status(404).json({ erro: 'Projeto não encontrado' });
    }
    const proj = await Projeto.findById(tipoOuId).lean();
    if (!proj || !podeGerirProjeto(req, proj)) return res.status(404).json({ erro: 'Projeto não encontrado' });
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
    if (!titulo || !String(titulo).trim()) {
      return res.status(400).json({ erro: 'O título é obrigatório' });
    }
    if (req.body.dt_inicio && req.body.dt_final && String(req.body.dt_final) < String(req.body.dt_inicio)) {
      return res.status(400).json({ erro: 'A data final não pode ser antes da data de início' });
    }

    const proj = await Projeto.create({
      ...comLinkSeguro(req.body),
      criadoPor: req.admin.id,
      criadoPorEmail: req.admin.email || '',
    });
    registrar(req, 'projeto.criar', proj.titulo, { tipo: proj.tipo });
    return res.status(201).json(proj);
  } catch (err) {
    console.error('Erro ao criar projeto:', err.message);
    return res.status(500).json({ erro: 'Erro ao criar projeto' });
  }
};

/** PUT /api/admin/projetos/:id */
const atualizarProjeto = async (req, res) => {
  try {
    const atual = await Projeto.findById(req.params.id).lean();
    if (!atual) return res.status(404).json({ erro: 'Projeto não encontrado' });
    if (!podeGerirProjeto(req, atual)) return res.status(403).json({ erro: 'Você só pode editar os seus próprios projetos.' });

    const dados = comLinkSeguro(req.body);
    const ini = dados.dt_inicio ?? atual.dt_inicio, fim = dados.dt_final ?? atual.dt_final;
    if (ini && fim && String(fim) < String(ini)) {
      return res.status(400).json({ erro: 'A data final não pode ser antes da data de início' });
    }
    const proj = await Projeto.findByIdAndUpdate(req.params.id, dados, { returnDocument: 'after', runValidators: true });
    registrar(req, 'projeto.editar', proj.titulo, { tipo: proj.tipo });
    return res.json(proj);
  } catch (err) {
    console.error('Erro ao atualizar projeto:', err.message);
    return res.status(500).json({ erro: 'Erro ao atualizar projeto' });
  }
};

/** DELETE /api/admin/projetos/:id */
const deletarProjeto = async (req, res) => {
  try {
    const atual = await Projeto.findById(req.params.id).lean();
    if (!atual) return res.status(404).json({ erro: 'Projeto não encontrado' });
    if (!podeGerirProjeto(req, atual)) return res.status(403).json({ erro: 'Você só pode excluir os seus próprios projetos.' });

    await Projeto.deleteOne({ _id: atual._id });
    // Pedidos pendentes/recusados de um projeto que não existe mais só poluíam a
    // lista. Os ACEITOS ficam (histórico do aluno e justificam conquistas já ganhas).
    await Solicitacao.deleteMany({ origem: 'local', projeto: atual._id, status: { $ne: 'aceito' } });
    registrar(req, 'projeto.excluir', atual.titulo, { tipo: atual.tipo });
    return res.json({ sucesso: true });
  } catch (err) {
    console.error('Erro ao excluir projeto:', err.message);
    return res.status(500).json({ erro: 'Erro ao excluir projeto' });
  }
};

// ── Eventos ───────────────────────────────────────────────────
// Todos veem todos os eventos (são do campus); cada um edita os que cadastrou.

/** GET /api/admin/eventos */
const getEventos = async (req, res) => {
  try {
    const lista = await Evento.find().populate('conquista', 'nome pontos icone').sort({ data_inicio: 1 }).lean();
    const contagem = await contagemPorEvento(lista.map(ev => ev._id));
    return res.json(lista.map(ev => ({
      ...ev,
      validacao: validacaoDe(ev.validacao),
      conquista: ev.conquista ? { _id: ev.conquista._id, nome: ev.conquista.nome, pontos: ev.conquista.pontos, icone: ev.conquista.icone } : null,
      presencas: contagem[String(ev._id)] || { aprovada: 0, pendente: 0, recusada: 0 },
      podeEditar: podeGerirEvento(req, ev),
    })));
  } catch (err) {
    console.error('Erro ao buscar eventos:', err.message);
    return res.status(500).json({ erro: 'Erro ao buscar eventos' });
  }
};

/** GET /api/admin/eventos/:id */
const getEvento = async (req, res) => {
  try {
    const ev = await Evento.findById(req.params.id).lean();
    if (!ev) return res.status(404).json({ erro: 'Evento não encontrado' });
    return res.json({ ...ev, validacao: validacaoDe(ev.validacao), podeEditar: podeGerirEvento(req, ev) });
  } catch (err) {
    console.error('Erro ao buscar evento:', err.message);
    return res.status(500).json({ erro: 'Erro ao buscar evento' });
  }
};

/**
 * Só os campos que o formulário de evento pode definir (lista branca).
 * Antes o corpo inteiro ia para o banco — dava para gravar campos internos.
 * Devolve { dados } ou { erro }.
 */
const CAMPOS_EVENTO = ['nome', 'apresentacao', 'data_inicio', 'data_fim', 'hora_inicio', 'hora_fim', 'local', 'campus', 'link_suap'];
const dadosEvento = async (body = {}, parcial = false) => {
  const dados = {};
  CAMPOS_EVENTO.forEach((k) => {
    if (body[k] === undefined) return;
    const v = body[k] === null ? null : String(body[k]).trim().slice(0, k === 'apresentacao' ? 5000 : 300);
    dados[k] = v === '' && !['nome', 'apresentacao', 'local', 'campus'].includes(k) ? null : v;
  });
  if ('link_suap' in dados) dados.link_suap = linkSeguro(dados.link_suap) || null;
  ['data_inicio', 'data_fim'].forEach((k) => {
    if (dados[k] && !/^\d{4}-\d{2}-\d{2}$/.test(dados[k])) dados[k] = 'invalida';
  });
  if (dados.data_inicio === 'invalida' || dados.data_fim === 'invalida') return { erro: 'Data inválida' };

  // Validação e conquista: mesma regra dos eventos do SUAP
  const cfg = await lerConfigEvento({
    validacao: body.validacao !== undefined || !parcial ? (body.validacao || {}) : undefined,
    conquista: body.conquista,
  });
  if (cfg.erro) return { erro: cfg.erro };
  return { dados: { ...dados, ...cfg.dados } };
};

const validarDatasEvento = (ini, fim) =>
  (fim && ini && String(fim) < String(ini)) ? 'A data de fim não pode ser antes da data de início' : null;

/** POST /api/admin/eventos */
const criarEvento = async (req, res) => {
  try {
    const { nome, data_inicio } = req.body;
    if (!nome || !String(nome).trim()) {
      return res.status(400).json({ erro: 'O nome do evento é obrigatório' });
    }
    if (!data_inicio) {
      return res.status(400).json({ erro: 'A data de início é obrigatória' });
    }
    const { dados, erro } = await dadosEvento(req.body);
    if (erro) return res.status(400).json({ erro });
    const erroData = validarDatasEvento(dados.data_inicio, dados.data_fim);
    if (erroData) return res.status(400).json({ erro: erroData });

    const ev = await Evento.create({
      ...dados,
      criadoPor: req.admin.id,
      criadoPorEmail: req.admin.email || '',
    });
    registrar(req, 'evento.criar', ev.nome, { data: ev.data_inicio });
    return res.status(201).json(ev);
  } catch (err) {
    console.error('Erro ao criar evento:', err.message);
    return res.status(500).json({ erro: 'Erro ao criar evento' });
  }
};

/** PUT /api/admin/eventos/:id */
const atualizarEvento = async (req, res) => {
  try {
    const atual = await Evento.findById(req.params.id).lean();
    if (!atual) return res.status(404).json({ erro: 'Evento não encontrado' });
    if (!podeGerirEvento(req, atual)) return res.status(403).json({ erro: 'Você só pode editar eventos que você cadastrou.' });

    const { dados, erro } = await dadosEvento(req.body, true);
    if (erro) return res.status(400).json({ erro });
    if ('nome' in dados && !dados.nome) return res.status(400).json({ erro: 'O nome do evento é obrigatório' });
    if ('data_inicio' in dados && !dados.data_inicio) return res.status(400).json({ erro: 'A data de início é obrigatória' });
    const erroData = validarDatasEvento(
      'data_inicio' in dados ? dados.data_inicio : atual.data_inicio,
      'data_fim' in dados ? dados.data_fim : atual.data_fim
    );
    if (erroData) return res.status(400).json({ erro: erroData });

    const ev = await Evento.findByIdAndUpdate(req.params.id, { $set: dados }, { returnDocument: 'after', runValidators: true });
    registrar(req, 'evento.editar', ev.nome, { data: ev.data_inicio });
    // Trocou a conquista do evento → acerta quem já tem presença validada nele
    if ('conquista' in dados && String(dados.conquista || '') !== String(atual.conquista || '')) {
      await conquistaEngine.sincronizarAlunosDoEvento({ origem: 'local', evento: atual._id });
    }
    return res.json(ev);
  } catch (err) {
    console.error('Erro ao atualizar evento:', err.message);
    return res.status(500).json({ erro: 'Erro ao atualizar evento' });
  }
};

/** DELETE /api/admin/eventos/:id */
const deletarEvento = async (req, res) => {
  try {
    const atual = await Evento.findById(req.params.id).lean();
    if (!atual) return res.status(404).json({ erro: 'Evento não encontrado' });
    if (!podeGerirEvento(req, atual)) return res.status(403).json({ erro: 'Você só pode excluir eventos que você cadastrou.' });
    await Evento.deleteOne({ _id: atual._id });
    // Presenças JÁ validadas ficam (são histórico do aluno); as que ainda
    // esperavam decisão perdem o sentido e saem junto com os arquivos.
    const pendentes = await Presenca.find({ origem: 'local', evento: atual._id, status: { $ne: 'aprovada' } }).select('_id').lean();
    if (pendentes.length) {
      const ids = pendentes.map(p => p._id);
      await Comprovante.deleteMany({ presenca: { $in: ids } });
      await Presenca.deleteMany({ _id: { $in: ids } });
    }
    registrar(req, 'evento.excluir', atual.nome, { data: atual.data_inicio });
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
    const filtro = await filtroMinhasSolicitacoes(req);
    if (['pendente', 'aceito', 'recusado'].includes(req.query.status)) filtro.status = req.query.status;

    const lista = await Solicitacao.find(filtro)
      .populate('projeto', 'titulo tipo')
      .sort({ status: 1, createdAt: -1 })
      .lean();

    return res.json(lista.map(s => ({
      _id: s._id,
      origem: s.origem || 'local',
      matricula: s.matricula,
      nomeAluno: s.nomeAluno,
      status: s.status,
      criadoEm: s.createdAt,
      projetoTitulo: s.projeto?.titulo || s.projetoTitulo || '(projeto removido)',
      projetoTipo: s.projeto?.tipo || s.tipo || null,
    })));
  } catch (err) {
    console.error('Erro ao buscar solicitações:', err.message);
    return res.status(500).json({ erro: 'Erro ao buscar solicitações' });
  }
};

/** PUT /api/admin/solicitacoes/:id   body: { status: 'aceito' | 'recusado' | 'pendente' } */
const decidirSolicitacao = async (req, res) => {
  try {
    const { status } = req.body;
    if (!['aceito', 'recusado', 'pendente'].includes(status)) {
      return res.status(400).json({ erro: 'Status inválido' });
    }

    // Só decide solicitações dos SEUS projetos (desenvolvedor: todas)
    const filtro = await filtroMinhasSolicitacoes(req);
    const anterior = await Solicitacao.findOne({ _id: req.params.id, ...filtro }).lean();
    if (!anterior) return res.status(404).json({ erro: 'Solicitação não encontrada' });

    const sol = await Solicitacao.findByIdAndUpdate(
      req.params.id,
      { status, decididoEm: status === 'aceito' ? new Date() : null },
      { returnDocument: 'after', runValidators: true }
    );
    const mudou = anterior.status !== sol.status;

    // Gamificação + e-mail ao aluno + histórico — nada disso quebra a resposta
    try {
      if (sol.status === 'aceito') await conquistaEngine.processarProjetoAceito(sol);
      else await conquistaEngine.reverterProjetoAceito(sol);
    } catch (e) {
      console.error('Falha ao processar conquista de solicitação:', e.message);
    }
    if (mudou) {
      registrar(req, `solicitacao.${sol.status}`, `${sol.nomeAluno || sol.matricula} → ${sol.projetoTitulo || 'projeto'}`,
        { matricula: sol.matricula, de: anterior.status, para: sol.status });
      if (sol.status === 'aceito' || sol.status === 'recusado') {
        await notificarAluno(sol.matricula, 'solicitacao', { status: sol.status, projetoTitulo: sol.projetoTitulo || 'projeto' });
      }
    }

    return res.json({ sucesso: true, status: sol.status });
  } catch (err) {
    console.error('Erro ao decidir solicitação:', err.message);
    return res.status(500).json({ erro: 'Erro ao atualizar solicitação' });
  }
};

// ── Catálogo de projetos do SUAP (espelho local, somente leitura) ──

/** GET /api/admin/projetos-suap/:tipo  (professor: só onde ele é o coordenador) */
const getProjetosSuap = async (req, res) => {
  try {
    const { tipo } = req.params;
    if (tipo !== 'pesquisa' && tipo !== 'extensao') {
      return res.status(400).json({ erro: 'Tipo inválido' });
    }
    const filtro = { tipo };
    if (!ehDev(req)) {
      if (!req.admin.email) return res.json([]);
      filtro.email_coordenador = regexEmail(req.admin.email);
    }
    const lista = await ProjetoSuapCache.find(filtro).sort({ titulo: 1 }).lean();
    return res.json(lista);
  } catch (err) {
    console.error('Erro ao buscar projetos do SUAP:', err.message);
    return res.status(500).json({ erro: 'Erro ao buscar projetos do SUAP' });
  }
};

// ── Histórico (auditoria) — só desenvolvedor ───────────────────

/** GET /api/admin/historico?acao=&q=&pagina= */
const getHistorico = async (req, res) => {
  try {
    const POR_PAGINA = 50;
    const pagina = Math.max(1, parseInt(req.query.pagina, 10) || 1);
    const filtro = {};
    if (typeof req.query.acao === 'string' && /^[a-z]+$/.test(req.query.acao)) {
      filtro.acao = new RegExp(`^${req.query.acao}\\.`);
    }
    if (typeof req.query.q === 'string' && req.query.q.trim()) {
      const rx = new RegExp(escRegex(req.query.q.trim().slice(0, 80)), 'i');
      filtro.$or = [{ alvo: rx }, { adminNome: rx }, { adminEmail: rx }];
    }
    const [itens, total] = await Promise.all([
      Auditoria.find(filtro).sort({ createdAt: -1 }).skip((pagina - 1) * POR_PAGINA).limit(POR_PAGINA).lean(),
      Auditoria.countDocuments(filtro),
    ]);
    return res.json({ itens, total, pagina, paginas: Math.max(1, Math.ceil(total / POR_PAGINA)) });
  } catch (err) {
    console.error('Erro ao buscar histórico:', err.message);
    return res.status(500).json({ erro: 'Erro ao buscar histórico' });
  }
};

// ── Estatísticas para a coordenação ───────────────────────────

/** GET /api/admin/estatisticas — números do campus (todos os servidores veem) */
const getEstatisticas = async (req, res) => {
  try {
    const agora = new Date();
    const dias = (n) => new Date(agora.getTime() - n * 86400000);
    const inicio6m = new Date(agora.getFullYear(), agora.getMonth() - 5, 1);

    const [
      alunos, ativos7, ativos30, porCurso, evolucao, topProjetos, topConquistas, porStatus, totalConcessoes,
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ ultimoAcesso: { $gte: dias(7) } }),
      User.countDocuments({ ultimoAcesso: { $gte: dias(30) } }),
      User.aggregate([
        { $group: {
          _id: { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ['$curso', ''] } }, 0] }, '$curso', '(curso não informado)'] },
          alunos: { $sum: 1 },
          pontosMedios: { $avg: '$pontos' },
          comPontos: { $sum: { $cond: [{ $gt: ['$pontos', 0] }, 1, 0] } },
        } },
        { $sort: { alunos: -1 } },
        { $limit: 12 },
      ]),
      ConquistaUsuario.aggregate([
        { $match: { status: 'confirmada', createdAt: { $gte: inicio6m } } },
        { $group: {
          _id: { ano: { $year: { date: '$createdAt', timezone: 'America/Sao_Paulo' } }, mes: { $month: { date: '$createdAt', timezone: 'America/Sao_Paulo' } } },
          conquistas: { $sum: 1 },
          pontos: { $sum: '$pontos' },
        } },
      ]),
      Solicitacao.aggregate([
        { $group: {
          _id: { origem: '$origem', projeto: '$projeto', suap: '$projetoSuapId' },
          titulo: { $first: '$projetoTitulo' },
          tipo: { $first: '$tipo' },
          total: { $sum: 1 },
          aceitas: { $sum: { $cond: [{ $eq: ['$status', 'aceito'] }, 1, 0] } },
        } },
        { $sort: { total: -1 } },
        { $limit: 8 },
      ]),
      ConquistaUsuario.aggregate([
        { $match: { status: 'confirmada' } },
        { $group: { _id: '$conquista', nome: { $first: '$nomeConquista' }, total: { $sum: 1 } } },
        { $sort: { total: -1 } },
        { $limit: 8 },
      ]),
      Solicitacao.aggregate([{ $group: { _id: '$status', total: { $sum: 1 } } }]),
      ConquistaUsuario.countDocuments({ status: 'confirmada' }),
    ]);

    // Garante os 6 meses na ordem, mesmo os que ficaram zerados
    const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
    const meses = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(agora.getFullYear(), agora.getMonth() - 5 + i, 1);
      const achado = evolucao.find(e => e._id.ano === d.getFullYear() && e._id.mes === d.getMonth() + 1);
      return { rotulo: `${MESES[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`, conquistas: achado?.conquistas || 0, pontos: achado?.pontos || 0 };
    });

    return res.json({
      totais: {
        alunos, ativos7, ativos30, concessoes: totalConcessoes,
        solicitacoes: Object.fromEntries(porStatus.map(s => [s._id, s.total])),
      },
      porCurso: porCurso.map(c => ({ curso: c._id, alunos: c.alunos, pontosMedios: Math.round(c.pontosMedios || 0), comPontos: c.comPontos })),
      evolucao: meses,
      topProjetos: topProjetos.map(p => ({ titulo: p.titulo || '(projeto)', tipo: p.tipo, origem: p._id.origem, total: p.total, aceitas: p.aceitas })),
      topConquistas: topConquistas.map(c => ({ nome: c.nome || 'Conquista', total: c.total })),
    });
  } catch (err) {
    console.error('Erro ao montar estatísticas:', err.message);
    return res.status(500).json({ erro: 'Erro ao buscar estatísticas' });
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
  getHistorico,
  getEstatisticas,
  filtroMinhasSolicitacoes,
};
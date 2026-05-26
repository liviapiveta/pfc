const suapService = require('../services/suapService');

/**
 * GET /api/dados-pessoais
 */
const getDadosPessoais = async (req, res) => {
  try {
    const dados = await suapService.getMeusDados(req.user.suapToken);
    return res.json(dados);
  } catch (err) {
    return handleError(res, err, 'dados pessoais');
  }
};

/**
 * GET /api/periodos
 */
const getPeriodos = async (req, res) => {
  try {
    const periodos = await suapService.getMeusPeriodosLetivos(req.user.suapToken);
    return res.json(periodos);
  } catch (err) {
    return handleError(res, err, 'períodos letivos');
  }
};

/**
 * GET /api/boletim/:ano/:periodo
 */
const getBoletim = async (req, res) => {
  try {
    const { ano, periodo } = req.params;

    if (!ano || !periodo) {
      return res.status(400).json({ erro: 'Ano e período são obrigatórios' });
    }

    const boletim = await suapService.getBoletim(req.user.suapToken, ano, periodo);
    return res.json(boletim);
  } catch (err) {
    return handleError(res, err, 'boletim');
  }
};

/**
 * GET /api/projetos/pesquisa
 */
const getProjetosPesquisa = async (req, res) => {
  try {
    const projetos = await suapService.getProjetosPesquisa(req.user.suapToken);
    return res.json(projetos);
  } catch (err) {
    return handleError(res, err, 'projetos de pesquisa');
  }
};

/**
 * GET /api/projetos/extensao
 */
const getProjetosExtensao = async (req, res) => {
  try {
    const projetos = await suapService.getProjetosExtensao(req.user.suapToken);
    return res.json(projetos);
  } catch (err) {
    return handleError(res, err, 'projetos de extensão');
  }
};

/**
 * GET /api/calendario
 * Endpoint não disponível na API SUAP
 */
const getCalendario = async (req, res) => {
  return res.status(404).json({ erro: 'Endpoint de calendário não disponível na API SUAP' });
};

/**
 * PUT /api/preferencias
 */
const updatePreferencias = async (req, res) => {
  try {
    const { anoLetivoAtual, periodoLetivoAtual, temaEscuro } = req.body;
    const pref = req.user.preferencias || {};

    if (anoLetivoAtual !== undefined) pref.anoLetivoAtual = anoLetivoAtual;
    if (periodoLetivoAtual !== undefined) pref.periodoLetivoAtual = periodoLetivoAtual;
    if (temaEscuro !== undefined) pref.temaEscuro = temaEscuro;

    req.user.preferencias = pref;
    await req.user.save();

    return res.json({ sucesso: true, preferencias: pref });
  } catch (err) {
    return res.status(500).json({ erro: 'Erro ao salvar preferências' });
  }
};

const handleError = (res, err, contexto) => {
  console.error(`Erro ao buscar ${contexto}:`, err.message);
  const status = err.response?.status || 500;
  if (status === 401) {
    return res.status(401).json({ erro: 'Token SUAP expirado. Faça login novamente.' });
  }
  if (status === 404) {
    return res.status(404).json({ erro: `${contexto} não encontrado` });
  }
  return res.status(500).json({ erro: `Erro ao buscar ${contexto}` });
};

module.exports = {
  getDadosPessoais,
  getPeriodos,
  getBoletim,
  getProjetosPesquisa,
  getProjetosExtensao,
  getCalendario,
  updatePreferencias,
};
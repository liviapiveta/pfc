const suapService = require('../services/suapService');

const getDadosPessoais = async (req, res) => {
  try {
    return res.json(await suapService.getMeusDados(req.user.suapToken));
  } catch (err) { return handleError(res, err, 'dados pessoais'); }
};

const getPeriodos = async (req, res) => {
  try {
    return res.json(await suapService.getMeusPeriodosLetivos(req.user.suapToken));
  } catch (err) { return handleError(res, err, 'períodos letivos'); }
};

const getBoletim = async (req, res) => {
  try {
    const { ano, periodo } = req.params;
    if (!ano || !periodo)
      return res.status(400).json({ erro: 'Ano e período são obrigatórios' });
    return res.json(await suapService.getBoletim(req.user.suapToken, ano, periodo));
  } catch (err) { return handleError(res, err, 'boletim'); }
};

const getProjetosPesquisa = async (req, res) => {
  try {
    return res.json(await suapService.getProjetosPesquisa(req.user.suapToken));
  } catch (err) { return handleError(res, err, 'projetos de pesquisa'); }
};

const getProjetosExtensao = async (req, res) => {
  try {
    return res.json(await suapService.getProjetosExtensao(req.user.suapToken));
  } catch (err) { return handleError(res, err, 'projetos de extensão'); }
};

const getCalendario = async (req, res) => {
  try {
    return res.json(await suapService.getEventosDoCampus(req.user.suapToken));
  } catch (err) { return handleError(res, err, 'eventos'); }
};

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

/**
 * handleError — loga o erro real do SUAP e repassa status correto.
 *
 * Mapeamento de status HTTP do SUAP:
 *   401 → token de acesso expirado
 *   403 → sem permissão (pode ser "Host not in allowlist" se o servidor
 *          não estiver na whitelist do SUAP, ou token inválido)
 *   404 → recurso não existe para este aluno/período
 *   500 → erro interno do SUAP
 */
const handleError = (res, err, contexto) => {
  const status = err.response?.status;
  const body   = err.response?.data;

  console.error(
    `[SUAP] Erro ao buscar ${contexto} — HTTP ${status ?? 'sem resposta HTTP'}:`,
    JSON.stringify(body ?? err.message)
  );

  if (status === 401) {
    return res.status(401).json({ erro: 'Token SUAP expirado. Faça login novamente.' });
  }
  if (status === 403) {
    // "Host not in allowlist" = o IP do servidor não está liberado no SUAP
    const msg = typeof body === 'string' ? body : body?.detail ?? '';
    if (msg.toLowerCase().includes('allowlist') || msg.toLowerCase().includes('host')) {
      return res.status(403).json({
        erro: 'Acesso negado pelo SUAP: o IP deste servidor não está na lista de hosts permitidos. Contate o administrador do SUAP para liberar o IP.',
      });
    }
    return res.status(403).json({ erro: 'Acesso negado pelo SUAP.' });
  }
  if (status === 404) {
    return res.status(404).json({ erro: `${contexto} não encontrado` });
  }

  return res.status(500).json({
    erro: `Erro ao buscar ${contexto}`,
    detalhe: typeof body === 'string'
      ? body
      : body?.detail ?? body?.message ?? err.message,
  });
};

module.exports = {
  getDadosPessoais, getPeriodos, getBoletim,
  getProjetosPesquisa, getProjetosExtensao,
  getCalendario, updatePreferencias,
};
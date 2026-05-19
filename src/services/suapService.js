const axios = require('axios');
const NodeCache = require('node-cache');

const cache = new NodeCache({
  stdTTL: parseInt(process.env.CACHE_TTL) || 300,
});

const SUAP_BASE =
  process.env.SUAP_BASE_URL || 'https://suap.ifpr.edu.br/api';

/**
 * Cliente autenticado
 */
const suapClient = (token) =>
  axios.create({
    baseURL: SUAP_BASE,
    headers: {
      Authorization: `JWT ${token}`,
      'Content-Type': 'application/json',
    },
    timeout: 15000,
  });

/**
 * =========================
 * AUTH
 * =========================
 */

/**
 * Login SUAP
 */
const autenticar = async (matricula, senha) => {
  const { data } = await axios.post(`${SUAP_BASE}/token/pair`, {
    username: matricula,
    password: senha,
  });

  return {
    access: data.access,
    refresh: data.refresh,
  };
};

/**
 * Renovar token
 */
const refreshToken = async (refresh) => {
  const { data } = await axios.post(`${SUAP_BASE}/token/refresh`, {
    refresh,
  });

  return data.access;
};

/**
 * Verifica token
 */
const verifyToken = async (token) => {
  const { data } = await axios.post(`${SUAP_BASE}/token/verify`, {
    token,
  });

  return data;
};

/**
 * =========================
 * CACHE HELPERS
 * =========================
 */

const getCache = (key) => cache.get(key);

const setCache = (key, data) => {
  cache.set(key, data);
  return data;
};

const buildCacheKey = (prefix, token, extra = '') =>
  `${prefix}_${token.slice(-10)}_${extra}`;

/**
 * =========================
 * DADOS DO ALUNO
 * =========================
 */

/**
 * Dados pessoais do usuário
 * GET /api/rh/meus-dados/
 */
const getMeusDados = async (token) => {
  const cacheKey = buildCacheKey('meus_dados', token);

  const cached = getCache(cacheKey);
  if (cached) return cached;

  const client = suapClient(token);

  const { data } = await client.get('/rh/meus-dados/');

  return setCache(cacheKey, data);
};

/**
 * Dados acadêmicos do aluno
 * GET /api/ensino/meus-dados-aluno/
 */
const getMeusDadosAluno = async (token) => {
  const cacheKey = buildCacheKey('dados_aluno', token);

  const cached = getCache(cacheKey);
  if (cached) return cached;

  const client = suapClient(token);

  const { data } = await client.get('/ensino/meus-dados-aluno/');

  return setCache(cacheKey, data);
};

/**
 * =========================
 * ENSINO
 * =========================
 */

/**
 * Períodos letivos
 * GET /api/ensino/meus-periodos-letivos/
 */
const getMeusPeriodosLetivos = async (token) => {
  const cacheKey = buildCacheKey('periodos', token);

  const cached = getCache(cacheKey);
  if (cached) return cached;

  const client = suapClient(token);

  const { data } = await client.get(
    '/ensino/meus-periodos-letivos/'
  );

  return setCache(cacheKey, data.results || data);
};

/**
 * Boletim
 * GET /api/ensino/meu-boletim/{ano}/{periodo}/
 */
const getBoletim = async (
  token,
  anoLetivo,
  periodoLetivo
) => {
  const cacheKey = buildCacheKey(
    'boletim',
    token,
    `${anoLetivo}_${periodoLetivo}`
  );

  const cached = getCache(cacheKey);
  if (cached) return cached;

  const client = suapClient(token);

  const { data } = await client.get(
    `/ensino/meu-boletim/${anoLetivo}/${periodoLetivo}/`
  );

  return setCache(cacheKey, data.results || data);
};

/**
 * Próximas avaliações
 * GET /api/ensino/minhas-proximas-avaliacoes/
 */
const getProximasAvaliacoes = async (token) => {
  const cacheKey = buildCacheKey(
    'avaliacoes',
    token
  );

  const cached = getCache(cacheKey);
  if (cached) return cached;

  const client = suapClient(token);

  const { data } = await client.get(
    '/ensino/minhas-proximas-avaliacoes/'
  );

  return setCache(cacheKey, data.results || data);
};

/**
 * Turmas virtuais
 * GET /api/ensino/minhas-turmas-virtuais/{ano}/{periodo}/
 */
const getTurmasVirtuais = async (
  token,
  ano,
  periodo
) => {
  const cacheKey = buildCacheKey(
    'turmas',
    token,
    `${ano}_${periodo}`
  );

  const cached = getCache(cacheKey);
  if (cached) return cached;

  const client = suapClient(token);

  const { data } = await client.get(
    `/ensino/minhas-turmas-virtuais/${ano}/${periodo}/`
  );

  return setCache(cacheKey, data.results || data);
};

/**
 * Disciplinas
 * GET /api/ensino/disciplinas/{semestre}/
 */
const getDisciplinas = async (
  token,
  semestre
) => {
  const cacheKey = buildCacheKey(
    'disciplinas',
    token,
    semestre
  );

  const cached = getCache(cacheKey);
  if (cached) return cached;

  const client = suapClient(token);

  const { data } = await client.get(
    `/ensino/disciplinas/${semestre}/`
  );

  return setCache(cacheKey, data.results || data);
};

/**
 * Diários do semestre
 * GET /api/ensino/diarios/{semestre}/
 */
const getDiarios = async (
  token,
  semestre
) => {
  const cacheKey = buildCacheKey(
    'diarios',
    token,
    semestre
  );

  const cached = getCache(cacheKey);
  if (cached) return cached;

  const client = suapClient(token);

  const { data } = await client.get(
    `/ensino/diarios/${semestre}/`
  );

  return setCache(cacheKey, data.results || data);
};

/**
 * Materiais de um diário
 * GET /api/ensino/diarios/{id_diario}/materiais/
 */
const getMateriaisDiario = async (
  token,
  idDiario
) => {
  const cacheKey = buildCacheKey(
    'materiais',
    token,
    idDiario
  );

  const cached = getCache(cacheKey);
  if (cached) return cached;

  const client = suapClient(token);

  const { data } = await client.get(
    `/ensino/diarios/${idDiario}/materiais/`
  );

  return setCache(cacheKey, data.results || data);
};

/**
 * Mensagens
 * status:
 * - nao-lidas
 * - lidas
 * - todas
 * - lixeira
 */
const getMensagens = async (
  token,
  status = 'nao-lidas'
) => {
  const cacheKey = buildCacheKey(
    'mensagens',
    token,
    status
  );

  const cached = getCache(cacheKey);
  if (cached) return cached;

  const client = suapClient(token);

  const { data } = await client.get(
    `/ensino/mensagens/entrada/${status}/`
  );

  return setCache(cacheKey, data.results || data);
};

/**
 * =========================
 * CACHE
 * =========================
 */

const limparCache = (token) => {
  const suffix = token.slice(-10);

  const keys = cache
    .keys()
    .filter((k) => k.includes(suffix));

  keys.forEach((k) => cache.del(k));
};

module.exports = {
  autenticar,
  refreshToken,
  verifyToken,

  getMeusDados,
  getMeusDadosAluno,

  getMeusPeriodosLetivos,
  getBoletim,
  getProximasAvaliacoes,
  getTurmasVirtuais,
  getDisciplinas,
  getDiarios,
  getMateriaisDiario,
  getMensagens,

  limparCache,
};
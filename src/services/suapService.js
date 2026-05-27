const axios = require('axios');
const NodeCache = require('node-cache');

const cache = new NodeCache({
  stdTTL: parseInt(process.env.CACHE_TTL) || 300,
});

// SUAP_BASE_URL deve ser a URL base SEM trailing slash, ex: https://suap.ifpr.edu.br/api
// O suapClient adiciona trailing slash para garantir resolução correta dos paths relativos.
const SUAP_BASE_URL =
  process.env.SUAP_BASE_URL || 'https://suap.ifpr.edu.br/api';

// Garante trailing slash: axios só resolve paths relativos corretamente
// quando o baseURL termina com '/'. Sem isso, client.get('ensino/boletim/')
// com baseURL='https://.../api' resulta em 'https://.../ensino/boletim/' (perde /api).
const SUAP_BASE = SUAP_BASE_URL.endsWith('/')
  ? SUAP_BASE_URL
  : SUAP_BASE_URL + '/';

/**
 * Cliente axios autenticado.
 * IMPORTANTE: todos os paths passados para .get()/.post() devem ser
 * RELATIVOS (sem '/' inicial), ex: 'ensino/meu-boletim/2024/1/'
 */
const suapClient = (token) =>
  axios.create({
    baseURL: SUAP_BASE,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    timeout: 15000,
  });

// ── AUTH ──────────────────────────────────────────────────────

const autenticar = async (matricula, senha) => {
  const { data } = await axios.post(`${SUAP_BASE}token/pair`, {
    username: matricula,
    password: senha,
  });
  return { access: data.access, refresh: data.refresh };
};

const refreshToken = async (refresh) => {
  const { data } = await axios.post(`${SUAP_BASE}token/refresh`, {
    refresh,
  });
  return data.access;
};

const verifyToken = async (token) => {
  const { data } = await axios.post(`${SUAP_BASE}token/verify`, { token });
  return data;
};

// ── CACHE ─────────────────────────────────────────────────────

const getCache = (key) => cache.get(key);
const setCache = (key, data) => { cache.set(key, data); return data; };
const buildCacheKey = (prefix, token, extra = '') =>
  `${prefix}_${token.slice(-10)}_${extra}`;

// ── DADOS ─────────────────────────────────────────────────────

const getMeusDados = async (token) => {
  const key = buildCacheKey('meus_dados', token);
  const cached = getCache(key);
  if (cached) return cached;
  const { data } = await suapClient(token).get('rh/meus-dados/');
  return setCache(key, data);
};

const getMeusDadosAluno = async (token) => {
  const key = buildCacheKey('dados_aluno', token);
  const cached = getCache(key);
  if (cached) return cached;
  const { data } = await suapClient(token).get('ensino/meus-dados-aluno/');
  return setCache(key, data);
};

const getMeusPeriodosLetivos = async (token) => {
  const key = buildCacheKey('periodos', token);
  const cached = getCache(key);
  if (cached) return cached;
  const { data } = await suapClient(token).get('ensino/meus-periodos-letivos/');
  return setCache(key, data.results ?? data);
};

const getBoletim = async (token, anoLetivo, periodoLetivo) => {
  const ano = parseInt(anoLetivo, 10);
  const periodo = parseInt(periodoLetivo, 10);
  const key = buildCacheKey('boletim_v2', token, `${ano}_${periodo}`);
  const cached = getCache(key);
  if (cached) return cached;

  const response = await suapClient(token).get(
    `ensino/meu-boletim/${ano}/${periodo}/`,
    // Aceita qualquer status para inspecionar a resposta manualmente
    { validateStatus: () => true }
  );

  // O SUAP às vezes retorna HTML de erro 500 em vez de JSON
  // (ex: período sem disciplinas, bug interno do SUAP)
  const contentType = response.headers?.['content-type'] ?? '';
  if (!contentType.includes('application/json')) {
    return setCache(key, await getBoletimPorDisciplinas(token, ano, periodo));
  }

  if (response.status === 401 || response.status === 403) {
    const err = new Error(`HTTP ${response.status}`);
    err.response = { status: response.status, data: response.data };
    throw err;
  }

  if (response.status >= 400) {
    return setCache(key, await getBoletimPorDisciplinas(token, ano, periodo));
  }

  const data = response.data;
  const result = data.results ?? data;
  const boletim = Array.isArray(result)
    ? result.map((item) => ({ ...item, _fonte: 'boletim' }))
    : [];
  if (!boletim.length) {
    return setCache(key, await getBoletimPorDisciplinas(token, ano, periodo));
  }
  return setCache(key, boletim);
};

/**
 * Helpers legados do antigo fallback por disciplinas.
 * O fluxo atual do boletim usa somente /api/ensino/meu-boletim/{ano}/{periodo}/.
 */
const _normalizarTexto = (valor) =>
  String(valor ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// Extrai nota de uma etapa específica de notas[] ou medias[]
const _extrairEtapa = (notas, medias, num) => {
  const padroes = new Set([
    `etapa ${num}`, `etapa${num}`, `etapa 0${num}`,
    `e${num}`, `n${num}`, `nota ${num}`, `nota${num}`,
    `${num} etapa`, `${num} bimestre`, `${num} bim`,
    `${num}o bimestre`, `${num}a etapa`,
  ]);
  const todos = [...notas, ...medias];
  const porTipo = todos.find((x) => {
    const tipo = _normalizarTexto(x.tipo)
      .replace(/[ªº°]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
    const compacto = tipo.replace(/\s+/g, '');

    return padroes.has(tipo)
      || padroes.has(compacto)
      || new RegExp(`(^|\\D)${num}(\\D|$)`).test(tipo);
  });

  const porOrdem = notas[num - 1] ?? medias[num - 1];
  return { nota: porTipo?.nota ?? porOrdem?.nota ?? null, faltas: null };
};

// Extrai média de um tipo específico de medias[]
const _extrairMedia = (medias, tipo) => {
  if (tipo === 'media_final') {
    const item = medias.find(x => /final|mf|média final/i.test(x.tipo))
              ?? medias[medias.length - 1];
    return item?.nota ?? null;
  }
  if (tipo === 'media_etapas') {
    const item = medias.find(x => /média.*(etapa|parcial)|media.*etapa/i.test(x.tipo));
    return item?.nota ?? null;
  }
  if (tipo === 'final_prova') {
    const item = medias.find(x => /prova.*final|avalia.*final|af/i.test(x.tipo));
    return item?.nota ?? null;
  }
  return null;
};


const normalizarDisciplinaParaBoletim = (d) => ({
  codigo_diario: d.id ? String(d.id) : null,
  disciplina: d.descricao || d.sigla || '—',

  situacao: typeof d.situacao === 'object'
    ? (d.situacao?.rotulo ?? '—')
    : (d.situacao || '—'),
  _situacao_status: typeof d.situacao === 'object'
    ? (d.situacao?.status ?? '')
    : '',

  carga_horaria:          d.ch_total_aula     ?? 0,
  carga_horaria_relogio:  d.ch_total_relogio  ?? 0,
  carga_horaria_cumprida: d.ch_cumprida_aula  ?? 0,
  numero_faltas:          d.qtd_faltas        ?? 0,
  quantidade_avaliacoes:  d.qtd_avaliacoes    ?? 0,
  percentual_carga_horaria_frequentada: d.frequencia ?? 0,

  notas:  d.notas  ?? [],
  medias: d.medias ?? [],

  nota_etapa_1: _extrairEtapa(d.notas ?? [], d.medias ?? [], 1),
  nota_etapa_2: _extrairEtapa(d.notas ?? [], d.medias ?? [], 2),
  nota_etapa_3: _extrairEtapa(d.notas ?? [], d.medias ?? [], 3),
  nota_etapa_4: _extrairEtapa(d.notas ?? [], d.medias ?? [], 4),
  media_disciplina:       _extrairMedia(d.medias ?? [], 'media_etapas'),
  nota_avaliacao_final:   { nota: _extrairMedia(d.medias ?? [], 'final_prova'), faltas: null },
  media_final_disciplina: _extrairMedia(d.medias ?? [], 'media_final'),

  _fonte: 'disciplinas',
});

const getFaltasPorEtapa = async (token, idDiario) => {
  if (!idDiario) return {};

  const faltas = {};
  let page = 1;
  let hasNext = true;

  while (hasNext && page <= 20) {
    const resp = await suapClient(token).get(
      `ensino/diarios/${idDiario}/aulas/?page=${page}`,
      { validateStatus: () => true }
    );

    const contentType = resp.headers?.['content-type'] ?? '';
    if (resp.status >= 400 || !contentType.includes('application/json')) {
      return faltas;
    }

    const aulas = resp.data?.results ?? resp.data ?? [];
    if (!Array.isArray(aulas)) return faltas;

    aulas.forEach((aula) => {
      const etapa = parseInt(String(aula.etapa ?? '').match(/\d+/)?.[0], 10);
      if (!etapa) return;
      faltas[etapa] = (faltas[etapa] ?? 0) + (Number(aula.faltas) || 0);
    });

    hasNext = Boolean(resp.data?.next);
    page += 1;
  }

  return faltas;
};

const getBoletimPorDisciplinas = async (token, ano, periodo) => {
  const semestre = `${ano}.${periodo}`;
  const respDisc = await suapClient(token).get(
    `ensino/disciplinas/${semestre}/`,
    { validateStatus: () => true }
  );

  if (respDisc.status === 401 || respDisc.status === 403) {
    const err = new Error(`HTTP ${respDisc.status}`);
    err.response = { status: respDisc.status, data: respDisc.data };
    throw err;
  }

  const ctDisc = respDisc.headers?.['content-type'] ?? '';
  if (respDisc.status >= 400 || !ctDisc.includes('application/json')) {
    return [];
  }

  const disciplinas = respDisc.data?.results ?? respDisc.data ?? [];
  if (!Array.isArray(disciplinas) || !disciplinas.length) return [];

  return Promise.all(disciplinas.map(async (disciplina) => {
    const item = normalizarDisciplinaParaBoletim(disciplina);
    const faltasPorEtapa = await getFaltasPorEtapa(token, item.codigo_diario);

    [1, 2, 3, 4].forEach((etapa) => {
      const campo = `nota_etapa_${etapa}`;
      item[campo] = {
        ...(item[campo] ?? {}),
        faltas: item[campo]?.faltas ?? faltasPorEtapa[etapa] ?? null,
      };
    });

    return item;
  }));
};

const getBoletimComFallback = getBoletim;


const getProximasAvaliacoes = async (token) => {
  const key = buildCacheKey('avaliacoes', token);
  const cached = getCache(key);
  if (cached) return cached;
  const { data } = await suapClient(token).get('ensino/minhas-proximas-avaliacoes/');
  return setCache(key, data.results ?? data);
};

const getTurmasVirtuais = async (token, ano, periodo) => {
  const key = buildCacheKey('turmas', token, `${ano}_${periodo}`);
  const cached = getCache(key);
  if (cached) return cached;
  const { data } = await suapClient(token).get(
    `ensino/minhas-turmas-virtuais/${ano}/${periodo}/`
  );
  return setCache(key, data.results ?? data);
};

const getDisciplinas = async (token, semestre) => {
  const key = buildCacheKey('disciplinas', token, semestre);
  const cached = getCache(key);
  if (cached) return cached;
  const { data } = await suapClient(token).get(`ensino/disciplinas/${semestre}/`);
  return setCache(key, data.results ?? data);
};

const getDiarios = async (token, semestre) => {
  const key = buildCacheKey('diarios', token, semestre);
  const cached = getCache(key);
  if (cached) return cached;
  const { data } = await suapClient(token).get(`ensino/diarios/${semestre}/`);
  return setCache(key, data.results ?? data);
};

const getMateriaisDiario = async (token, idDiario) => {
  const key = buildCacheKey('materiais', token, idDiario);
  const cached = getCache(key);
  if (cached) return cached;
  const { data } = await suapClient(token).get(
    `ensino/diarios/${idDiario}/materiais/`
  );
  return setCache(key, data.results ?? data);
};

const getProjetosPesquisa = async (token) => {
  const key = buildCacheKey('projetos_pesquisa', token);
  const cached = getCache(key);
  if (cached) return cached;
  const { data } = await suapClient(token).get('pesquisa/projetos/');
  return setCache(key, data.results ?? data);
};

const getProjetosExtensao = async (token) => {
  const key = buildCacheKey('projetos_extensao', token);
  const cached = getCache(key);
  if (cached) return cached;
  const { data } = await suapClient(token).get('extensao/projetos/');
  return setCache(key, data.results ?? data);
};

const getMensagens = async (token, status = 'nao-lidas') => {
  const key = buildCacheKey('mensagens', token, status);
  const cached = getCache(key);
  if (cached) return cached;
  const { data } = await suapClient(token).get(
    `ensino/mensagens/entrada/${status}/`
  );
  return setCache(key, data.results ?? data);
};

const limparCache = (token) => {
  const suffix = token.slice(-10);
  cache.keys().filter((k) => k.includes(suffix)).forEach((k) => cache.del(k));
};

module.exports = {
  autenticar, refreshToken, verifyToken,
  getMeusDados, getMeusDadosAluno,
  getMeusPeriodosLetivos, getBoletim, getBoletimComFallback, getProximasAvaliacoes,
  getTurmasVirtuais, getDisciplinas, getDiarios, getMateriaisDiario,
  getMensagens, getProjetosPesquisa, getProjetosExtensao,
  limparCache,
};

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

// ── PROJETOS DO ALUNO ─────────────────────────────────────────
//
// IMPORTANTE: os endpoints 'pesquisa/projetos/' e 'extensao/projetos/'
// do SUAP retornam TODOS os projetos da instituição (não só os do aluno).
// O schema documentado (ProjetoSchema) não traz lista de participantes —
// só o coordenador. Portanto, para filtrar "os projetos em que o aluno
// está", dependemos de a resposta REAL trazer algum dado de participantes
// (matrícula/CPF do aluno), que pode não estar documentado.
//
// A estratégia abaixo é robusta: procura os identificadores do aluno
// (matrícula e CPF) em QUALQUER lugar dentro do objeto do projeto, sem
// depender do nome exato do campo. Se a resposta não contiver nenhum
// dado de participante, o filtro retorna lista vazia e registra um aviso
// no log — sinal de que a API não expõe essa informação.

// Extrai identificadores únicos do aluno a partir de /rh/meus-dados/.
// Inclui matrícula, CPF, nome e e-mails — porque não sabemos por qual
// desses campos a API lista os participantes de um projeto.
const _identificadoresAluno = (dados) => {
  const ids = { textos: new Set(), digitos: new Set() };

  const addTexto = (v) => {
    const s = String(v ?? '').trim().toLowerCase();
    if (s.length >= 5) ids.textos.add(s); // evita casar pedaços curtos
  };
  const addDigitos = (v) => {
    const s = String(v ?? '').replace(/\D/g, '');
    if (s.length >= 6) ids.digitos.add(s); // matrícula/CPF têm muitos dígitos
  };

  // Matrícula (pode vir em campos diferentes dependendo do endpoint)
  addTexto(dados?.matricula);
  addTexto(dados?.identificacao);
  addTexto(dados?.vinculo?.matricula);
  addDigitos(dados?.matricula);
  addDigitos(dados?.identificacao);
  addDigitos(dados?.vinculo?.matricula);
  addDigitos(dados?.cpf);

  // Nome (caso os participantes sejam listados por nome)
  addTexto(dados?.nome);
  addTexto(dados?.nome_usual);
  addTexto(dados?.nome_registro);

  // E-mails — identificadores únicos e muito prováveis de aparecer
  addTexto(dados?.email);
  addTexto(dados?.email_academico);
  addTexto(dados?.email_google_classroom);
  addTexto(dados?.email_secundario);
  addTexto(dados?.email_preferencial);

  return ids;
};

// Verifica se os identificadores do aluno aparecem dentro do projeto.
// Faz uma busca no objeto inteiro serializado, então funciona mesmo que
// os participantes estejam aninhados em campos não documentados.
const _projetoPertenceAoAluno = (projeto, ids) => {
  let blob;
  try {
    blob = JSON.stringify(projeto).toLowerCase();
  } catch {
    return false;
  }

  // Casa matrícula como texto literal (ex.: "matricula":"2023001234")
  for (const t of ids.textos) {
    if (blob.includes(t)) return true;
  }

  // Casa matrícula/CPF comparando apenas os dígitos (ignora formatação)
  if (ids.digitos.size) {
    const blobDigitos = blob.replace(/\D/g, '');
    for (const d of ids.digitos) {
      if (blobDigitos.includes(d)) return true;
    }
  }

  return false;
};

// ── CAMPUS DO ALUNO ───────────────────────────────────────────
// Extrai o(s) identificador(es) de campus do aluno (sigla e/ou nome),
// normalizados, a partir de /rh/meus-dados/.
const _campusDoAluno = (dados) => {
  const tokens = new Set();
  const add = (v) => {
    const s = _normalizarTexto(v).trim();
    if (s) tokens.add(s);
  };
  add(dados?.campus);
  add(dados?.vinculo?.campus);
  add(dados?.campus_sigla);
  return tokens;
};

// Verifica se um item (projeto/evento) pertence ao campus do aluno.
// camposItem: lista de strings de campus do item (sigla, nome, etc.).
// - Siglas curtas (< 5 chars) só casam por igualdade exata (evita falso
//   positivo do tipo "ast" dentro de "castanhal").
// - Nomes longos casam por conter um ao outro.
// - Se o aluno não tem campus identificado, ou o item não tem campus,
//   não exclui (retorna true) para não esconder itens indevidamente.
const _itemNoCampusDoAluno = (camposItem, tokensAluno) => {
  if (!tokensAluno.size) return true;
  const itens = (camposItem || [])
    .map(_normalizarTexto)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!itens.length) return true;

  const casa = (a, b) => {
    if (!a || !b) return false;
    if (a === b) return true;
    if (a.length >= 5 && b.includes(a)) return true;
    if (b.length >= 5 && a.includes(b)) return true;
    return false;
  };

  for (const al of tokensAluno)
    for (const it of itens)
      if (casa(al, it)) return true;
  return false;
};

// Busca todos os projetos de um caminho e filtra só os do aluno logado.
const _getMeusProjetos = async (token, path, cachePrefix) => {
  const key = buildCacheKey(cachePrefix, token);
  const cached = getCache(key);
  if (cached) return cached;

  const { data } = await suapClient(token).get(path);
  const todos = data.results ?? data ?? [];

  if (!Array.isArray(todos) || !todos.length) {
    return setCache(key, []);
  }

  // Identidade do aluno (cacheada internamente por getMeusDados)
  let dadosAluno;
  try {
    dadosAluno = await getMeusDados(token);
  } catch (err) {
    console.warn(`[${cachePrefix}] Não foi possível obter dados do aluno para filtrar:`, err.message);
    return setCache(key, todos); // sem identidade, melhor mostrar tudo do que quebrar
  }

  // 1) Restringe ao campus do aluno
  const tokensCampus = _campusDoAluno(dadosAluno);
  const noCampus = tokensCampus.size
    ? todos.filter((p) =>
        _itemNoCampusDoAluno(
          [p.campus_sigla, p.campus_nome, p.campus_nome_formatado],
          tokensCampus
        )
      )
    : todos;

  // 2) Dentro do campus, tenta restringir aos projetos em que o aluno participa
  const ids = _identificadoresAluno(dadosAluno);
  const meus = noCampus.filter((p) => _projetoPertenceAoAluno(p, ids));

  if (meus.length) {
    // Achou os projetos do aluno → mostra só os dele.
    return setCache(key, meus);
  }

  // Nenhum projeto casou por participante. Quase sempre significa que a
  // resposta da API NÃO traz dados de participantes (só coordenador).
  // Mostra então os projetos do CAMPUS do aluno (não de todos os campi).
  return setCache(key, noCampus);
};

const getProjetosPesquisa = (token) =>
  _getMeusProjetos(token, 'pesquisa/projetos/', 'meus_projetos_pesquisa');

const getProjetosExtensao = (token) =>
  _getMeusProjetos(token, 'extensao/projetos/', 'meus_projetos_extensao');

// ── EVENTOS / CALENDÁRIO ──────────────────────────────────────
// Não existe endpoint de "calendário acadêmico" (datas de semestre/feriados)
// na API SUAP. O que existe é a lista de eventos institucionais ativos e
// deferidos, em 'midia/eventos/ativos-deferidos/'. Buscamos todas as páginas.
const getEventos = async (token) => {
  const key = buildCacheKey('eventos', token);
  const cached = getCache(key);
  if (cached) return cached;

  const eventos = [];
  let page = 1;
  let hasNext = true;

  while (hasNext && page <= 20) {
    const resp = await suapClient(token).get(
      `midia/eventos/ativos-deferidos/?page=${page}`,
      { validateStatus: () => true }
    );

    if (resp.status >= 400) {
      // 401/403 sobem como erro para o handleError do controller tratar
      if (resp.status === 401 || resp.status === 403) {
        const err = new Error(`HTTP ${resp.status}`);
        err.response = { status: resp.status, data: resp.data };
        throw err;
      }
      break;
    }

    const lote = resp.data?.results ?? resp.data ?? [];
    if (Array.isArray(lote)) eventos.push(...lote);

    hasNext = Boolean(resp.data?.next);
    page += 1;
  }

  return setCache(key, eventos);
};

// Eventos filtrados pelo campus do aluno (não exibe eventos de outros campi).
// Eventos sem campus definido são mantidos (podem ser institucionais/gerais).
const getEventosDoCampus = async (token) => {
  const eventos = await getEventos(token);
  if (!Array.isArray(eventos) || !eventos.length) return eventos ?? [];

  let dados;
  try {
    dados = await getMeusDados(token);
  } catch {
    return eventos; // sem identidade, não filtra
  }

  const tokensCampus = _campusDoAluno(dados);
  if (!tokensCampus.size) return eventos;

  return eventos.filter((ev) => _itemNoCampusDoAluno([ev.campus], tokensCampus));
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
  getEventos, getEventosDoCampus,
  limparCache,
};
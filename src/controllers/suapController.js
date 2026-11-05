const suapService = require('../services/suapService');
const User = require('../models/User');
const Projeto = require('../models/Projeto');
const Evento = require('../models/Evento');
const Solicitacao = require('../models/Solicitacao');
const ProjetoSuapCache = require('../models/ProjetoSuapCache');
const conquistaEngine = require('../services/conquistaEngine');

const linkProjetoSuap = (p = {}) =>
  p.link_suap || p.url_publica || p.pagina || p.link_projeto || p.link || p.url || null;

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

    const boletim = await suapService.getBoletim(req.user.suapToken, ano, periodo);

    // Gatilho de gamificação: concede conquistas automáticas de nota
    // (ex.: "Primeiro conceito A"). Nunca quebra a resposta do boletim.
    try {
      await conquistaEngine.processarBoletim(req.user.matricula, boletim, {
        ano: Number(ano),
        periodo: Number(periodo),
      });
    } catch (e) {
      console.error('Falha ao processar conquista de boletim:', e.message);
    }

    return res.json(boletim);
  } catch (err) { return handleError(res, err, 'boletim'); }
};

const getProjetosPesquisa = (req, res) =>
  _listarProjetosSuap(req, res, 'pesquisa', suapService.getProjetosPesquisa);

const getProjetosExtensao = (req, res) =>
  _listarProjetosSuap(req, res, 'extensao', suapService.getProjetosExtensao);

const getCalendario = async (req, res) => {
  try {
    // Se o SUAP falhar, ainda mostramos os eventos cadastrados no painel
    // (antes, qualquer erro do SUAP fazia o calendário inteiro dar 500).
    const [suap, eventosLocais] = await Promise.all([
      suapService.getEventosDoCampus(req.user.suapToken).then(
        (v) => ({ ok: true, v }),
        (e) => { console.warn('Calendário: SUAP indisponível:', e.response?.status || e.message); return { ok: false, v: [] }; }
      ),
      Evento.find().sort({ data_inicio: 1 }).lean(),
    ]);
    const eventosSuap = suap.v;

    return res.json([
      ...(Array.isArray(eventosSuap) ? eventosSuap : []),
      ...eventosLocais.map(ev => ({ ...ev, origem: 'admin' })),
    ]);
  } catch (err) { return handleError(res, err, 'eventos'); }
};

/**
 * PUT /api/preferencias — { notificarEmail?: boolean, privacidadeRanking?: 'nome'|'anonimo'|'oculto' }
 * (tema/acessibilidade ficam só no navegador — ver portal.js)
 */
const updatePreferencias = async (req, res) => {
  try {
    const { notificarEmail, privacidadeRanking } = req.body || {};
    const dados = {};
    if (notificarEmail !== undefined) {
      if (typeof notificarEmail !== 'boolean') return res.status(400).json({ erro: 'notificarEmail deve ser verdadeiro ou falso' });
      dados.notificarEmail = notificarEmail;
    }
    if (privacidadeRanking !== undefined) {
      if (!['nome', 'anonimo', 'oculto'].includes(privacidadeRanking)) return res.status(400).json({ erro: 'Opção de privacidade inválida' });
      dados.privacidadeRanking = privacidadeRanking;
    }
    if (!Object.keys(dados).length) return res.status(400).json({ erro: 'Nada para salvar' });
    await User.updateOne({ _id: req.user._id }, { $set: dados });
    return res.json({ sucesso: true, ...dados });
  } catch (err) {
    return res.status(500).json({ erro: 'Erro ao salvar preferências' });
  }
};

// ── Projetos internos (criados pela administração) ─────────────

/**
 * GET /api/projetos-internos/:tipo   (tipo = pesquisa | extensao)
 * Lista os projetos locais daquele tipo, anotando o status da
 * solicitação do aluno logado em cada um (meuStatus).
 */
const getProjetosInternos = async (req, res) => {
  try {
    const { tipo } = req.params;
    if (tipo !== 'pesquisa' && tipo !== 'extensao') {
      return res.status(400).json({ erro: 'Tipo inválido' });
    }

    const projetos = await Projeto.find({ tipo }).sort({ createdAt: -1 }).lean();

    const matricula = req.user.matricula;
    const minhas = await Solicitacao.find({
      matricula,
      projeto: { $in: projetos.map(p => p._id) },
    }).lean();

    const statusPorProjeto = {};
    minhas.forEach(s => { statusPorProjeto[String(s.projeto)] = s.status; });

    const resultado = projetos.map(p => ({
      ...p,
      meuStatus: statusPorProjeto[String(p._id)] || null,
    }));

    return res.json(resultado);
  } catch (err) {
    console.error('Erro ao listar projetos internos:', err.message);
    return res.status(500).json({ erro: 'Erro ao listar projetos' });
  }
};

/**
 * POST /api/projetos-internos/:id/solicitar
 * Cria (ou retorna) a solicitação de participação do aluno logado.
 */
const solicitarParticipacao = async (req, res) => {
  try {
    const projeto = await Projeto.findById(req.params.id);
    if (!projeto) return res.status(404).json({ erro: 'Projeto não encontrado' });

    const matricula = req.user.matricula;

    const jaExiste = await Solicitacao.findOne({ projeto: projeto._id, matricula });
    if (jaExiste) {
      return res.status(200).json({ sucesso: true, status: jaExiste.status, jaSolicitado: true });
    }

    const solicitacao = await Solicitacao.create({
      origem: 'local',
      projeto: projeto._id,
      projetoTitulo: projeto.titulo || '',
      tipo: projeto.tipo,
      matricula,
      nomeAluno: req.user.nomeUsuario || '',
      status: 'pendente',
    });

    return res.status(201).json({ sucesso: true, status: solicitacao.status });
  } catch (err) {
    // Violação do índice único (corrida de requisições) → trata como já solicitado
    if (err.code === 11000) {
      return res.status(200).json({ sucesso: true, status: 'pendente', jaSolicitado: true });
    }
    console.error('Erro ao solicitar participação:', err.message);
    return res.status(500).json({ erro: 'Erro ao enviar solicitação' });
  }
};

// ── Projetos do SUAP: cache + status de participação ──────────

/**
 * Lista os projetos do SUAP do tipo informado, atualiza o espelho local
 * (para o admin) e anota o status da solicitação do aluno em cada projeto.
 */
const _listarProjetosSuap = async (req, res, tipo, fetchFn) => {
  try {
    const projetos = (await fetchFn(req.user.suapToken)) || [];

    // Atualiza o espelho local — em segundo plano, sem travar a resposta.
    Promise.all(
      projetos
        .filter(p => p && p.id != null)
        .map(p => ProjetoSuapCache.updateOne(
          { suapId: p.id, tipo },
          {
            suapId: p.id,
            tipo,
            titulo: p.titulo || '',
            resumo: p.resumo || '',
            situacao: p.situacao || '',
            dt_inicio: p.dt_inicio || null,
            dt_final: p.dt_final || null,
            coordenador: p.nome_coordenador || '',
            email_coordenador: p.email_coordenador || '',
            campus_nome: p.campus_nome_formatado || p.campus_nome || '',
            link_suap: linkProjetoSuap(p),
          },
          { upsert: true }
        ))
    ).catch(err => console.warn('Falha ao atualizar cache SUAP:', err.message));

    // Anota o status da solicitação do aluno logado em cada projeto
    const ids = projetos.map(p => p?.id).filter(v => v != null);
    const minhas = await Solicitacao.find({
      origem: 'suap',
      matricula: req.user.matricula,
      projetoSuapId: { $in: ids },
    }).lean();

    const statusPorId = {};
    minhas.forEach(s => { statusPorId[s.projetoSuapId] = s.status; });

    const resultado = projetos.map(p => ({
      ...p,
      link_suap: linkProjetoSuap(p),
      meuStatus: (p && p.id != null) ? (statusPorId[p.id] || null) : null,
    }));

    return res.json(resultado);
  } catch (err) {
    return handleError(res, err, `projetos de ${tipo}`);
  }
};

/**
 * POST /api/projetos-suap/:suapId/solicitar   body: { tipo }
 * Cria a solicitação de participação em um projeto do SUAP.
 */
const solicitarParticipacaoSuap = async (req, res) => {
  try {
    const suapId = Number(req.params.suapId);
    const { tipo } = req.body;

    if (!Number.isFinite(suapId)) {
      return res.status(400).json({ erro: 'Projeto inválido' });
    }
    if (tipo !== 'pesquisa' && tipo !== 'extensao') {
      return res.status(400).json({ erro: 'Tipo inválido' });
    }

    const matricula = req.user.matricula;

    const jaExiste = await Solicitacao.findOne({ origem: 'suap', projetoSuapId: suapId, matricula });
    if (jaExiste) {
      return res.status(200).json({ sucesso: true, status: jaExiste.status, jaSolicitado: true });
    }

    // Título vindo do espelho local (se algum aluno já carregou o projeto)
    const cache = await ProjetoSuapCache.findOne({ suapId, tipo }).lean();
    const titulo = String(cache?.titulo || req.body.titulo || '(projeto do SUAP)').slice(0, 300);

    const solicitacao = await Solicitacao.create({
      origem: 'suap',
      projetoSuapId: suapId,
      projetoTitulo: titulo,
      tipo,
      matricula,
      nomeAluno: req.user.nomeUsuario || '',
      status: 'pendente',
    });

    return res.status(201).json({ sucesso: true, status: solicitacao.status });
  } catch (err) {
    console.error('Erro ao solicitar participação (SUAP):', err.message);
    return res.status(500).json({ erro: 'Erro ao enviar solicitação' });
  }
};

/**
 * DELETE /api/projetos-internos/:id/solicitacao
 * Cancela a solicitação enquanto está PENDENTE (o aluno desistiu) ou
 * RECUSADA (para solicitar de novo). Nunca apaga uma ACEITA (participação efetiva).
 */
const cancelarSolicitacao = async (req, res) => {
  try {
    await Solicitacao.findOneAndDelete({
      origem: 'local',
      projeto: req.params.id,
      matricula: req.user.matricula,
      status: { $in: ['pendente', 'recusado'] },
    });
    return res.json({ sucesso: true });
  } catch (err) {
    console.error('Erro ao cancelar solicitação:', err.message);
    return res.status(500).json({ erro: 'Erro ao cancelar solicitação' });
  }
};

/** DELETE /api/projetos-suap/:suapId/solicitacao */
const cancelarSolicitacaoSuap = async (req, res) => {
  try {
    await Solicitacao.findOneAndDelete({
      origem: 'suap',
      projetoSuapId: Number(req.params.suapId),
      matricula: req.user.matricula,
      status: { $in: ['pendente', 'recusado'] },
    });
    return res.json({ sucesso: true });
  } catch (err) {
    console.error('Erro ao cancelar solicitação (SUAP):', err.message);
    return res.status(500).json({ erro: 'Erro ao cancelar solicitação' });
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
    // A sessão do SUAP morreu: derruba também a sessão do IFPlenus. Sem isso
    // o portal ia para /login, o servidor via o cookie ainda válido e mandava
    // de volta para / — um loop de redirecionamento infinito.
    res.clearCookie('authToken');
    return res.status(401).json({ erro: 'Sua sessão do SUAP expirou. Faça login novamente.' });
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

  // Falha do SUAP (fora do ar, timeout, erro interno) → 502, sem repassar
  // o HTML/mensagem interna do SUAP para o navegador.
  return res.status(502).json({ erro: `O SUAP não respondeu ao buscar ${contexto}. Tente novamente.` });
};

module.exports = {
  getDadosPessoais, getPeriodos, getBoletim,
  getProjetosPesquisa, getProjetosExtensao,
  getCalendario, updatePreferencias,
  getProjetosInternos, solicitarParticipacao,
  solicitarParticipacaoSuap,
  cancelarSolicitacao, cancelarSolicitacaoSuap,
};
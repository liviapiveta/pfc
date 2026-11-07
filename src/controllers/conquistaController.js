const mongoose = require('mongoose');
const Conquista = require('../models/Conquista');
const ConquistaUsuario = require('../models/ConquistaUsuario');
const Solicitacao = require('../models/Solicitacao');
const Presenca = require('../models/Presenca');
const User = require('../models/User');
const { calcularNivel, NIVEIS } = require('../services/niveis');

// Pontos precisam ser um número inteiro ≥ 0 (antes "abc" passava e virava erro 500)
const pontosValidos = (v) => v !== '' && v != null && Number.isFinite(Number(v)) && Number(v) >= 0;
const textoSimples = (v) => (typeof v === 'string' ? v : undefined);

/**
 * Recalcula o total de pontos de um aluno a partir das conquistas
 * CONFIRMADAS e grava em User.pontos.
 *
 * Por que recalcular em vez de só somar/subtrair?
 *  - Evita divergência (o cache nunca "desanda" do valor real).
 *  - Evita pontos negativos por engano.
 *  - É barato na escala de um campus.
 * Toda operação que concede ou revoga conquista chama isto no final.
 */
// Uma única implementação (no motor), que também avisa o aluno por e-mail
// quando ele sobe de nível. Antes havia duas cópias desta função.
const { recalcularPontosAluno, sincronizarTodos } = require('../services/conquistaEngine');

/**
 * Lista branca + validação dos campos do catálogo de conquistas.
 * Antes o corpo inteiro ia para o banco e a regra não era conferida
 * (ex.: regra de nota sem alvo, regra de evento com valor qualquer).
 * Devolve { dados } ou { erro }.
 */
const CATEGORIAS = ['academico', 'projeto', 'evento', 'especial'];
const dadosConquista = (body = {}, parcial = false) => {
  const d = {};
  if (body.nome !== undefined || !parcial) {
    d.nome = String(body.nome || '').trim().slice(0, 120);
    if (!d.nome) return { erro: 'O nome da conquista é obrigatório' };
  }
  if (body.descricao !== undefined) d.descricao = String(body.descricao || '').trim().slice(0, 500);
  if (body.icone !== undefined) d.icone = String(body.icone || '🏆').trim().slice(0, 16) || '🏆';
  if (body.categoria !== undefined) {
    if (!CATEGORIAS.includes(body.categoria)) return { erro: 'Categoria inválida' };
    d.categoria = body.categoria;
  }
  if (body.pontos !== undefined || !parcial) {
    if (!pontosValidos(body.pontos)) return { erro: 'Pontos deve ser um número maior ou igual a 0' };
    d.pontos = Math.round(Number(body.pontos));
  }
  // "Ativa/Inativa" não existe mais: conquista que não serve mais é EXCLUÍDA
  // (não fica no banco como registro morto). O campo é ignorado.
  if (body.origem !== undefined || !parcial) {
    d.origem = body.origem === 'automatica' ? 'automatica' : 'manual';
    if (d.origem === 'manual') d.regra = { tipo: null, valor: null };
    else {
      const tipo = body.regra?.tipo;
      let valor = body.regra?.valor == null ? '' : String(body.regra.valor).trim();
      if (tipo === 'nota') {
        if (!valor) return { erro: 'Informe a nota ou conceito alvo (ex.: 90 ou A)' };
        if (!/^(\d{1,3}([.,]\d{1,2})?|[A-Ea-e])$/.test(valor)) return { erro: 'Alvo da nota inválido: use um número (ex.: 90) ou uma letra de A a E' };
      } else if (tipo === 'projeto_aceito') {
        if (valor && !['pesquisa', 'extensao'].includes(valor)) return { erro: 'Tipo de projeto inválido' };
      } else if (tipo === 'evento_presenca') {
        if (!valor || valor === 'cada') valor = 'cada';
        else if (!/^\d{1,3}$/.test(valor) || Number(valor) < 1) return { erro: 'Quantidade de eventos inválida' };
      } else {
        return { erro: 'Conquista automática exige uma regra' };
      }
      d.regra = { tipo, valor: valor || null };
      // A categoria acompanha a regra (uma regra de evento é, por definição, de evento)
      d.categoria = { nota: 'academico', projeto_aceito: 'projeto', evento_presenca: 'evento' }[tipo];
    }
  }
  return { dados: d };
};
const { notificarAluno } = require('../services/notificacoes');
const { registrar } = require('../services/auditoria');

/**
 * _rankearAlunos — monta o ranking a partir da FONTE DA VERDADE.
 *
 * Em vez de confiar no cache User.pontos (que pode ficar desatualizado e,
 * quando fica zerado para todos, faz todo mundo aparecer em 1º lugar),
 * somamos aqui as conquistas CONFIRMADAS de cada aluno direto da coleção
 * ConquistaUsuario. O índice em ConquistaUsuario.matricula mantém o lookup
 * barato na escala de um campus.
 *
 * Retorna a lista já ORDENADA e com a `posicao` calculada.
 *
 * Ordenação: 1º por pontos (maior → menor); em caso de EMPATE, desempata
 * por QUEM CHEGOU AO TOTAL PRIMEIRO — ou seja, pela data da conquista mais
 * recente do aluno (a que o levou ao total atual): mais cedo fica acima.
 * Como último critério (alunos sem conquista, todos com 0 pontos), usa o
 * nome. A posição é ORDINAL (1, 2, 3, …), então cada aluno recebe um lugar
 * distinto — sem "monte de gente" na mesma colocação.
 *
 * Cada item traz: nomeUsuario, matricula, curso, pontosReais,
 * ultimaConquistaEm e posicao.
 */
const _rankearAlunos = async (filtroUser = {}) => {
  const rows = await User.aggregate([
    { $match: filtroUser },
    {
      $lookup: {
        from: ConquistaUsuario.collection.name,
        let: { mat: '$matricula' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$matricula', '$$mat'] },
                  { $eq: ['$status', 'confirmada'] },
                ],
              },
            },
          },
          // Soma os pontos e guarda a data da conquista MAIS RECENTE
          // (o momento em que o aluno atingiu o total atual).
          {
            $group: {
              _id: null,
              total: { $sum: '$pontos' },
              ultima: { $max: '$createdAt' },
            },
          },
        ],
        as: '_cs',
      },
    },
    {
      $addFields: {
        pontosReais: { $ifNull: [{ $arrayElemAt: ['$_cs.total', 0] }, 0] },
        // Instante em que o aluno chegou ao total atual (desempate).
        // Fica nulo só para quem não tem conquista (sempre 0 pontos).
        ultimaConquistaEm: { $arrayElemAt: ['$_cs.ultima', 0] },
      },
    },
    // Empate de pontos → quem conquistou primeiro (data asc) fica acima.
    // Nulos (0 pontos / sem conquista) caem para o desempate por nome.
    { $sort: { pontosReais: -1, ultimaConquistaEm: 1, nomeUsuario: 1 } },
    {
      $project: {
        nomeUsuario: 1,
        matricula: 1,
        curso: 1,
        pontosReais: 1,
        ultimaConquistaEm: 1,
        privacidadeRanking: 1,
      },
    },
  ]);

  // Posição ORDINAL (1, 2, 3, …): o empate de pontos já foi resolvido pela
  // data de conquista no $sort, então cada aluno tem uma colocação única.
  rows.forEach((u, i) => {
    u.posicao = i + 1;
  });

  return rows;
};

/** Texto curto de "como ganhar" para o aluno (só nas automáticas). */
const comoGanhar = (c) => {
  if (c.origem !== 'automatica' || !c.regra?.tipo) return c.origem === 'manual' ? 'Concedida por um professor' : '';
  const v = c.regra.valor;
  if (c.regra.tipo === 'nota') return /^\d/.test(String(v)) ? `Tirar ${v} ou mais em alguma disciplina` : `Tirar conceito ${v} em alguma disciplina`;
  if (c.regra.tipo === 'projeto_aceito') return v === 'pesquisa' ? 'Ser aceito em um projeto de pesquisa' : v === 'extensao' ? 'Ser aceito em um projeto de extensão' : 'Ser aceito em um projeto';
  if (c.regra.tipo === 'evento_presenca') {
    const n = parseInt(v, 10);
    return Number.isInteger(n) && n > 0 ? `Ter presença validada em ${n} evento${n > 1 ? 's' : ''}` : 'A cada evento com presença validada';
  }
  return '';
};

// ── Catálogo de conquistas ────────────────────────────────────

/** GET /api/admin/conquistas  (opcional ?categoria= &ativa=true|false) */
const getConquistas = async (req, res) => {
  try {
    const filtro = {};
    const categoria = textoSimples(req.query.categoria);
    if (categoria) filtro.categoria = categoria;
    if (req.query.ativa === 'true') filtro.ativa = true;
    if (req.query.ativa === 'false') filtro.ativa = false;

    const lista = await Conquista.find(filtro).sort({ createdAt: -1 }).lean();
    const { conquistaServeParaEvento } = require('../services/presencaService');
    return res.json(lista.map((c) => ({
      ...c,
      comoGanhar: comoGanhar(c),
      paraEvento: conquistaServeParaEvento(c), // pode ser escolhida dentro de um evento
    })));
  } catch (err) {
    console.error('Erro ao buscar conquistas:', err.message);
    return res.status(500).json({ erro: 'Erro ao buscar conquistas' });
  }
};

/** GET /api/admin/conquistas/:id  (para edição) */
const getConquista = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ erro: 'Conquista não encontrada' });
    }
    const c = await Conquista.findById(req.params.id);
    if (!c) return res.status(404).json({ erro: 'Conquista não encontrada' });
    return res.json(c);
  } catch (err) {
    console.error('Erro ao buscar conquista:', err.message);
    return res.status(500).json({ erro: 'Erro ao buscar conquista' });
  }
};

/** POST /api/admin/conquistas */
const criarConquista = async (req, res) => {
  try {
    const { dados, erro } = dadosConquista(req.body);
    if (erro) return res.status(400).json({ erro });

    const c = await Conquista.create(dados);
    // Regra nova vale para TRÁS também: quem já cumpre ganha agora
    let retroativo = null;
    if (c.origem === 'automatica' && c.regra?.tipo !== 'nota') retroativo = await sincronizarTodos();
    registrar(req, 'conquista.criar', c.nome, { pontos: c.pontos, origem: c.origem, ...(retroativo ? { alunosAfetados: retroativo.afetados } : {}) });
    return res.status(201).json({ ...c.toObject(), retroativo });
  } catch (err) {
    console.error('Erro ao criar conquista:', err.message);
    return res.status(500).json({ erro: 'Erro ao criar conquista' });
  }
};

/** PUT /api/admin/conquistas/:id */
const atualizarConquista = async (req, res) => {
  try {
    const antes = await Conquista.findById(req.params.id).lean();
    if (!antes) return res.status(404).json({ erro: 'Conquista não encontrada' });
    const { dados, erro } = dadosConquista(req.body, true);
    if (erro) return res.status(400).json({ erro });

    const c = await Conquista.findByIdAndUpdate(req.params.id, { $set: dados }, { returnDocument: 'after', runValidators: true });

    // Nome/pontos corrigidos valem para TODOS que já têm a conquista — antes
    // ficava o valor antigo e dois alunos com a mesma conquista tinham pontos diferentes
    if (c.nome !== antes.nome || c.pontos !== antes.pontos) {
      const afetados = await ConquistaUsuario.distinct('matricula', { conquista: c._id });
      await ConquistaUsuario.updateMany({ conquista: c._id }, { $set: { nomeConquista: c.nome, pontos: c.pontos } });
      if (c.pontos !== antes.pontos) await Promise.all(afetados.map((m) => recalcularPontosAluno(m, { notificar: false })));
    }
    // Mudou a regra, ativou/desativou ou virou automática → recalcula quem cumpre
    const mudouRegra = JSON.stringify(antes.regra || {}) !== JSON.stringify(c.regra || {}) ||
      antes.origem !== c.origem || antes.ativa !== c.ativa;
    let retroativo = null;
    if (mudouRegra && (c.origem === 'automatica' || antes.origem === 'automatica')) retroativo = await sincronizarTodos();

    registrar(req, 'conquista.editar', c.nome, { pontos: c.pontos, ativa: c.ativa, ...(retroativo ? { alunosAfetados: retroativo.afetados } : {}) });
    return res.json({ ...c.toObject(), retroativo });
  } catch (err) {
    console.error('Erro ao atualizar conquista:', err.message);
    return res.status(500).json({ erro: 'Erro ao atualizar conquista' });
  }
};

/** DELETE /api/admin/conquistas/:id
 *  Exclui a conquista do catálogo E remove todas as concessões dela,
 *  recalculando os pontos de cada aluno afetado (para não sobrar
 *  pontuação "fantasma" de uma conquista que não existe mais).
 *  (Não existe mais "desativar": conquista que não serve mais é excluída.)
 */
const deletarConquista = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ erro: 'Conquista não encontrada' });
    }

    // 1. Descobre quais alunos têm esta conquista (para recalcular depois)
    const concessoes = await ConquistaUsuario.find({ conquista: req.params.id })
      .select('matricula')
      .lean();
    const matriculasAfetadas = [...new Set(concessoes.map(c => c.matricula))];

    // 2. Apaga a conquista do catálogo
    const c = await Conquista.findByIdAndDelete(req.params.id);
    if (!c) return res.status(404).json({ erro: 'Conquista não encontrada' });

    // 3. Apaga todas as concessões dela e tira dos eventos que a usavam
    await ConquistaUsuario.deleteMany({ conquista: req.params.id });
    await Promise.all([
      require('../models/Evento').updateMany({ conquista: c._id }, { $set: { conquista: null } }),
      require('../models/EventoSuap').updateMany({ conquista: c._id }, { $set: { conquista: null } }),
    ]);

    // 4. Recalcula os pontos de cada aluno que tinha a conquista
    await Promise.all(matriculasAfetadas.map(m => recalcularPontosAluno(m, { notificar: false })));
    registrar(req, 'conquista.excluir', c.nome, { alunosAfetados: matriculasAfetadas.length });

    return res.json({ sucesso: true, alunosAfetados: matriculasAfetadas.length });
  } catch (err) {
    console.error('Erro ao excluir conquista:', err.message);
    return res.status(500).json({ erro: 'Erro ao excluir conquista' });
  }
};

// ── Concessão manual a um aluno ───────────────────────────────

/**
 * POST /api/admin/conquistas/:id/conceder   body: { matricula }
 * Concede uma conquista a um aluno (manualmente, pelo admin).
 * Idempotente: conceder de novo não duplica nem soma pontos duas vezes.
 */
const concederConquista = async (req, res) => {
  try {
    // Matrículas são gravadas em MAIÚSCULAS no login do aluno
    const matricula = String(req.body.matricula || '').trim().toUpperCase();
    if (!matricula) {
      return res.status(400).json({ erro: 'A matrícula do aluno é obrigatória' });
    }

    const conquista = await Conquista.findById(req.params.id);
    if (!conquista) return res.status(404).json({ erro: 'Conquista não encontrada' });
    if (!conquista.ativa) return res.status(400).json({ erro: 'Esta conquista está inativa' });

    // O aluno precisa existir (ter logado ao menos uma vez no portal)
    const aluno = await User.findOne({ matricula });
    if (!aluno) {
      return res.status(404).json({
        erro: 'Aluno não encontrado. Ele precisa ter acessado o portal ao menos uma vez.',
      });
    }

    // Tenta registrar. O índice único (matricula + conquista + chaveContexto)
    // é quem garante que não há duplicidade — chaveContexto '' = concessão única.
    try {
      await ConquistaUsuario.create({
        matricula,
        conquista: conquista._id,
        nomeConquista: conquista.nome,
        pontos: conquista.pontos,
        status: 'confirmada',
        origem: 'admin',
        concedidoPor: req.admin?.email || req.admin?.nome || 'admin',
        contexto: {},
        chaveContexto: '',
      });
    } catch (err) {
      if (err.code === 11000) {
        // Já tinha sido concedida antes → não faz nada, não soma de novo
        return res.status(200).json({ sucesso: true, jaConcedida: true });
      }
      throw err;
    }

    registrar(req, 'conquista.conceder', `${conquista.nome} → ${matricula}`, { matricula, pontos: conquista.pontos });
    await notificarAluno(matricula, 'conquista', { nome: conquista.nome, pontos: conquista.pontos });
    const pontos = await recalcularPontosAluno(matricula);
    return res.status(201).json({ sucesso: true, pontosAluno: pontos });
  } catch (err) {
    console.error('Erro ao conceder conquista:', err.message);
    return res.status(500).json({ erro: 'Erro ao conceder conquista' });
  }
};

/**
 * GET /api/admin/alunos/:matricula/conquistas
 * Lista as conquistas que um aluno já possui (para o admin conferir/gerenciar).
 */
const getConquistasDoAluno = async (req, res) => {
  try {
    const matricula = String(req.params.matricula || '').trim().toUpperCase();
    const lista = await ConquistaUsuario.find({ matricula })
      .sort({ createdAt: -1 })
      .lean();
    return res.json(lista);
  } catch (err) {
    console.error('Erro ao listar conquistas do aluno:', err.message);
    return res.status(500).json({ erro: 'Erro ao listar conquistas do aluno' });
  }
};

/**
 * DELETE /api/admin/conquistas-concedidas/:registroId
 * Revoga uma concessão (corrige um erro). Remove o registro e recalcula
 * os pontos do aluno. A trilha fica no log; o histórico de pontos se ajusta.
 */
const revogarConcessao = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.registroId)) {
      return res.status(404).json({ erro: 'Registro não encontrado' });
    }
    const reg = await ConquistaUsuario.findById(req.params.registroId);
    if (!reg) return res.status(404).json({ erro: 'Registro não encontrado' });

    // Professor só revoga o que ELE concedeu; desenvolvedor revoga qualquer uma
    if (req.admin?.cargo !== 'desenvolvedor' && reg.concedidoPor !== req.admin?.email) {
      return res.status(403).json({ erro: 'Você só pode remover conquistas que você mesmo concedeu.' });
    }

    const matricula = reg.matricula;
    await reg.deleteOne();
    registrar(req, 'conquista.revogar', `${reg.nomeConquista} → ${matricula}`, { matricula, pontos: reg.pontos, origem: reg.origem });
    const pontos = await recalcularPontosAluno(matricula, { notificar: false });

    return res.json({ sucesso: true, pontosAluno: pontos });
  } catch (err) {
    console.error('Erro ao revogar concessão:', err.message);
    return res.status(500).json({ erro: 'Erro ao revogar concessão' });
  }
};

// ── Lado do aluno (portal) ────────────────────────────────────

/**
 * GET /api/minhas-conquistas   (aluno logado)
 * Retorna as conquistas DESBLOQUEADAS pelo aluno e as DISPONÍVEIS
 * (ativas que ele ainda não tem), além do total de pontos.
 */
const getMinhasConquistas = async (req, res) => {
  try {
    const matricula = req.user.matricula;

    const [desbloqueadasRaw, catalogo] = await Promise.all([
      ConquistaUsuario.find({ matricula, status: 'confirmada' })
        .populate('conquista', 'nome icone categoria descricao origem')
        .sort({ createdAt: -1 })
        .lean(),
      Conquista.find({ ativa: true }).sort({ pontos: 1 }).lean(),
    ]);

    const idsDesbloqueadas = new Set(
      desbloqueadasRaw.map(d => String(d.conquista?._id || d.conquista))
    );

    // Usa o "retrato" (nome/pontos no momento do desbloqueio) e completa com
    // ícone/categoria do catálogo atual quando a conquista ainda existe.
    // Conquistas ganhas várias vezes (ex.: uma por evento) viram UM card "×N"
    const porConquista = new Map();
    for (const d of desbloqueadasRaw) {
      const k = String(d.conquista?._id || d.conquista);
      const g = porConquista.get(k);
      if (g) { g.vezes += 1; g.pontos += Number(d.pontos) || 0; continue; }
      porConquista.set(k, {
        _id: d._id,
        conquistaId: k,
        nome: d.nomeConquista || d.conquista?.nome || 'Conquista',
        pontos: Number(d.pontos) || 0,
        vezes: 1,
        icone: d.conquista?.icone || '🏆',
        categoria: d.conquista?.categoria || 'especial',
        descricao: d.conquista?.descricao || '',
        origem: d.origem,            // 'admin' | 'automatica'
        em: d.createdAt,
      });
    }
    const desbloqueadas = [...porConquista.values()];

    const disponiveis = catalogo
      .filter(c => !idsDesbloqueadas.has(String(c._id)))
      .map(c => ({
        _id: c._id,
        nome: c.nome,
        pontos: c.pontos,
        icone: c.icone || '🏆',
        categoria: c.categoria,
        descricao: c.descricao || '',
        origem: c.origem,          // 'manual' | 'automatica'
        comoGanhar: comoGanhar(c),
      }));

    // Soma das conquistas confirmadas (mesma fonte do Dashboard e do Ranking;
    // antes usava o cache User.pontos, que podia mostrar outro número)
    const pontos = desbloqueadas.reduce((t, d) => t + (Number(d.pontos) || 0), 0);
    // "A cada evento" continua valendo depois da primeira vez: avisa no card
    const catPorId = new Map(catalogo.map((c) => [String(c._id), c]));
    desbloqueadas.forEach((d) => {
      const c = catPorId.get(d.conquistaId);
      if (c && c.regra?.tipo === 'evento_presenca' && !(parseInt(c.regra.valor, 10) > 0)) d.comoGanhar = comoGanhar(c);
      delete d.conquistaId;
    });
    const totalRegistros = desbloqueadasRaw.length;

    return res.json({
      pontos,
      desbloqueadas,
      disponiveis,
      totalRegistros,
    });
  } catch (err) {
    console.error('Erro ao buscar conquistas do aluno:', err.message);
    return res.status(500).json({ erro: 'Erro ao buscar conquistas' });
  }
};

// ── Ranking ───────────────────────────────────────────────────

/**
 * GET /api/ranking?escopo=geral|curso   (aluno logado)
 * Retorna o ranking ordenado por pontos. Em 'curso', restringe aos
 * alunos do mesmo curso do aluno logado. Sempre devolve também a
 * posição do próprio aluno (mesmo que ele esteja fora do top mostrado).
 *
 * A pontuação e a posição vêm da FONTE DA VERDADE (ConquistaUsuario),
 * não do cache User.pontos — assim a colocação fica correta mesmo que
 * o cache esteja desatualizado.
 */
/**
 * Aplica a privacidade escolhida por cada aluno:
 *   oculto  → sai da lista (e não ocupa posição); o próprio aluno vê "oculto"
 *   anonimo → aparece como "Aluno anônimo" para os outros
 * As posições são renumeradas só entre quem aparece.
 */
const _rankingVisivel = (todos, meuId) => {
  const visiveis = todos.filter(u => u.privacidadeRanking !== 'oculto');
  visiveis.forEach((u, i) => { u.posicao = i + 1; });
  const nomeExibido = (u) =>
    (u.privacidadeRanking === 'anonimo' && String(u._id) !== meuId) ? 'Aluno anônimo' : (u.nomeUsuario || 'Aluno');
  return { visiveis, nomeExibido };
};

const getRanking = async (req, res) => {
  try {
    const escopo = req.query.escopo === 'curso' ? 'curso' : 'geral';
    const me = req.user;
    const meuId = String(me._id);

    const filtro = {};
    if (escopo === 'curso') {
      if (!me.curso) {
        return res.json({
          escopo, curso: null, semCurso: true,
          eu: { posicao: null, nome: me.nomeUsuario, pontos: me.pontos || 0, nivel: calcularNivel(me.pontos || 0) },
          total: 0, ranking: [],
        });
      }
      filtro.curso = me.curso;
    }

    const todos = await _rankearAlunos(filtro);
    const meuReg = todos.find(u => String(u._id) === meuId);
    const meusPontos = meuReg ? meuReg.pontosReais : 0;
    const { visiveis, nomeExibido } = _rankingVisivel(todos, meuId);
    const meu = visiveis.find(u => String(u._id) === meuId);

    const linha = (u) => ({
      posicao: u.posicao,
      nome: nomeExibido(u),
      pontos: u.pontosReais || 0,
      nivel: calcularNivel(u.pontosReais || 0),
      isMe: String(u._id) === meuId,
    });

    const TOP = 50;
    const ranking = visiveis.slice(0, TOP).map(linha);

    // "Ver onde estou": se o aluno está fora do top, manda quem está ao redor dele
    const vizinhos = (meu && meu.posicao > TOP)
      ? visiveis.slice(Math.max(TOP, meu.posicao - 3), meu.posicao + 2).map(linha)
      : [];

    // "Perto de você": 2 acima e 2 abaixo, e quantos pontos faltam para passar o de cima
    const idx = meu ? visiveis.indexOf(meu) : -1;
    const perto = idx >= 0 ? visiveis.slice(Math.max(0, idx - 2), idx + 3).map(linha) : [];
    const acima = idx > 0 ? visiveis[idx - 1] : null;
    // Empate: fica na frente quem chegou primeiro àquele total — por isso +1
    const proximo = acima
      ? { nome: nomeExibido(acima), posicao: acima.posicao, faltam: Math.max(1, (acima.pontosReais || 0) - meusPontos + 1) }
      : null;

    return res.json({
      escopo,
      curso: escopo === 'curso' ? me.curso : null,
      eu: {
        posicao: meu ? meu.posicao : null,
        oculto: me.privacidadeRanking === 'oculto',
        anonimo: me.privacidadeRanking === 'anonimo',
        nome: me.nomeUsuario,
        pontos: meusPontos,
        nivel: calcularNivel(meusPontos),
      },
      total: visiveis.length,
      ranking,
      vizinhos,
      perto,
      proximo,
    });
  } catch (err) {
    console.error('Erro ao montar ranking:', err.message);
    return res.status(500).json({ erro: 'Erro ao buscar ranking' });
  }
};

// ── Dashboard (resumo agregado do aluno) ──────────────────────

/** GET /api/dashboard — pontos, nível, posição, conquistas (fonte da verdade). */
const getDashboard = async (req, res) => {
  try {
    const me = req.user;
    const meuId = String(me._id);

    const todos = await _rankearAlunos({});
    const meuReg = todos.find(u => String(u._id) === meuId);
    const pontos = meuReg ? meuReg.pontosReais : 0;
    const { visiveis } = _rankingVisivel(todos, meuId);
    const meu = visiveis.find(u => String(u._id) === meuId);

    const totalConquistas = await ConquistaUsuario.countDocuments({
      matricula: me.matricula,
      status: 'confirmada',
    });

    return res.json({
      nome: me.nomeUsuario,
      curso: me.curso || '',
      pontos,
      nivel: calcularNivel(pontos),
      niveis: NIVEIS,
      posicaoGeral: meu ? meu.posicao : null,   // null = aluno escolheu ficar oculto
      rankingOculto: me.privacidadeRanking === 'oculto',
      totalAlunos: visiveis.length,
      totalConquistas,
    });
  } catch (err) {
    console.error('Erro ao montar dashboard:', err.message);
    return res.status(500).json({ erro: 'Erro ao buscar dashboard' });
  }
};

// ── Novidades (aviso com confetes) ─────────────────────────────

/**
 * GET /api/novidades — conquistas novas e subida de nível desde a última visita.
 * Na PRIMEIRA vez (aluno antigo, campos vazios) só marca o ponto de partida,
 * para não "disparar" de uma vez tudo o que ele já tinha.
 */
const getNovidades = async (req, res) => {
  try {
    const me = req.user;
    const total = await ConquistaUsuario.aggregate([
      { $match: { matricula: me.matricula, status: 'confirmada' } },
      { $group: { _id: null, total: { $sum: '$pontos' } } },
    ]);
    const nivelAtual = calcularNivel(total[0]?.total || 0);

    if (!me.conquistasVistasEm) {
      await User.updateOne({ _id: me._id }, { $set: { conquistasVistasEm: new Date(), nivelVisto: nivelAtual.nivel } });
      return res.json({ conquistas: [], subiuNivel: null });
    }

    const novas = await ConquistaUsuario.find({
      matricula: me.matricula, status: 'confirmada', createdAt: { $gt: me.conquistasVistasEm },
    }).populate('conquista', 'icone').sort({ createdAt: 1 }).lean();

    const subiuNivel = (me.nivelVisto != null && nivelAtual.nivel > me.nivelVisto)
      ? { de: me.nivelVisto, para: nivelAtual.nivel, nome: nivelAtual.nome }
      : null;

    return res.json({
      conquistas: novas.map(c => ({ nome: c.nomeConquista, pontos: c.pontos, icone: c.conquista?.icone || '🏆' })),
      subiuNivel,
    });
  } catch (err) {
    console.error('Erro ao buscar novidades:', err.message);
    return res.status(500).json({ erro: 'Erro ao buscar novidades' });
  }
};

/** POST /api/novidades/vistas — o aluno já viu o aviso */
const marcarNovidadesVistas = async (req, res) => {
  try {
    const total = await ConquistaUsuario.aggregate([
      { $match: { matricula: req.user.matricula, status: 'confirmada' } },
      { $group: { _id: null, total: { $sum: '$pontos' } } },
    ]);
    await User.updateOne({ _id: req.user._id }, {
      $set: { conquistasVistasEm: new Date(), nivelVisto: calcularNivel(total[0]?.total || 0).nivel },
    });
    return res.json({ sucesso: true });
  } catch (err) {
    return res.status(500).json({ erro: 'Erro ao salvar' });
  }
};

// ── Minha Trajetória (histórico do aluno) ─────────────────────

/**
 * GET /api/trajetoria   (aluno logado)
 * Monta a "linha do tempo" pessoal do aluno, misturando dois tipos de
 * acontecimento num só histórico, já ordenado do mais recente para o
 * mais antigo:
 *   - conquista → uma conquista desbloqueada (data = createdAt do registro)
 *   - projeto   → uma participação em projeto ACEITA (data = decididoEm;
 *                 se for um registro antigo sem esse campo, usa updatedAt)
 *
 * O front desenha isso como a timeline de eventos do dashboard.
 */
const getTrajetoria = async (req, res) => {
  try {
    const matricula = req.user.matricula;

    const [conquistas, participacoes, presencas] = await Promise.all([
      ConquistaUsuario.find({ matricula, status: 'confirmada' })
        .populate('conquista', 'icone categoria')
        .sort({ createdAt: -1 })
        .lean(),
      Solicitacao.find({ matricula, status: 'aceito' })
        .sort({ updatedAt: -1 })
        .lean(),
      Presenca.find({ matricula, status: 'aprovada' }).sort({ decididoEm: -1 }).lean(),
    ]);

    const itensEvento = presencas.map((p) => ({
      tipo: 'evento',
      data: p.decididoEm || p.updatedAt,
      titulo: p.eventoNome || '(evento)',
      descricao: p.metodo === 'qrcode' ? 'Presença validada por QR Code' : 'Presença validada por certificado',
      icone: '🎟️',
    }));

    const itensConquista = conquistas.map((c) => ({
      tipo: 'conquista',
      data: c.createdAt,
      titulo: c.nomeConquista || 'Conquista',
      // Conta o PORQUÊ (antes era sempre "Conquista desbloqueada")
      descricao: c.origem === 'admin'
        ? 'Concedida por um professor'
        : c.contexto?.evento ? `Pela presença em "${c.contexto.evento}"`
        : c.contexto?.gatilho === 'projeto_aceito' ? 'Por participar de um projeto'
        : c.contexto?.disciplina ? `Pela nota em ${c.contexto.disciplina}`
        : 'Conquista desbloqueada',
      icone: c.conquista?.icone || '🏆',
      pontos: c.pontos || 0,
      origem: c.origem, // 'automatica' | 'admin'
    }));

    const itensProjeto = participacoes.map((s) => ({
      tipo: 'projeto',
      data: s.decididoEm || s.updatedAt,
      titulo: s.projetoTitulo || '(projeto)',
      descricao:
        s.tipo === 'pesquisa'
          ? 'Participação aceita · Pesquisa'
          : s.tipo === 'extensao'
          ? 'Participação aceita · Extensão'
          : 'Participação aceita',
      icone: s.tipo === 'extensao' ? '🌱' : '🔬',
      projetoTipo: s.tipo || null,
    }));

    const trajetoria = [...itensConquista, ...itensProjeto, ...itensEvento]
      .filter((x) => x.data) // descarta itens sem data
      .sort((a, b) => new Date(b.data) - new Date(a.data));

    const resumo = {
      conquistas: itensConquista.length,
      projetos: itensProjeto.length,
      eventos: itensEvento.length,
      pontos: itensConquista.reduce((t, c) => t + (Number(c.pontos) || 0), 0),
    };
    return res.json({ total: trajetoria.length, resumo, trajetoria });
  } catch (err) {
    console.error('Erro ao montar trajetória:', err.message);
    return res.status(500).json({ erro: 'Erro ao buscar trajetória' });
  }
};

module.exports = {
  recalcularPontosAluno, // exportado p/ reuso na Fase 2 (concessões automáticas)
  getConquistas,
  getConquista,
  criarConquista,
  atualizarConquista,
  deletarConquista,
  concederConquista,
  getConquistasDoAluno,
  revogarConcessao,
  getMinhasConquistas,
  getRanking,
  getDashboard,
  getTrajetoria,
  getNovidades,
  marcarNovidadesVistas,
  _rankearAlunos,
  _rankingVisivel,
};
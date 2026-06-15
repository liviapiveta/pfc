const mongoose = require('mongoose');
const Conquista = require('../models/Conquista');
const ConquistaUsuario = require('../models/ConquistaUsuario');
const Solicitacao = require('../models/Solicitacao');
const User = require('../models/User');
const { calcularNivel } = require('../services/niveis');

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
const recalcularPontosAluno = async (matricula) => {
  const r = await ConquistaUsuario.aggregate([
    { $match: { matricula, status: 'confirmada' } },
    { $group: { _id: null, total: { $sum: '$pontos' } } },
  ]);
  const total = r[0]?.total || 0;
  await User.updateOne({ matricula }, { $set: { pontos: total } });
  return total;
};

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

// ── Catálogo de conquistas ────────────────────────────────────

/** GET /api/admin/conquistas  (opcional ?categoria= &ativa=true|false) */
const getConquistas = async (req, res) => {
  try {
    const filtro = {};
    if (req.query.categoria) filtro.categoria = req.query.categoria;
    if (req.query.ativa === 'true') filtro.ativa = true;
    if (req.query.ativa === 'false') filtro.ativa = false;

    const lista = await Conquista.find(filtro).sort({ createdAt: -1 });
    return res.json(lista);
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
    const { nome, pontos, origem } = req.body;

    if (!nome || !nome.trim()) {
      return res.status(400).json({ erro: 'O nome da conquista é obrigatório' });
    }
    if (pontos == null || Number(pontos) < 0) {
      return res.status(400).json({ erro: 'Pontos deve ser um número maior ou igual a 0' });
    }
    // Conquista automática precisa de uma regra com tipo
    if (origem === 'automatica' && !req.body?.regra?.tipo) {
      return res.status(400).json({ erro: 'Conquista automática exige uma regra (regra.tipo)' });
    }

    const c = await Conquista.create(req.body);
    return res.status(201).json(c);
  } catch (err) {
    console.error('Erro ao criar conquista:', err.message);
    return res.status(500).json({ erro: 'Erro ao criar conquista' });
  }
};

/** PUT /api/admin/conquistas/:id */
const atualizarConquista = async (req, res) => {
  try {
    const c = await Conquista.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!c) return res.status(404).json({ erro: 'Conquista não encontrada' });

    // Se os pontos da conquista mudaram, os registros JÁ concedidos guardam
    // o "retrato" antigo de propósito (não mexemos no que o aluno já ganhou).
    // Só novas concessões usarão o valor novo.
    return res.json(c);
  } catch (err) {
    console.error('Erro ao atualizar conquista:', err.message);
    return res.status(500).json({ erro: 'Erro ao atualizar conquista' });
  }
};

/** DELETE /api/admin/conquistas/:id
 *  Exclui a conquista do catálogo E remove todas as concessões dela,
 *  recalculando os pontos de cada aluno afetado (para não sobrar
 *  pontuação "fantasma" de uma conquista que não existe mais).
 *  Se preferir só "tirar de circulação" sem apagar histórico, use
 *  ativa=false via PUT em vez de excluir.
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

    // 3. Apaga todas as concessões dela
    await ConquistaUsuario.deleteMany({ conquista: req.params.id });

    // 4. Recalcula os pontos de cada aluno que tinha a conquista
    await Promise.all(matriculasAfetadas.map(m => recalcularPontosAluno(m)));

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
    const matricula = String(req.body.matricula || '').trim();
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
        concedidoPor: req.admin?.usuario || 'admin',
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
    const matricula = String(req.params.matricula || '').trim();
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

    const matricula = reg.matricula;
    await reg.deleteOne();
    const pontos = await recalcularPontosAluno(matricula);

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

    const [usuario, desbloqueadasRaw, catalogo] = await Promise.all([
      User.findOne({ matricula }).select('pontos').lean(),
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
    const desbloqueadas = desbloqueadasRaw.map(d => ({
      _id: d._id,
      nome: d.nomeConquista || d.conquista?.nome || 'Conquista',
      pontos: d.pontos,
      icone: d.conquista?.icone || '🏆',
      categoria: d.conquista?.categoria || 'especial',
      descricao: d.conquista?.descricao || '',
      origem: d.origem,            // 'admin' | 'automatica'
      em: d.createdAt,
    }));

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
      }));

    return res.json({
      pontos: usuario?.pontos || 0,
      desbloqueadas,
      disponiveis,
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
const getRanking = async (req, res) => {
  try {
    const escopo = req.query.escopo === 'curso' ? 'curso' : 'geral';
    const me = req.user;

    // Filtro do escopo
    const filtro = {};
    if (escopo === 'curso') {
      if (!me.curso) {
        // Aluno sem curso registrado (ex.: logou antes de capturarmos o curso)
        return res.json({
          escopo,
          curso: null,
          semCurso: true,
          eu: { posicao: null, nome: me.nomeUsuario, pontos: me.pontos || 0 },
          total: 0,
          ranking: [],
        });
      }
      filtro.curso = me.curso;
    }

    const todos = await _rankearAlunos(filtro);

    const meu = todos.find(u => u.matricula === me.matricula);
    const meusPontos = meu ? meu.pontosReais : 0;
    const minhaPosicao = meu ? meu.posicao : null;

    const TOP = 50;
    const ranking = todos.slice(0, TOP).map(u => ({
      posicao: u.posicao,
      nome: u.nomeUsuario || 'Aluno',
      pontos: u.pontosReais || 0,
      isMe: u.matricula === me.matricula,
    }));

    return res.json({
      escopo,
      curso: escopo === 'curso' ? me.curso : null,
      eu: { posicao: minhaPosicao, nome: me.nomeUsuario, pontos: meusPontos },
      total: todos.length,
      ranking,
    });
  } catch (err) {
    console.error('Erro ao montar ranking:', err.message);
    return res.status(500).json({ erro: 'Erro ao buscar ranking' });
  }
};

// ── Dashboard (resumo agregado do aluno) ──────────────────────

/**
 * GET /api/dashboard   (aluno logado)
 * Reúne, numa resposta só, o que o painel inicial precisa:
 * pontos, nível (com progresso), posição no ranking geral,
 * total de conquistas e dados básicos do aluno.
 * Os "próximos eventos" o front busca via /api/calendario (já existente).
 *
 * Pontos e posição vêm da FONTE DA VERDADE (ConquistaUsuario), pelos
 * mesmos motivos do ranking — evita todo aluno aparecer em 1º quando o
 * cache User.pontos está zerado/desatualizado.
 */
const getDashboard = async (req, res) => {
  try {
    const me = req.user;

    const todos = await _rankearAlunos({}); // ranking geral, fonte da verdade
    const meu = todos.find(u => u.matricula === me.matricula);

    const pontos = meu ? meu.pontosReais : 0;
    const posicaoGeral = meu ? meu.posicao : todos.length + 1;
    const totalAlunos = todos.length;

    const totalConquistas = await ConquistaUsuario.countDocuments({
      matricula: me.matricula,
      status: 'confirmada',
    });

    return res.json({
      nome: me.nomeUsuario,
      curso: me.curso || '',
      pontos,
      nivel: calcularNivel(pontos),       // { nivel, nome, progresso, faltamParaProximo, ... }
      posicaoGeral,
      totalAlunos,
      totalConquistas,
    });
  } catch (err) {
    console.error('Erro ao montar dashboard:', err.message);
    return res.status(500).json({ erro: 'Erro ao buscar dashboard' });
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

    const [conquistas, participacoes] = await Promise.all([
      ConquistaUsuario.find({ matricula, status: 'confirmada' })
        .populate('conquista', 'icone categoria')
        .sort({ createdAt: -1 })
        .lean(),
      Solicitacao.find({ matricula, status: 'aceito' })
        .sort({ updatedAt: -1 })
        .lean(),
    ]);

    const itensConquista = conquistas.map((c) => ({
      tipo: 'conquista',
      data: c.createdAt,
      titulo: c.nomeConquista || 'Conquista',
      descricao: 'Conquista desbloqueada',
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

    const trajetoria = [...itensConquista, ...itensProjeto]
      .filter((x) => x.data) // descarta itens sem data
      .sort((a, b) => new Date(b.data) - new Date(a.data));

    return res.json({ total: trajetoria.length, trajetoria });
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
};
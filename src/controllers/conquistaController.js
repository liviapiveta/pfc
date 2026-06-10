const mongoose = require('mongoose');
const Conquista = require('../models/Conquista');
const ConquistaUsuario = require('../models/ConquistaUsuario');
const User = require('../models/User');

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
 *  Bloqueia a exclusão se já houver alunos com ela (preserva histórico).
 *  Para "tirar de circulação", use ativa=false via PUT.
 */
const deletarConquista = async (req, res) => {
  try {
    const emUso = await ConquistaUsuario.countDocuments({ conquista: req.params.id });
    if (emUso > 0) {
      return res.status(409).json({
        erro: `Não é possível excluir: ${emUso} aluno(s) já possuem esta conquista. Desative-a (ativa=false) em vez de excluir.`,
      });
    }

    const c = await Conquista.findByIdAndDelete(req.params.id);
    if (!c) return res.status(404).json({ erro: 'Conquista não encontrada' });
    return res.json({ sucesso: true });
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
};
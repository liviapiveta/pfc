const Conquista = require('../models/Conquista');
const ConquistaUsuario = require('../models/ConquistaUsuario');
const User = require('../models/User');

/**
 * conquistaEngine — o "motor" das conquistas AUTOMÁTICAS.
 *
 * Fica num serviço separado (depende só dos models) para que tanto o
 * adminController (projeto aceito) quanto o suapController (boletim)
 * possam usá-lo sem dependência circular.
 *
 * Regra de pontuação: a verdade são os registros ConquistaUsuario
 * confirmados; User.pontos é só um cache que recalculamos a cada mudança.
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
 * Concede UMA conquista automática a um aluno, de forma idempotente.
 * Usamos chaveContexto = '' → o aluno ganha a conquista UMA vez só
 * (o índice único da coleção é quem garante isso). O `contexto` guarda
 * o que disparou (disciplina/projeto) apenas para auditoria/exibição.
 */
const concederAutomatica = async ({ matricula, conquistaDoc, contexto = {} }) => {
  try {
    await ConquistaUsuario.create({
      matricula,
      conquista: conquistaDoc._id,
      nomeConquista: conquistaDoc.nome,
      pontos: conquistaDoc.pontos,
      status: 'confirmada',
      origem: 'automatica',
      concedidoPor: null,
      contexto,
      chaveContexto: '',
    });
  } catch (err) {
    // 11000 = já tinha a conquista → não duplica, não soma de novo
    if (err.code === 11000) return { concedida: false };
    throw err;
  }
  await recalcularPontosAluno(matricula);
  return { concedida: true };
};

/**
 * Gatilho: solicitação de participação ACEITA.
 * Concede todas as conquistas automáticas com regra { tipo: 'projeto_aceito' }.
 * Opcional: regra.valor pode restringir a 'pesquisa' ou 'extensao'.
 */
const processarProjetoAceito = async (sol) => {
  if (!sol || sol.status !== 'aceito' || !sol.matricula) return;

  const conquistas = await Conquista.find({
    ativa: true,
    origem: 'automatica',
    'regra.tipo': 'projeto_aceito',
  }).lean();

  for (const c of conquistas) {
    // Se a regra define um valor ('pesquisa'/'extensao'), só vale para aquele tipo
    if (c.regra?.valor && c.regra.valor !== sol.tipo) continue;

    await concederAutomatica({
      matricula: sol.matricula,
      conquistaDoc: c,
      contexto: {
        gatilho: 'projeto_aceito',
        projeto: String(sol.projeto || sol.projetoSuapId || ''),
        tipo: sol.tipo || null,
        projetoTitulo: sol.projetoTitulo || '',
      },
    });
  }
};

/**
 * Gatilho: aluno abriu o boletim.
 * Concede conquistas automáticas com regra { tipo: 'nota', valor: 'A' } (ou
 * outro conceito) quando QUALQUER disciplina tem aquele conceito FINAL.
 *
 * Usamos o conceito final da disciplina (media_final_disciplina, com
 * fallback para media_disciplina) — o MESMO critério que o portal já
 * usa para exibir a nota fechada da disciplina.
 */
const processarBoletim = async (matricula, boletim, ctx = {}) => {
  if (!matricula || !Array.isArray(boletim) || !boletim.length) return;

  const conquistas = await Conquista.find({
    ativa: true,
    origem: 'automatica',
    'regra.tipo': 'nota',
  }).lean();
  if (!conquistas.length) return;

  // Conceito final por disciplina (normalizado em MAIÚSCULA)
  const conceitos = boletim
    .map((d) => ({
      disciplina: d.disciplina,
      conceito: String(d.media_final_disciplina ?? d.media_disciplina ?? '')
        .trim()
        .toUpperCase(),
    }))
    .filter((x) => x.conceito);

  for (const c of conquistas) {
    const alvo = String(c.regra?.valor ?? 'A').trim().toUpperCase();
    const achou = conceitos.find((x) => x.conceito === alvo);
    if (!achou) continue;

    await concederAutomatica({
      matricula,
      conquistaDoc: c,
      contexto: {
        gatilho: 'nota',
        disciplina: achou.disciplina || '',
        conceito: alvo,
        ano: ctx.ano ?? null,
        periodo: ctx.periodo ?? null,
      },
    });
  }
};

module.exports = {
  recalcularPontosAluno,
  concederAutomatica,
  processarProjetoAceito,
  processarBoletim,
};
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
 * Gatilho: verificação do boletim (no login, em 2º plano).
 * Concede conquistas automáticas com regra { tipo: 'nota', valor: X } quando
 * QUALQUER disciplina atingiu o alvo em QUALQUER ETAPA (1º/2º/3º/4º) OU na
 * média/conceito final.
 *
 * O alvo (regra.valor) pode ser:
 *   - NUMÉRICO (ex.: "90") → concede se a nota for número e MAIOR OU IGUAL ao alvo.
 *     (É o caso do SUAP que usa nota 0–100, como o deste campus.)
 *   - LETRA (ex.: "A")     → concede se o conceito for igual (A–E).
 *
 * O boletim traz as etapas em `nota_etapa_1`…`nota_etapa_4`, que podem vir
 * como objeto `{ nota, faltas }` ou valor direto — tratamos os dois.
 */

// Extrai o valor de uma etapa, aceitando objeto {nota|valor|media} ou valor direto
const _valorEtapa = (raw) => {
  if (raw == null) return '';
  if (typeof raw === 'object') return raw.nota ?? raw.valor ?? raw.media ?? '';
  return raw;
};

// Lista TODOS os valores de nota de uma disciplina (etapas + média + final)
const _valoresDaDisciplina = (d) => {
  const brutos = [
    { de: 'etapa_1', v: _valorEtapa(d.nota_etapa_1) },
    { de: 'etapa_2', v: _valorEtapa(d.nota_etapa_2) },
    { de: 'etapa_3', v: _valorEtapa(d.nota_etapa_3) },
    { de: 'etapa_4', v: _valorEtapa(d.nota_etapa_4) },
    { de: 'media',   v: d.media_disciplina },
    { de: 'final',   v: d.media_final_disciplina },
  ];
  return brutos
    .map((x) => ({ de: x.de, valor: String(x.v ?? '').trim() }))
    .filter((x) => x.valor !== '');
};

// A nota obtida satisfaz o alvo da regra?
//  - alvo numérico ("90") → nota é número e >= alvo
//  - alvo em letra ("A")  → conceito igual (sem diferenciar maiúscula/minúscula)
const _atendeAlvo = (valorObtido, alvo) => {
  const alvoStr = String(alvo ?? '').trim();
  if (alvoStr === '') return false;

  const alvoNum = Number(alvoStr.replace(',', '.'));
  const alvoEhNumero = !Number.isNaN(alvoNum);

  if (alvoEhNumero) {
    const vNum = Number(String(valorObtido).replace(',', '.'));
    return !Number.isNaN(vNum) && vNum >= alvoNum;
  }
  return String(valorObtido).trim().toUpperCase() === alvoStr.toUpperCase();
};

const processarBoletim = async (matricula, boletim, ctx = {}) => {
  if (!matricula || !Array.isArray(boletim) || !boletim.length) return;

  const conquistas = await Conquista.find({
    ativa: true,
    origem: 'automatica',
    'regra.tipo': 'nota',
  }).lean();
  if (!conquistas.length) return;

  // Lista achatada de todas as notas obtidas (etapa a etapa + média + final),
  // guardando de qual disciplina e de qual etapa cada uma veio.
  const obtidos = boletim.flatMap((d) =>
    _valoresDaDisciplina(d).map((x) => ({
      disciplina: d.disciplina || '',
      de: x.de,
      valor: x.valor,
    }))
  );

  for (const c of conquistas) {
    const alvo = c.regra?.valor ?? 'A';
    const achou = obtidos.find((x) => _atendeAlvo(x.valor, alvo));
    if (!achou) continue;

    await concederAutomatica({
      matricula,
      conquistaDoc: c,
      contexto: {
        gatilho: 'nota',
        disciplina: achou.disciplina,
        valor: achou.valor,      // a nota que disparou (ex.: "100")
        alvo: String(alvo),      // o alvo da regra (ex.: "90")
        onde: achou.de,          // 'etapa_1'…'etapa_4' | 'media' | 'final'
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
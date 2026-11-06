const Conquista = require('../models/Conquista');
const ConquistaUsuario = require('../models/ConquistaUsuario');
const User = require('../models/User');
const Solicitacao = require('../models/Solicitacao');
const Presenca = require('../models/Presenca');
const { calcularNivel } = require('./niveis');
const { notificarAluno } = require('./notificacoes');

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

const recalcularPontosAluno = async (matricula, { notificar = true } = {}) => {
  const r = await ConquistaUsuario.aggregate([
    { $match: { matricula, status: 'confirmada' } },
    { $group: { _id: null, total: { $sum: '$pontos' } } },
  ]);
  const total = r[0]?.total || 0;
  // Devolve o documento ANTERIOR para saber se o aluno subiu de nível
  const antes = await User.findOneAndUpdate({ matricula }, { $set: { pontos: total } }, { projection: { pontos: 1 } }).lean();

  if (notificar && antes) {
    const nivelAntes = calcularNivel(antes.pontos || 0);
    const nivelAgora = calcularNivel(total);
    if (nivelAgora.nivel > nivelAntes.nivel) {
      await notificarAluno(matricula, 'nivel', {
        nivel: nivelAgora.nivel, nome: nivelAgora.nome, pontos: total, proximo: nivelAgora.proximoNome,
      });
    }
  }
  return total;
};

/**
 * Concede UMA conquista automática a um aluno, de forma idempotente.
 * Usamos chaveContexto = '' → o aluno ganha a conquista UMA vez só
 * (o índice único da coleção é quem garante isso). O `contexto` guarda
 * o que disparou (disciplina/projeto) apenas para auditoria/exibição.
 */
const concederAutomatica = async ({ matricula, conquistaDoc, contexto = {}, chaveContexto = '' }) => {
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
      chaveContexto,
    });
  } catch (err) {
    // 11000 = já tinha a conquista → não duplica, não soma de novo
    if (err.code === 11000) return { concedida: false };
    throw err;
  }
  await notificarAluno(matricula, 'conquista', { nome: conquistaDoc.nome, pontos: conquistaDoc.pontos });
  await recalcularPontosAluno(matricula);
  return { concedida: true };
};

/**
 * ═══ SINCRONIZAÇÃO ════════════════════════════════════════════
 * Em vez de "dar" a conquista só no instante em que algo acontece (e
 * esquecer de quem já cumpria a regra antes dela existir), o motor
 * RECALCULA o que o aluno merece a partir dos fatos guardados no banco:
 *
 *   projeto_aceito            → solicitações aceitas (valor: '' | pesquisa | extensao)
 *   evento_presenca 'cada'    → UMA vez POR evento com presença validada
 *   evento_presenca N         → uma vez, ao somar N eventos validados
 *   conquista do próprio evento (painel ou SUAP) → uma vez por evento
 *
 * Concede o que falta e revoga o que deixou de valer (só concessões
 * automáticas: o que um professor deu na mão nunca é mexido aqui).
 * Conquistas desativadas não são revogadas — o histórico fica.
 * A regra 'nota' depende do boletim ao vivo e continua no login.
 *
 * Por isso funciona também DE TRÁS PARA FRENTE: criar uma regra nova,
 * trocar a conquista de um evento ou desfazer uma presença deixa todo
 * mundo certo.
 */
const TIPOS_SINCRONIZADOS = ['projeto_aceito', 'evento_presenca'];

/** O valor da regra de evento: 'cada' (a cada evento) ou um número N (ao somar N). */
const modoRegraEvento = (valor) => {
  const v = String(valor ?? '').trim().toLowerCase();
  if (v === 'cada' || v === '') return { cada: true };
  const n = parseInt(v, 10);
  return Number.isInteger(n) && n > 0 ? { cada: false, n } : { cada: true };
};

const chaveEvento = (p) => `evento:${p.origem}-${p.origem === 'local' ? p.evento : p.eventoSuapId}`;

const sincronizarAluno = async (matricula, { notificar = true } = {}) => {
  const vazio = { novas: [], removidas: 0 };
  if (!matricula) return vazio;
  // Carregados aqui para evitar dependência circular entre models e serviço
  const Evento = require('../models/Evento');
  const EventoSuap = require('../models/EventoSuap');

  const [regras, aceitas, presencas] = await Promise.all([
    Conquista.find({ ativa: true, origem: 'automatica', 'regra.tipo': { $in: TIPOS_SINCRONIZADOS } }).lean(),
    Solicitacao.find({ matricula, status: 'aceito' }).select('tipo').lean(),
    Presenca.find({ matricula, status: 'aprovada' }).select('origem evento eventoSuapId eventoNome').lean(),
  ]);

  // Conquista própria de cada evento em que o aluno tem presença validada
  const idsLocais = presencas.filter((p) => p.origem === 'local' && p.evento).map((p) => p.evento);
  const idsSuap = presencas.filter((p) => p.origem === 'suap').map((p) => p.eventoSuapId);
  const [evLocais, evSuap] = await Promise.all([
    idsLocais.length ? Evento.find({ _id: { $in: idsLocais } }).select('conquista').lean() : [],
    idsSuap.length ? EventoSuap.find({ suapId: { $in: idsSuap } }).select('suapId conquista').lean() : [],
  ]);
  const conqDoEvento = new Map([
    ...evLocais.map((e) => [`local-${e._id}`, e.conquista]),
    ...evSuap.map((e) => [`suap-${e.suapId}`, e.conquista]),
  ]);
  // Evento apagado do painel: a presença validada continua no histórico do
  // aluno — e a conquista que ele ganhou por ela também ("congelada")
  const congeladas = new Set(presencas.map((p) => chaveEvento(p)).filter((k) => !conqDoEvento.has(k.slice('evento:'.length))));
  const idsConqEvento = [...new Set([...conqDoEvento.values()].filter(Boolean).map(String))];
  const conqEventoDocs = idsConqEvento.length
    ? await Conquista.find({ _id: { $in: idsConqEvento }, ativa: true }).lean()
    : [];
  const docPorId = new Map([...regras, ...conqEventoDocs].map((c) => [String(c._id), c]));

  // ── O que o aluno DEVERIA ter ──
  const devido = new Map(); // `${conquistaId}|${chave}` → { conquista, chave, contexto }
  const deve = (c, chave, contexto) => devido.set(`${c._id}|${chave}`, { c, chave, contexto });

  for (const c of regras) {
    if (c.regra.tipo === 'projeto_aceito') {
      const validas = aceitas.filter((s) => !c.regra.valor || s.tipo === c.regra.valor);
      if (validas.length) deve(c, '', { gatilho: 'projeto_aceito', total: validas.length });
    } else if (c.regra.tipo === 'evento_presenca') {
      const modo = modoRegraEvento(c.regra.valor);
      if (modo.cada) presencas.forEach((p) => deve(c, chaveEvento(p), { gatilho: 'evento_presenca', evento: p.eventoNome }));
      else if (presencas.length >= modo.n) deve(c, '', { gatilho: 'evento_presenca', total: presencas.length });
    }
  }
  for (const p of presencas) {
    const id = conqDoEvento.get(chaveEvento(p).slice('evento:'.length));
    const c = id && docPorId.get(String(id));
    if (c) deve(c, chaveEvento(p), { gatilho: 'conquista_do_evento', evento: p.eventoNome });
  }

  // ── O que ele TEM (concessões automáticas que este motor administra) ──
  const idsRegras = new Set(regras.map((c) => String(c._id)));
  const atuais = await ConquistaUsuario.find({ matricula, origem: 'automatica' }).lean();
  const ativasIds = new Set((await Conquista.find({ _id: { $in: [...new Set(atuais.map((a) => a.conquista))] }, ativa: true }).select('_id').lean()).map((c) => String(c._id)));
  const administradas = atuais.filter((a) =>
    ativasIds.has(String(a.conquista)) &&
    (idsRegras.has(String(a.conquista)) || String(a.chaveContexto || '').startsWith('evento:')));
  const temChave = new Set(atuais.map((a) => `${a.conquista}|${a.chaveContexto || ''}`));
  // Concessões manuais também "contam" como já tidas (não duplicar)
  (await ConquistaUsuario.find({ matricula, origem: 'admin' }).select('conquista chaveContexto').lean())
    .forEach((a) => temChave.add(`${a.conquista}|${a.chaveContexto || ''}`));

  // ── Revoga o que não vale mais ──
  const remover = administradas
    .filter((a) => !devido.has(`${a.conquista}|${a.chaveContexto || ''}`) && !congeladas.has(a.chaveContexto))
    .map((a) => a._id);
  if (remover.length) await ConquistaUsuario.deleteMany({ _id: { $in: remover } });

  // ── Concede o que falta ──
  const novas = [];
  for (const [k, { c, chave, contexto }] of devido) {
    if (temChave.has(k)) continue;
    try {
      await ConquistaUsuario.create({
        matricula, conquista: c._id, nomeConquista: c.nome, pontos: c.pontos,
        status: 'confirmada', origem: 'automatica', concedidoPor: null, contexto, chaveContexto: chave,
      });
      novas.push(c.nome);
      if (notificar) await notificarAluno(matricula, 'conquista', { nome: c.nome, pontos: c.pontos });
    } catch (err) {
      if (err.code !== 11000) throw err; // 11000 = já existia (corrida) → tudo bem
    }
  }

  if (novas.length || remover.length) {
    await recalcularPontosAluno(matricula, { notificar: notificar && novas.length > 0 });
  }
  return { novas, removidas: remover.length };
};

/** Recalcula todos os alunos que podem ser afetados (regra nova/editada, conquista de evento trocada). */
const sincronizarTodos = async (filtroPresenca = null) => {
  const ConquistaUsuarioMat = await ConquistaUsuario.distinct('matricula', { origem: 'automatica' });
  const [deSolic, dePres] = await Promise.all([
    filtroPresenca ? [] : Solicitacao.distinct('matricula', { status: 'aceito' }),
    Presenca.distinct('matricula', { status: 'aprovada', ...(filtroPresenca || {}) }),
  ]);
  const matriculas = [...new Set([...deSolic, ...dePres, ...(filtroPresenca ? [] : ConquistaUsuarioMat)])];
  let afetados = 0;
  // Em lotes pequenos para não sobrecarregar o banco
  for (let i = 0; i < matriculas.length; i += 10) {
    const r = await Promise.all(matriculas.slice(i, i + 10).map((m) => sincronizarAluno(m, { notificar: false })));
    afetados += r.filter((x) => x.novas.length || x.removidas).length;
  }
  return { verificados: matriculas.length, afetados };
};

/** Só os alunos com presença validada em UM evento (troca da conquista do evento). */
const sincronizarAlunosDoEvento = (filtroEvento) => sincronizarTodos(filtroEvento);

// Atalhos usados pelos controllers (mantêm os nomes antigos)
const processarProjetoAceito = (sol) => sol?.matricula && sincronizarAluno(sol.matricula);
const reverterProjetoAceito = (sol) => sol?.matricula && sincronizarAluno(sol.matricula, { notificar: false });

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
  sincronizarAluno,
  sincronizarTodos,
  sincronizarAlunosDoEvento,
  modoRegraEvento,
  processarProjetoAceito,
  reverterProjetoAceito,
  processarBoletim,
};
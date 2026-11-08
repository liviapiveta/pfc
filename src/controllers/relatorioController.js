const crypto = require('crypto');
const ConquistaUsuario = require('../models/ConquistaUsuario');
const Solicitacao = require('../models/Solicitacao');
const Presenca = require('../models/Presenca');
const Evento = require('../models/Evento');
const EventoSuap = require('../models/EventoSuap');
const Relatorio = require('../models/Relatorio');
const { calcularNivel } = require('../services/niveis');
const { urlDoSite, enviarRelatorio } = require('../services/emailService');
const R = require('../services/relatorioPdf');
const { _rankearAlunos, _rankingVisivel } = require('./conquistaController');

/**
 * Relatório de desempenho do PRÓPRIO aluno (PDF), com:
 *  - período (?periodo=tudo | ano-AAAA | AAAA-1 | AAAA-2)
 *  - idioma (?idioma=pt | en)
 *  - horas dos eventos (carga horária cadastrada no painel)
 *  - QR Code + código para a página pública /verificar/<código>
 * Só usa registros confirmados/aprovados/aceitos.
 */

// Código sem letras que confundem (0/O, 1/I/L): ABCD-EFGH-JKMN
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const novoCodigo = () => {
  const b = crypto.randomBytes(12);
  let s = '';
  for (let i = 0; i < 12; i++) s += ALFABETO[b[i] % ALFABETO.length];
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
};
const codigoValido = (c) => /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(String(c || ''));

const baseUrl = (req) => urlDoSite() || `${req.protocol}://${req.get('host')}`;

/** Lê e valida as opções. Devolve { per, idioma } ou { erro }. */
const lerOpcoes = (src = {}) => {
  const per = R.lerPeriodo(src.periodo);
  if (!per) return { erro: 'Período inválido.' };
  const idioma = src.idioma === 'en' ? 'en' : 'pt';
  return { per, idioma };
};

const motivoDe = (c, idioma) => {
  const en = idioma === 'en';
  if (c.origem === 'admin') return en ? 'Awarded by a staff member' : 'Concedida por um servidor';
  if (c.contexto?.evento) return en ? `Attendance at "${c.contexto.evento}"` : `Presença em "${c.contexto.evento}"`;
  if (c.contexto?.gatilho === 'projeto_aceito') return en ? 'Project participation' : 'Participação em projeto';
  if (c.contexto?.disciplina) {
    const nota = c.contexto.nota != null ? ` (${c.contexto.nota})` : '';
    return en ? `Grade in ${c.contexto.disciplina}${nota}` : `Nota em ${c.contexto.disciplina}${nota}`;
  }
  return en ? 'Achievement unlocked' : 'Conquista desbloqueada';
};

/** Carga horária de cada evento das presenças (uma consulta por origem). */
const horasDosEventos = async (presencas) => {
  const locais = [...new Set(presencas.filter((p) => p.origem === 'local' && p.evento).map((p) => String(p.evento)))];
  const suaps = [...new Set(presencas.filter((p) => p.origem === 'suap' && p.eventoSuapId).map((p) => p.eventoSuapId))];
  const [evL, evS] = await Promise.all([
    locais.length ? Evento.find({ _id: { $in: locais } }).select('cargaHoraria').lean() : [],
    suaps.length ? EventoSuap.find({ suapId: { $in: suaps } }).select('suapId cargaHoraria').lean() : [],
  ]);
  const mapa = new Map();
  evL.forEach((e) => mapa.set(`local-${e._id}`, Number(e.cargaHoraria) || 0));
  evS.forEach((e) => mapa.set(`suap-${e.suapId}`, Number(e.cargaHoraria) || 0));
  return (p) => mapa.get(p.origem === 'local' ? `local-${p.evento}` : `suap-${p.eventoSuapId}`) || 0;
};

/** Reúne tudo e gera o PDF. Devolve { pdf, nomeArquivo, codigo }. */
const montar = async (req, { per, idioma }) => {
  const me = req.user;
  const meuId = String(me._id);

  const [todos, conquistasTodas, participacoes, presencas] = await Promise.all([
    _rankearAlunos({}),
    ConquistaUsuario.find({ matricula: me.matricula, status: 'confirmada' })
      .populate('conquista', 'categoria').sort({ createdAt: -1 }).lean(),
    Solicitacao.find({ matricula: me.matricula, status: 'aceito' }).sort({ decididoEm: -1, updatedAt: -1 }).lean(),
    Presenca.find({ matricula: me.matricula, status: 'aprovada' }).sort({ eventoData: -1, decididoEm: -1 }).lean(),
  ]);
  const { visiveis } = _rankingVisivel(todos, meuId);
  const meu = visiveis.find((u) => String(u._id) === meuId);

  // Nível e ranking são SEMPRE os atuais (todos os pontos); o resto segue o período
  const pontosTotais = conquistasTodas.reduce((t, c) => t + (Number(c.pontos) || 0), 0);
  const conquistas = conquistasTodas.filter((c) => R.noPeriodo(c.createdAt, per));
  const eventosPer = presencas.filter((p) => R.noPeriodo(p.eventoData || p.decididoEm || p.updatedAt, per));
  const projetosPer = participacoes.filter((s) => R.noPeriodo(s.decididoEm || s.updatedAt, per));
  const horasDe = await horasDosEventos(eventosPer);

  const listaConquistas = conquistas.map((c) => ({
    nome: c.nomeConquista || (idioma === 'en' ? 'Achievement' : 'Conquista'),
    categoria: c.conquista?.categoria || 'especial',
    motivo: motivoDe(c, idioma),
    data: c.createdAt,
    pontos: c.pontos || 0,
  }));
  const eventos = eventosPer.map((p) => ({
    nome: p.eventoNome || (idioma === 'en' ? '(event)' : '(evento)'),
    data: p.eventoData || p.decididoEm || '',
    metodo: p.metodo,
    horas: horasDe(p),
  }));
  const horas = eventos.reduce((t, e) => t + (Number(e.horas) || 0), 0);
  const pontosPeriodo = listaConquistas.reduce((t, c) => t + (Number(c.pontos) || 0), 0);
  const nivel = calcularNivel(pontosTotais);

  const resumo = {
    pontos: per.chave === 'tudo' ? pontosTotais : pontosPeriodo,
    nivel,
    posicao: meu ? meu.posicao : null, // null = escolheu ficar fora do ranking
    totalAlunos: visiveis.length,
    conquistas: listaConquistas.length,
    eventos: eventos.length,
    projetos: projetosPer.length,
    horas,
  };

  // Registro para a verificação: reaproveita o código se nada mudou desde o último igual
  const snapshot = {
    pontos: resumo.pontos, nivel: nivel.nivel, nivelNome: R.nomeNivel(nivel.nivel, idioma, nivel.nome),
    conquistas: resumo.conquistas, eventos: resumo.eventos, projetos: resumo.projetos, horas,
  };
  const emitidoEm = new Date();
  const [anterior] = await Relatorio.find({ matricula: me.matricula, periodo: per.chave, idioma, revogado: false })
    .sort({ emitidoEm: -1 }).limit(1).lean();
  const igual = anterior && anterior.nome === (me.nomeUsuario || '') && anterior.curso === (me.curso || '')
    && Object.keys(snapshot).every((k) => String(anterior.resumo?.[k]) === String(snapshot[k]));
  let codigo;
  if (igual) {
    codigo = anterior.codigo;
    await Relatorio.updateOne({ _id: anterior._id }, { $set: { emitidoEm } });
  } else {
    for (let tentativa = 0; tentativa < 3 && !codigo; tentativa++) {
      try {
        const c = novoCodigo();
        await Relatorio.create({
          codigo: c, matricula: me.matricula, nome: me.nomeUsuario || '', curso: me.curso || '',
          idioma, periodo: per.chave, periodoRotulo: per.rotulo[idioma], resumo: snapshot, emitidoEm,
        });
        codigo = c;
      } catch (e) {
        if (e.code !== 11000) throw e; // código repetido (raríssimo): tenta outro
      }
    }
    if (!codigo) throw new Error('Não foi possível gerar o código de verificação');
  }

  const pdf = await R.gerarRelatorio({
    idioma,
    periodo: per.chave,
    periodoRotulo: per.rotulo[idioma],
    emitidoEm,
    aluno: { nome: me.nomeUsuario || (idioma === 'en' ? 'Student' : 'Estudante'), curso: me.curso || '', matricula: me.matricula },
    resumo,
    pontosPorMes: R.pontosPorMes(listaConquistas, per),
    conquistas: listaConquistas,
    eventos,
    projetos: projetosPer.map((s) => ({ titulo: s.projetoTitulo || '(projeto)', tipo: s.tipo, data: s.decididoEm || s.updatedAt })),
    verificacao: { codigo, url: `${baseUrl(req)}/verificar/${codigo}` },
  });

  // Nome do arquivo só com letras simples (alguns navegadores estragam acentos)
  const primeiro = String(me.nomeUsuario || 'estudante').split(/\s+/)[0]
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]/g, '').toLowerCase() || 'estudante';
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(emitidoEm);
  const sufixo = [per.chave !== 'tudo' ? per.chave : '', idioma === 'en' ? 'en' : ''].filter(Boolean).join('-');
  const nomeArquivo = `${idioma === 'en' ? 'report' : 'relatorio'}-ifplenus-${primeiro}${sufixo ? `-${sufixo}` : ''}-${hoje}.pdf`;
  return { pdf, nomeArquivo, codigo };
};

/** GET /api/relatorio.pdf?periodo=&idioma=&ver=1 */
const baixar = async (req, res) => {
  const op = lerOpcoes(req.query);
  if (op.erro) return res.status(400).json({ erro: op.erro });
  try {
    const { pdf, nomeArquivo } = await montar(req, op);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Length': pdf.length,
      'Content-Disposition': `${req.query.ver === '1' ? 'inline' : 'attachment'}; filename="${nomeArquivo}"`,
      'Cache-Control': 'private, no-store',
    });
    return res.send(pdf);
  } catch (err) {
    console.error('Erro ao gerar relatório PDF:', err.message);
    return res.status(500).json({ erro: 'Não foi possível gerar o relatório agora. Tente de novo em instantes.' });
  }
};

/** POST /api/relatorio/email  body: { periodo, idioma } — manda o PDF para o e-mail do aluno */
const enviarPorEmail = async (req, res) => {
  const op = lerOpcoes(req.body || {});
  if (op.erro) return res.status(400).json({ erro: op.erro });
  const email = String(req.user.email || '').trim();
  if (!email) return res.status(400).json({ erro: 'Não encontramos um e-mail no seu cadastro do SUAP.' });
  try {
    const { pdf, nomeArquivo } = await montar(req, op);
    await enviarRelatorio({ email, nome: req.user.nomeUsuario, pdf, nomeArquivo, idioma: op.idioma, periodoRotulo: op.per.rotulo[op.idioma] });
    // Mostra o e-mail só parcialmente (ex.: an***@estudantes.ifpr.edu.br)
    const [u, d] = email.split('@');
    return res.json({ sucesso: true, email: `${u.slice(0, 2)}***@${d || ''}` });
  } catch (err) {
    console.error('Erro ao enviar relatório por e-mail:', err.message);
    return res.status(502).json({ erro: 'Não foi possível enviar o e-mail agora. Baixe o PDF ou tente mais tarde.' });
  }
};

/** GET /api/publico/verificar/:codigo — dados públicos de um relatório (sem matrícula). */
const verificar = async (req, res) => {
  const codigo = String(req.params.codigo || '').toUpperCase().trim();
  res.set('Cache-Control', 'no-store');
  if (!codigoValido(codigo)) return res.status(404).json({ valido: false });
  try {
    const r = await Relatorio.findOne({ codigo }).lean();
    if (!r || r.revogado) return res.status(404).json({ valido: false });
    return res.json({
      valido: true,
      codigo: r.codigo,
      nome: r.nome,
      curso: r.curso,
      idioma: r.idioma,
      periodoRotulo: r.periodoRotulo,
      emitidoEm: r.emitidoEm,
      resumo: r.resumo,
    });
  } catch (err) {
    console.error('Erro ao verificar relatório:', err.message);
    return res.status(500).json({ erro: 'Não foi possível verificar agora.' });
  }
};

module.exports = { baixar, enviarPorEmail, verificar, novoCodigo, codigoValido };

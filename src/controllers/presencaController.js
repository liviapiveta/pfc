const mongoose = require('mongoose');
const Evento = require('../models/Evento');
const EventoSuap = require('../models/EventoSuap');
const Conquista = require('../models/Conquista');
const Presenca = require('../models/Presenca');
const Comprovante = require('../models/Comprovante');
const suapService = require('../services/suapService');
const conquistaEngine = require('../services/conquistaEngine');
const { notificarAluno } = require('../services/notificacoes');
const { registrar } = require('../services/auditoria');
const P = require('../services/presencaService');

/**
 * Eventos + validação de presença.
 *
 * Vale igual para os eventos do SUAP e os cadastrados no painel:
 *  - QR Code: o aluno envia (print/foto/câmera) o QR que recebeu no
 *    e-mail de INSCRIÇÃO do evento. O IFPlenus confere o QR — não gera QR.
 *  - Certificado: o aluno envia o PDF/foto; um professor confere.
 *
 * Qualquer professor pode decidir qualquer presença (quem cadastra os
 * eventos do campus normalmente é a coordenação, não o professor).
 */

const resumoPresenca = (p) => p && ({
  status: p.status,
  metodo: p.metodo,
  motivo: p.status === 'recusada' ? (p.motivo || '') : '',
  arquivo: p.metodo === 'certificado' ? (p.arquivo?.nome || '') : '',
  arquivoTipo: p.metodo === 'certificado' ? (p.arquivo?.tipo || '') : '',
  // O próprio aluno pode rever o que leu do QR (o hash fica só no servidor)
  qrConteudo: p.metodo === 'qrcode' ? String(p.qrConteudo || '').slice(0, 500) : '',
  conferidoPor: p.status !== 'pendente' ? (p.decididoPorNome || '') : '',
  decididoEm: p.status !== 'pendente' ? (p.decididoEm || p.updatedAt) : null,
  atualizadoEm: p.updatedAt,
});

// Configuração de validação com os padrões preenchidos
const validacaoDe = (v = {}) => ({
  certificado: v.certificado !== false,
  qrcode: v.qrcode !== false,
  qrPadrao: String(v.qrPadrao || ''),
  qrConferir: !!v.qrConferir,
});

const conquistaPublica = (c) => (c && c.ativa !== false
  ? { nome: c.nome, pontos: c.pontos || 0, icone: c.icone || '🏆' }
  : null);

// ── Espelho dos eventos do SUAP ────────────────────────────────

const dadosSuap = (ev) => ({
  nome: String(ev.nome || ev.titulo || 'Evento do SUAP').slice(0, 300),
  apresentacao: String(ev.apresentacao || ev.descricao || '').slice(0, 5000),
  data_inicio: P.diaDe(ev.data_inicio || ev.data),
  data_fim: P.diaDe(ev.data_fim),
  periodo_formatado: String(ev.periodo_formatado || '').slice(0, 120),
  local: String(ev.local || ev.localizacao || '').slice(0, 300),
  campus: typeof ev.campus === 'string' ? ev.campus.slice(0, 200) : '',
  link_suap: /^https?:\/\//i.test(String(ev.link_suap || '')) ? String(ev.link_suap).slice(0, 500) : null,
});

/**
 * Busca os eventos do SUAP e atualiza o espelho (sem mexer na configuração).
 * Se o SUAP falhar, devolve o que está no espelho — o aluno não fica sem lista.
 */
const eventosSuapAtualizados = async (token) => {
  let lista = null;
  try {
    const r = await suapService.getEventosDoCampus(token);
    lista = Array.isArray(r) ? r : [];
  } catch (e) {
    console.warn('Eventos: SUAP indisponível, usando o espelho:', e.response?.status || e.message);
  }

  if (lista) {
    const ops = lista
      .filter((ev) => Number.isInteger(Number(ev.id)) && Number(ev.id) > 0)
      .map((ev) => ({
        updateOne: {
          filter: { suapId: Number(ev.id) },
          update: { $set: { ...dadosSuap(ev), vistoEm: new Date() } },
          upsert: true,
        },
      }));
    if (ops.length) {
      await EventoSuap.bulkWrite(ops, { ordered: false })
        .catch((e) => console.warn('Falha ao atualizar espelho de eventos SUAP:', e.message));
    }
  }

  const ids = lista ? lista.map((ev) => Number(ev.id)).filter((n) => n > 0) : null;
  const espelho = await EventoSuap.find(ids ? { suapId: { $in: ids } } : {})
    .populate('conquista', 'nome pontos icone ativa').lean();
  const porId = new Map(espelho.map((e) => [e.suapId, e]));

  // Eventos sem id (não dá para validar) continuam aparecendo, só para consulta
  const semId = lista ? lista.filter((ev) => !(Number(ev.id) > 0)).map((ev) => ({ ...dadosSuap(ev), suapId: null })) : [];
  const comId = (ids ? ids.map((id) => porId.get(id)).filter(Boolean) : espelho).filter((e) => !e.oculto);
  return [...comId, ...semId];
};

// ── ALUNO ──────────────────────────────────────────────────────

const itemEvento = (origem, ev, minha, hoje) => {
  const id = origem === 'local' ? ev._id : ev.suapId;
  const chave = id ? P.chaveDe(origem, id) : null;
  const v = validacaoDe(ev.validacao);
  return {
    chave,
    origem: origem === 'local' ? 'admin' : 'suap',
    nome: ev.nome,
    apresentacao: ev.apresentacao || '',
    data_inicio: ev.data_inicio,
    data_fim: ev.data_fim,
    periodo_formatado: ev.periodo_formatado || '',
    hora_inicio: ev.hora_inicio || null,
    hora_fim: ev.hora_fim || null,
    local: ev.local || '',
    campus: ev.campus || '',
    link_suap: ev.link_suap || null,
    validacao: chave ? { certificado: v.certificado, qrcode: v.qrcode } : { certificado: false, qrcode: false },
    conquista: conquistaPublica(ev.conquista),
    jaComecou: P.jaComecou(ev, hoje),
    qrNoPrazo: P.qrNoPrazo(ev),
    minhaPresenca: chave ? resumoPresenca(minha.get(chave)) : null,
  };
};

/** GET /api/eventos — eventos do SUAP + do painel, com a presença do aluno em cada um. */
const listarEventos = async (req, res) => {
  try {
    const hoje = P.hojeSP();
    const [suap, locais, minhas] = await Promise.all([
      eventosSuapAtualizados(req.user.suapToken),
      Evento.find().populate('conquista', 'nome pontos icone ativa').sort({ data_inicio: 1 }).lean(),
      Presenca.find({ matricula: req.user.matricula }).lean(),
    ]);
    const minha = new Map(minhas.map((p) =>
      [P.chaveDe(p.origem, p.origem === 'local' ? p.evento : p.eventoSuapId), p]));

    return res.json([
      ...suap.map((ev) => itemEvento('suap', ev, minha, hoje)),
      ...locais.map((ev) => itemEvento('local', ev, minha, hoje)),
    ]);
  } catch (err) {
    console.error('Erro ao listar eventos:', err.message);
    return res.status(500).json({ erro: 'Erro ao carregar eventos' });
  }
};

/** Acha o evento pela chave da URL (o do SUAP vem do espelho — dados do servidor, não do aluno). */
const acharEvento = async (chave) => {
  const k = P.lerChave(chave);
  if (!k) return null;
  const ev = k.origem === 'local'
    ? await Evento.findById(k.id).lean()
    : await EventoSuap.findOne({ suapId: k.id }).lean();
  return ev && !ev.oculto ? { origem: k.origem, id: k.id, ev, validacao: validacaoDe(ev.validacao) } : null;
};

const filtroDoEvento = (alvo, matricula) => (alvo.origem === 'local'
  ? { origem: 'local', evento: alvo.ev._id, matricula }
  : { origem: 'suap', eventoSuapId: alvo.id, matricula });

const camposBase = (req, alvo) => ({
  matricula: req.user.matricula,
  nomeAluno: req.user.nomeUsuario || '',
  curso: req.user.curso || '',
  origem: alvo.origem,
  evento: alvo.origem === 'local' ? alvo.ev._id : null,
  eventoSuapId: alvo.origem === 'suap' ? alvo.id : null,
  eventoNome: String(alvo.ev.nome || '').slice(0, 300),
  eventoData: String(alvo.ev.data_inicio || '').slice(0, 30),
});

/**
 * POST /api/eventos/:chave/qrcode   body: { conteudo }
 * O aluno manda o conteúdo do QR do e-mail de inscrição (lido no navegador).
 */
const validarPorQr = async (req, res) => {
  try {
    const alvo = await acharEvento(req.params.chave);
    if (!alvo) return res.status(404).json({ erro: 'Evento não encontrado' });
    if (!alvo.validacao.qrcode) return res.status(400).json({ erro: 'Este evento não aceita validação por QR Code.' });

    const filtro = filtroDoEvento(alvo, req.user.matricula);
    const antes = await Presenca.findOne(filtro).lean();
    if (antes?.status === 'aprovada') return res.json({ sucesso: true, jaValidada: true, presenca: resumoPresenca(antes) });

    if (!P.jaComecou(alvo.ev)) return res.status(400).json({ erro: 'Você só pode validar depois que o evento começar.' });
    if (!P.qrNoPrazo(alvo.ev)) {
      return res.status(400).json({ erro: `O prazo para validar pelo QR Code acabou (${P.PRAZO_QR_DIAS} dias após o evento). Envie o certificado.` });
    }

    const conteudo = P.limparQr(req.body?.conteudo);
    if (!conteudo) return res.status(400).json({ erro: 'Não conseguimos ler esse QR Code. Tente outra foto.' });

    const avaliacao = P.avaliarQr(conteudo, alvo.validacao);
    if (avaliacao.status === 'recusar') {
      return res.status(400).json({ erro: 'Esse QR Code não é da inscrição deste evento. Confira se enviou o QR certo.' });
    }

    // O mesmo QR não valida duas vezes (outro aluno, ou outro evento)
    const qrHash = P.hashQr(conteudo);
    const usado = await Presenca.findOne({ qrHash, _id: { $ne: antes?._id } }).select('matricula').lean();
    if (usado) {
      return res.status(409).json({
        erro: usado.matricula === req.user.matricula
          ? 'Você já usou este QR Code para validar outro evento.'
          : 'Este QR Code já foi usado por outro aluno. Se a inscrição é sua, procure a coordenação.',
      });
    }

    const pres = await Presenca.findOneAndUpdate(
      filtro,
      {
        $set: {
          ...camposBase(req, alvo),
          metodo: 'qrcode', status: avaliacao.status, motivo: '',
          qrConteudo: conteudo.slice(0, 2000), qrHash, observacao: avaliacao.observacao,
          arquivo: { nome: '', tipo: '', tamanho: 0 },
          decididoPor: null,
          decididoPorNome: avaliacao.status === 'aprovada' ? 'QR Code (automático)' : '',
          decididoEm: avaliacao.status === 'aprovada' ? new Date() : null,
        },
      },
      { upsert: true, returnDocument: 'after' }
    );
    // Se havia um certificado esperando, ele não é mais necessário
    if (antes) await Comprovante.deleteOne({ presenca: antes._id });

    if (pres.status === 'aprovada') await conquistaEngine.sincronizarAluno(pres.matricula);
    return res.json({ sucesso: true, presenca: resumoPresenca(pres) });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ erro: 'Este QR Code já foi usado.' });
    console.error('Erro na validação por QR:', err.message);
    return res.status(500).json({ erro: 'Erro ao validar presença' });
  }
};

/**
 * POST /api/eventos/:chave/certificado
 * Corpo = o próprio arquivo (PDF/JPG/PNG/WEBP), Content-Type do arquivo,
 * nome no cabeçalho X-Nome-Arquivo. Fica pendente até um professor decidir.
 */
const enviarCertificado = async (req, res) => {
  try {
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || !buf.length) {
      return res.status(400).json({ erro: 'Envie o certificado em PDF ou imagem (JPG, PNG).' });
    }
    if (buf.length > P.TAM_MAX_ARQUIVO) return res.status(413).json({ erro: 'O arquivo passa de 4 MB.' });
    const tipo = P.tipoReal(buf);
    if (!tipo) return res.status(400).json({ erro: 'Formato não aceito. Envie PDF, JPG ou PNG.' });

    const alvo = await acharEvento(req.params.chave);
    if (!alvo) return res.status(404).json({ erro: 'Evento não encontrado' });
    if (!alvo.validacao.certificado) return res.status(400).json({ erro: 'Este evento não aceita certificado — valide pelo QR Code.' });
    if (!P.jaComecou(alvo.ev)) return res.status(400).json({ erro: 'Você só pode validar depois que o evento começar.' });

    const filtro = filtroDoEvento(alvo, req.user.matricula);
    const antes = await Presenca.findOne(filtro).lean();
    if (antes?.status === 'aprovada') return res.status(409).json({ erro: 'Sua presença neste evento já está validada.' });

    const arquivo = { nome: P.nomeArquivoSeguro(req.get('x-nome-arquivo'), tipo), tipo, tamanho: buf.length };
    const pres = await Presenca.findOneAndUpdate(
      filtro,
      {
        $set: {
          ...camposBase(req, alvo),
          metodo: 'certificado', status: 'pendente', motivo: '', arquivo,
          qrConteudo: '', qrHash: null, observacao: '',
          decididoPor: null, decididoPorNome: '', decididoEm: null,
        },
      },
      { upsert: true, returnDocument: 'after' }
    );
    await Comprovante.findOneAndUpdate(
      { presenca: pres._id },
      { $set: { presenca: pres._id, tipo, dados: buf } },
      { upsert: true }
    );
    return res.status(201).json({ sucesso: true, presenca: resumoPresenca(pres) });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ erro: 'Envio repetido — aguarde um instante e recarregue.' });
    console.error('Erro ao enviar certificado:', err.message);
    return res.status(500).json({ erro: 'Erro ao enviar certificado' });
  }
};

/** DELETE /api/eventos/:chave/presenca — aluno cancela um envio pendente/recusado */
const cancelarPresenca = async (req, res) => {
  try {
    const k = P.lerChave(req.params.chave);
    if (!k) return res.status(404).json({ erro: 'Evento não encontrado' });
    const filtro = k.origem === 'local'
      ? { origem: 'local', evento: k.id, matricula: req.user.matricula }
      : { origem: 'suap', eventoSuapId: k.id, matricula: req.user.matricula };
    const pres = await Presenca.findOneAndDelete({ ...filtro, status: { $in: ['pendente', 'recusada'] } });
    if (pres) await Comprovante.deleteOne({ presenca: pres._id });
    return res.json({ sucesso: true });
  } catch (err) {
    console.error('Erro ao cancelar presença:', err.message);
    return res.status(500).json({ erro: 'Erro ao cancelar' });
  }
};

// ── PAINEL ─────────────────────────────────────────────────────

/** GET /api/admin/presencas?status=pendente|aprovada|recusada — todos os professores veem tudo */
const listarPresencas = async (req, res) => {
  try {
    const filtro = {};
    if (['pendente', 'aprovada', 'recusada'].includes(req.query.status)) filtro.status = req.query.status;
    const lista = await Presenca.find(filtro).sort({ updatedAt: -1 }).limit(500).lean();
    return res.json(lista.map(({ qrHash, ...p }) => p)); // o hash é só para o servidor
  } catch (err) {
    console.error('Erro ao listar presenças:', err.message);
    return res.status(500).json({ erro: 'Erro ao listar presenças' });
  }
};

// Envia o arquivo do certificado de uma presença (para o professor ou o próprio aluno)
const enviarArquivoDe = async (pres, res) => {
  // Sem .lean(): assim o Mongoose devolve um Buffer de verdade (e não um Binary do BSON)
  const arq = await Comprovante.findOne({ presenca: pres._id });
  if (!arq || !arq.dados) return res.status(404).json({ erro: 'Certificado não encontrado' });
  const dados = Buffer.from(arq.dados);
  if (!P.TIPOS_ARQUIVO.includes(arq.tipo) || P.tipoReal(dados) !== arq.tipo) {
    return res.status(415).json({ erro: 'Arquivo inválido' });
  }
  res.set({
    'Content-Type': arq.tipo,
    'Content-Length': String(dados.length),
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(pres.arquivo?.nome || 'certificado')}`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  return res.end(dados);
};

/** GET /api/admin/presencas/:id/arquivo — abre o certificado enviado */
const verArquivo = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ erro: 'Certificado não encontrado' });
    const pres = await Presenca.findById(req.params.id).lean();
    if (!pres) return res.status(404).json({ erro: 'Certificado não encontrado' });
    return await enviarArquivoDe(pres, res);
  } catch (err) {
    console.error('Erro ao abrir certificado:', err.message);
    return res.status(500).json({ erro: 'Erro ao abrir certificado' });
  }
};

/** GET /api/eventos/:chave/comprovante — o aluno revê o certificado que ELE enviou */
const verMeuComprovante = async (req, res) => {
  try {
    const k = P.lerChave(req.params.chave);
    if (!k) return res.status(404).json({ erro: 'Certificado não encontrado' });
    const filtro = k.origem === 'local'
      ? { origem: 'local', evento: k.id, matricula: req.user.matricula }
      : { origem: 'suap', eventoSuapId: k.id, matricula: req.user.matricula };
    const pres = await Presenca.findOne({ ...filtro, metodo: 'certificado' }).lean();
    if (!pres) return res.status(404).json({ erro: 'Certificado não encontrado' });
    return await enviarArquivoDe(pres, res);
  } catch (err) {
    console.error('Erro ao abrir comprovante do aluno:', err.message);
    return res.status(500).json({ erro: 'Erro ao abrir certificado' });
  }
};

/**
 * PUT /api/admin/presencas/:id   body: { status: 'aprovada'|'recusada', motivo? }
 * Também serve para DESFAZER (aprovada → recusada): as conquistas são recalculadas.
 */
const decidirPresenca = async (req, res) => {
  try {
    const { status } = req.body || {};
    if (!['aprovada', 'recusada'].includes(status)) return res.status(400).json({ erro: 'Status inválido' });
    const motivo = String(req.body?.motivo || '').trim().slice(0, 300);

    const atual = await Presenca.findById(req.params.id).lean();
    if (!atual) return res.status(404).json({ erro: 'Presença não encontrada' });
    if (atual.status === status) return res.json({ sucesso: true, semMudanca: true });
    if (status === 'aprovada' && atual.metodo === 'certificado' && !(await Comprovante.exists({ presenca: atual._id }))) {
      return res.status(400).json({ erro: 'Este pedido não tem certificado anexado.' });
    }

    const pres = await Presenca.findByIdAndUpdate(
      atual._id,
      { $set: { status, motivo: status === 'recusada' ? motivo : '', decididoPor: req.admin.id, decididoPorNome: req.admin.nome || '', decididoEm: new Date() } },
      { returnDocument: 'after' }
    );

    // Aprovar concede; desfazer revoga — o motor recalcula tudo do aluno
    // Com notificar:false o motor não manda um e-mail por conquista — o
    // e-mail da presença já cita o que ele ganhou (um e-mail só)
    const { novas } = await conquistaEngine.sincronizarAluno(pres.matricula, { notificar: false });

    notificarAluno(pres.matricula, 'presenca', { status, eventoNome: pres.eventoNome, motivo, conquista: [...new Set(novas)].join(', ') });
    registrar(req, `presenca.${status === 'aprovada' ? 'aprovar' : 'recusar'}`, pres.eventoNome, { aluno: pres.matricula, metodo: pres.metodo });
    return res.json({ sucesso: true, presenca: pres });
  } catch (err) {
    console.error('Erro ao decidir presença:', err.message);
    return res.status(500).json({ erro: 'Erro ao salvar decisão' });
  }
};

// ── Configuração dos eventos do SUAP (qualquer professor) ─────

/**
 * Conquista que pode ser escolhida para um evento: categoria "Evento" e que
 * não seja uma regra automática de OUTRA coisa (projeto, nota) nem a regra
 * "ao completar N eventos" (essa já é contada sozinha, para todos os eventos).
 */
const { conquistaServeParaEvento } = P;

/** Lê validação + conquista do corpo da requisição (lista branca). Devolve { dados } ou { erro }. */
const lerConfigEvento = async (body = {}) => {
  const dados = {};
  if (body.validacao !== undefined) {
    const v = body.validacao || {};
    const padrao = String(v.qrPadrao || '').trim().slice(0, 300);
    dados.validacao = { certificado: v.certificado !== false, qrcode: v.qrcode !== false, qrPadrao: padrao, qrConferir: v.qrConferir === true };
    if (!dados.validacao.certificado && !dados.validacao.qrcode) {
      return { erro: 'Deixe pelo menos uma forma de validar a presença (certificado ou QR Code).' };
    }
  }
  if (body.conquista !== undefined) {
    if (!body.conquista) dados.conquista = null;
    else {
      if (!mongoose.isValidObjectId(body.conquista)) return { erro: 'Conquista inválida' };
      const c = await Conquista.findById(body.conquista).select('_id ativa categoria origem regra').lean();
      if (!c || c.ativa === false) return { erro: 'Conquista não encontrada' };
      if (!conquistaServeParaEvento(c)) {
        return { erro: 'Só conquistas da categoria "Evento" podem ser dadas por um evento.' };
      }
      dados.conquista = c._id;
    }
  }
  return { dados };
};

/** Contagem de presenças por evento (para as tabelas do painel). */
const contagem = async (campo, ids) => {
  if (!ids.length) return {};
  const valores = campo === 'evento' ? ids.map((i) => new mongoose.Types.ObjectId(String(i))) : ids;
  const rows = await Presenca.aggregate([
    { $match: { [campo]: { $in: valores } } },
    { $group: { _id: { e: `$${campo}`, s: '$status' }, n: { $sum: 1 } } },
  ]);
  const out = {};
  rows.forEach((r) => {
    const k = String(r._id.e);
    out[k] = out[k] || { aprovada: 0, pendente: 0, recusada: 0 };
    out[k][r._id.s] = r.n;
  });
  return out;
};
const contagemPorEvento = (ids) => contagem('evento', ids);

/** GET /api/admin/eventos-suap — eventos do SUAP já vistos pelos alunos, com a configuração */
const listarEventosSuap = async (req, res) => {
  try {
    const lista = await EventoSuap.find().populate('conquista', 'nome pontos icone').sort({ data_inicio: -1 }).limit(300).lean();
    const cont = await contagem('eventoSuapId', lista.map((e) => e.suapId));
    return res.json(lista.map((e) => ({
      ...e,
      validacao: validacaoDe(e.validacao),
      presencas: cont[String(e.suapId)] || { aprovada: 0, pendente: 0, recusada: 0 },
    })));
  } catch (err) {
    console.error('Erro ao listar eventos do SUAP:', err.message);
    return res.status(500).json({ erro: 'Erro ao listar eventos do SUAP' });
  }
};

/** PUT /api/admin/eventos-suap/:suapId   body: { validacao?, conquista? } */
const configurarEventoSuap = async (req, res) => {
  try {
    const suapId = Number(req.params.suapId);
    if (!Number.isInteger(suapId) || suapId <= 0) return res.status(404).json({ erro: 'Evento não encontrado' });
    const atual = await EventoSuap.findOne({ suapId }).lean();
    if (!atual) return res.status(404).json({ erro: 'Evento não encontrado' });

    const { dados, erro } = await lerConfigEvento(req.body);
    if (erro) return res.status(400).json({ erro });
    if (typeof req.body?.oculto === 'boolean') dados.oculto = req.body.oculto;
    const ev = await EventoSuap.findOneAndUpdate({ suapId }, { $set: dados }, { returnDocument: 'after' }).lean();

    // Trocou a conquista do evento → quem já tem presença validada ganha a nova (e perde a antiga)
    if ('conquista' in dados && String(dados.conquista || '') !== String(atual.conquista || '')) {
      await conquistaEngine.sincronizarAlunosDoEvento({ origem: 'suap', eventoSuapId: suapId });
    }
    registrar(req, 'oculto' in dados ? (dados.oculto ? 'evento.ocultar' : 'evento.mostrar') : 'evento.configurar', ev.nome, { suapId });
    return res.json(ev);
  } catch (err) {
    console.error('Erro ao configurar evento do SUAP:', err.message);
    return res.status(500).json({ erro: 'Erro ao salvar' });
  }
};

/** POST /api/admin/eventos/padrao-qr  body: { exemplo } — sugere o padrão a partir de um QR de exemplo */
const sugerirPadraoQr = (req, res) => {
  const padrao = P.sugerirPadrao(req.body?.exemplo);
  if (!padrao) return res.status(400).json({ erro: 'Não deu para tirar um padrão desse QR. Digite o começo do conteúdo à mão.' });
  return res.json({ padrao });
};

module.exports = {
  listarEventos, validarPorQr, enviarCertificado, cancelarPresenca,
  listarPresencas, verArquivo, verMeuComprovante, decidirPresenca,
  listarEventosSuap, configurarEventoSuap, sugerirPadraoQr,
  lerConfigEvento, contagemPorEvento, validacaoDe, conquistaServeParaEvento,
};

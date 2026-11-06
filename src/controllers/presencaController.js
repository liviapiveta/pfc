const mongoose = require('mongoose');
const QRCode = require('qrcode');
const Evento = require('../models/Evento');
const Presenca = require('../models/Presenca');
const Comprovante = require('../models/Comprovante');
const suapService = require('../services/suapService');
const conquistaEngine = require('../services/conquistaEngine');
const { notificarAluno } = require('../services/notificacoes');
const { registrar } = require('../services/auditoria');
const { urlDoSite } = require('../services/emailService');
const P = require('../services/presencaService');

/**
 * Eventos + validação de presença.
 *
 * Aluno:  vê os eventos (painel + SUAP) e valida a presença por
 *         QR Code (na hora) ou enviando o certificado (PDF/foto → professor aprova).
 * Painel: configura como cada evento é validado, mostra o QR e decide os certificados.
 */

const ehDev = (req) => req.admin?.cargo === 'desenvolvedor';
const podeGerirEvento = (req, ev) => ehDev(req) || !!(ev && ev.criadoPor === req.admin.id);

// Professor vê as presenças dos eventos que cadastrou + as dos eventos do SUAP
// (que não têm "dono" no painel). A desenvolvedora vê tudo.
const filtroMinhasPresencas = (req) =>
  ehDev(req) ? {} : { $or: [{ origem: 'suap' }, { eventoCriadoPor: req.admin.id }] };
const podeDecidir = (req, p) =>
  ehDev(req) || p.origem === 'suap' || p.eventoCriadoPor === req.admin.id;

const resumoPresenca = (p) => p && ({
  status: p.status,
  metodo: p.metodo,
  motivo: p.status === 'recusada' ? (p.motivo || '') : '',
  arquivo: p.metodo === 'certificado' ? (p.arquivo?.nome || '') : '',
  atualizadoEm: p.updatedAt,
});

/** Eventos do SUAP do campus (sem derrubar a lista se o SUAP falhar). */
const eventosSuap = async (token) => {
  try {
    const lista = await suapService.getEventosDoCampus(token);
    return Array.isArray(lista) ? lista : [];
  } catch (e) {
    console.warn('Eventos: SUAP indisponível:', e.response?.status || e.message);
    return [];
  }
};

// ── ALUNO ──────────────────────────────────────────────────────

/** GET /api/eventos — eventos do painel + do SUAP, com a presença do aluno em cada um. */
const listarEventos = async (req, res) => {
  try {
    const hoje = P.hojeSP();
    const [suap, locais, minhas] = await Promise.all([
      eventosSuap(req.user.suapToken),
      Evento.find().populate('conquista', 'nome pontos icone ativa').sort({ data_inicio: 1 }).lean(),
      Presenca.find({ matricula: req.user.matricula }).lean(),
    ]);

    const porChave = new Map(minhas.map((p) =>
      [P.chaveDe(p.origem, p.origem === 'local' ? p.evento : p.eventoSuapId), p]));

    const itensLocais = locais.map((ev) => {
      const chave = P.chaveDe('local', ev._id);
      const v = ev.validacao || {};
      return {
        chave,
        origem: 'admin',
        nome: ev.nome,
        apresentacao: ev.apresentacao || '',
        data_inicio: ev.data_inicio,
        data_fim: ev.data_fim,
        hora_inicio: ev.hora_inicio,
        hora_fim: ev.hora_fim,
        local: ev.local,
        campus: ev.campus,
        link_suap: ev.link_suap,
        validacao: { certificado: v.certificado !== false, qrcode: !!v.qrcode },
        conquista: ev.conquista && ev.conquista.ativa !== false
          ? { nome: ev.conquista.nome, pontos: ev.conquista.pontos || 0, icone: ev.conquista.icone || '🏆' }
          : null,
        jaComecou: P.jaComecou(ev, hoje),
        acontecendo: P.acontecendo(ev, hoje),
        minhaPresenca: resumoPresenca(porChave.get(chave)),
      };
    });

    const itensSuap = suap.map((ev) => {
      const id = Number(ev.id);
      const temId = Number.isInteger(id) && id > 0;
      const chave = temId ? P.chaveDe('suap', id) : null;
      return {
        ...ev,
        chave,
        origem: 'suap',
        // Eventos do SUAP não têm QR do IFPlenus: só certificado
        validacao: { certificado: temId, qrcode: false },
        conquista: null,
        jaComecou: P.jaComecou(ev, hoje),
        acontecendo: P.acontecendo(ev, hoje),
        minhaPresenca: chave ? resumoPresenca(porChave.get(chave)) : null,
      };
    });

    return res.json([...itensSuap, ...itensLocais]);
  } catch (err) {
    console.error('Erro ao listar eventos:', err.message);
    return res.status(500).json({ erro: 'Erro ao carregar eventos' });
  }
};

/** Acha o evento pela chave da URL. Para o SUAP, confere na lista real do campus. */
const acharEvento = async (req, chave) => {
  const k = P.lerChave(chave);
  if (!k) return null;
  if (k.origem === 'local') {
    const ev = await Evento.findById(k.id).select('+qrSegredo').lean();
    return ev ? { origem: 'local', ev, nome: ev.nome, data: ev.data_inicio } : null;
  }
  const lista = await eventosSuap(req.user.suapToken);
  const ev = lista.find((e) => Number(e.id) === k.id);
  return ev ? { origem: 'suap', ev, id: k.id, nome: ev.nome || ev.titulo || 'Evento do SUAP', data: ev.data_inicio || ev.data || '' } : null;
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
  eventoNome: String(alvo.nome || '').slice(0, 300),
  eventoData: String(alvo.data || '').slice(0, 30),
  eventoCriadoPor: alvo.origem === 'local' ? (alvo.ev.criadoPor || null) : null,
});

/** POST /api/eventos/:chave/checkin   body: { codigo } — QR Code: validado na hora */
const checkin = async (req, res) => {
  try {
    const alvo = await acharEvento(req, req.params.chave);
    if (!alvo) return res.status(404).json({ erro: 'Evento não encontrado' });
    if (alvo.origem !== 'local' || !alvo.ev.validacao?.qrcode || !alvo.ev.qrSegredo) {
      return res.status(400).json({ erro: 'Este evento não aceita validação por QR Code' });
    }
    const filtro = filtroDoEvento(alvo, req.user.matricula);
    const antes = await Presenca.findOne(filtro).lean();
    if (antes?.status === 'aprovada') {
      return res.json({ sucesso: true, jaValidada: true, presenca: resumoPresenca(antes) });
    }
    if (!P.acontecendo(alvo.ev)) {
      return res.status(400).json({ erro: 'O QR Code só vale nos dias do evento.' });
    }
    if (!P.codigoConfere(alvo.ev, req.body?.codigo)) {
      return res.status(400).json({
        erro: alvo.ev.validacao?.qrDinamico
          ? 'Código inválido ou expirado. Leia o QR Code de novo.'
          : 'Código inválido. Confira e tente de novo.',
      });
    }

    const pres = await Presenca.findOneAndUpdate(
      filtro,
      {
        $set: {
          ...camposBase(req, alvo),
          metodo: 'qrcode', status: 'aprovada', motivo: '',
          arquivo: { nome: '', tipo: '', tamanho: 0 },
          decididoPor: null, decididoPorNome: 'QR Code', decididoEm: new Date(),
        },
      },
      { upsert: true, returnDocument: 'after' }
    );
    // Se havia um certificado esperando, ele não é mais necessário
    if (antes) await Comprovante.deleteOne({ presenca: antes._id });

    await conquistaEngine.processarPresencaAprovada(pres, alvo.ev.conquista);
    return res.json({ sucesso: true, presenca: resumoPresenca(pres) });
  } catch (err) {
    if (err.code === 11000) return res.json({ sucesso: true, jaValidada: true });
    console.error('Erro no check-in:', err.message);
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

    const alvo = await acharEvento(req, req.params.chave);
    if (!alvo) return res.status(404).json({ erro: 'Evento não encontrado' });
    const aceita = alvo.origem === 'suap' || alvo.ev.validacao?.certificado !== false;
    if (!aceita) return res.status(400).json({ erro: 'Este evento não aceita certificado — valide pelo QR Code.' });
    if (!P.jaComecou(alvo.ev)) return res.status(400).json({ erro: 'Você só pode validar depois que o evento começar.' });

    const filtro = filtroDoEvento(alvo, req.user.matricula);
    const antes = await Presenca.findOne(filtro).lean();
    if (antes?.status === 'aprovada') {
      return res.status(409).json({ erro: 'Sua presença neste evento já está validada.' });
    }

    const arquivo = { nome: P.nomeArquivoSeguro(req.get('x-nome-arquivo'), tipo), tipo, tamanho: buf.length };
    const pres = await Presenca.findOneAndUpdate(
      filtro,
      {
        $set: {
          ...camposBase(req, alvo),
          metodo: 'certificado', status: 'pendente', motivo: '', arquivo,
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

/** DELETE /api/eventos/:chave/presenca — aluno cancela um certificado pendente/recusado */
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

/** GET /api/admin/presencas?status=pendente|aprovada|recusada */
const listarPresencas = async (req, res) => {
  try {
    const filtro = { ...filtroMinhasPresencas(req) };
    if (['pendente', 'aprovada', 'recusada'].includes(req.query.status)) filtro.status = req.query.status;
    const lista = await Presenca.find(filtro).sort({ status: 1, updatedAt: -1 }).limit(500).lean();
    return res.json(lista.map((p) => ({ ...p, podeDecidir: podeDecidir(req, p) })));
  } catch (err) {
    console.error('Erro ao listar presenças:', err.message);
    return res.status(500).json({ erro: 'Erro ao listar presenças' });
  }
};

/** GET /api/admin/presencas/:id/arquivo — abre o certificado enviado */
const verArquivo = async (req, res) => {
  try {
    const pres = await Presenca.findById(req.params.id).lean();
    if (!pres || !podeDecidir(req, pres)) return res.status(404).json({ erro: 'Certificado não encontrado' });
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
    });
    return res.end(dados);
  } catch (err) {
    console.error('Erro ao abrir certificado:', err.message);
    return res.status(500).json({ erro: 'Erro ao abrir certificado' });
  }
};

/**
 * PUT /api/admin/presencas/:id   body: { status: 'aprovada'|'recusada', motivo? }
 * Também serve para DESFAZER (aprovada → recusada), revertendo as conquistas.
 */
const decidirPresenca = async (req, res) => {
  try {
    const { status } = req.body || {};
    if (!['aprovada', 'recusada'].includes(status)) return res.status(400).json({ erro: 'Status inválido' });
    const motivo = String(req.body?.motivo || '').trim().slice(0, 300);

    const atual = await Presenca.findById(req.params.id).lean();
    if (!atual || !podeDecidir(req, atual)) return res.status(404).json({ erro: 'Presença não encontrada' });
    if (atual.status === status) return res.json({ sucesso: true, semMudanca: true });
    if (status === 'aprovada' && atual.metodo === 'certificado') {
      const temArquivo = await Comprovante.exists({ presenca: atual._id });
      if (!temArquivo) return res.status(400).json({ erro: 'Este pedido não tem certificado anexado.' });
    }

    const pres = await Presenca.findByIdAndUpdate(
      atual._id,
      { $set: { status, motivo: status === 'recusada' ? motivo : '', decididoPor: req.admin.id, decididoPorNome: req.admin.nome || '', decididoEm: new Date() } },
      { returnDocument: 'after' }
    );

    let conquistaNome = '';
    if (status === 'aprovada') {
      let conquistaId = null;
      if (pres.origem === 'local' && pres.evento) {
        const ev = await Evento.findById(pres.evento).populate('conquista', 'nome ativa').lean();
        conquistaId = ev?.conquista?._id || null;
        if (ev?.conquista?.ativa !== false) conquistaNome = ev?.conquista?.nome || '';
      }
      await conquistaEngine.processarPresencaAprovada(pres, conquistaId);
    } else if (atual.status === 'aprovada') {
      await conquistaEngine.reverterPresenca(pres);
    }

    notificarAluno(pres.matricula, 'presenca', { status, eventoNome: pres.eventoNome, motivo, conquista: conquistaNome });
    registrar(req, `presenca.${status === 'aprovada' ? 'aprovar' : 'recusar'}`, pres.eventoNome, { aluno: pres.matricula, metodo: pres.metodo });
    return res.json({ sucesso: true, presenca: pres });
  } catch (err) {
    console.error('Erro ao decidir presença:', err.message);
    return res.status(500).json({ erro: 'Erro ao salvar decisão' });
  }
};

/** GET /api/admin/eventos/:id/qr — QR Code para projetar/imprimir (só quem gerencia o evento) */
const qrDoEvento = async (req, res) => {
  try {
    let ev = await Evento.findById(req.params.id).select('+qrSegredo').lean();
    if (!ev) return res.status(404).json({ erro: 'Evento não encontrado' });
    if (!podeGerirEvento(req, ev)) return res.status(403).json({ erro: 'Só quem cadastrou o evento pode ver o QR Code.' });
    if (!ev.validacao?.qrcode) return res.status(400).json({ erro: 'Ative "Aceitar QR Code" no evento primeiro.' });
    if (!ev.qrSegredo || req.method === 'POST') {
      ev = await Evento.findByIdAndUpdate(ev._id, { $set: { qrSegredo: P.novoSegredo() } }, { returnDocument: 'after' })
        .select('+qrSegredo').lean();
      if (req.method === 'POST') registrar(req, 'evento.novoqr', ev.nome, {});
    }

    const { codigo, expiraEm } = P.codigoAtual(ev);
    const site = urlDoSite() || `${req.protocol}://${req.get('host')}`;
    const url = `${site}/?checkin=${encodeURIComponent(P.chaveDe('local', ev._id))}&c=${codigo}`;
    const svg = await QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, color: { dark: '#000000', light: '#ffffff' } });
    return res.json({
      evento: ev.nome, codigo, url, svg,
      dinamico: !!ev.validacao?.qrDinamico,
      expiraEm, agora: Date.now(),
      acontecendo: P.acontecendo(ev),
    });
  } catch (err) {
    console.error('Erro ao gerar QR:', err.message);
    return res.status(500).json({ erro: 'Erro ao gerar QR Code' });
  }
};

/** Contagem de presenças por evento (para a tabela do painel). */
const contagemPorEvento = async (ids) => {
  if (!ids.length) return {};
  const rows = await Presenca.aggregate([
    { $match: { origem: 'local', evento: { $in: ids.map((i) => new mongoose.Types.ObjectId(String(i))) } } },
    { $group: { _id: { e: '$evento', s: '$status' }, n: { $sum: 1 } } },
  ]);
  const out = {};
  rows.forEach((r) => {
    const k = String(r._id.e);
    out[k] = out[k] || { aprovada: 0, pendente: 0, recusada: 0 };
    out[k][r._id.s] = r.n;
  });
  return out;
};

module.exports = {
  listarEventos, checkin, enviarCertificado, cancelarPresenca,
  listarPresencas, verArquivo, decidirPresenca, qrDoEvento,
  contagemPorEvento, filtroMinhasPresencas,
};

const crypto = require('crypto');
const mongoose = require('mongoose');

/**
 * Regras da validação de presença em eventos (QR Code do e-mail de inscrição e certificado).
 */

// ── QR Code do e-mail de inscrição ─────────────────────────────
const PRAZO_QR_DIAS = 30; // dá para validar pelo QR até 30 dias depois do fim do evento

/** Limpa o conteúdo lido do QR (texto/link). Devolve '' se for inválido. */
const limparQr = (bruto) => {
  const s = String(bruto ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  return s.length >= 4 && s.length <= 2000 ? s : '';
};

const hashQr = (conteudo) => crypto.createHash('sha256').update(conteudo).digest('hex');

// Link de um site do IFPR (suap.ifpr.edu.br, ifpr.edu.br, …)?
const linkInstitucional = (conteudo) => {
  try {
    const u = new URL(conteudo);
    return /^https?:$/.test(u.protocol) && /(^|\.)ifpr\.edu\.br$/i.test(u.hostname);
  } catch { return false; }
};

/**
 * Decide o que fazer com o QR do aluno, conforme a configuração do evento.
 *
 * Só valida NA HORA quando o QR identifica ESTE evento: o evento tem um padrão
 * e esse padrão é exclusivo dele (não aparece em QR nem em configuração de outro
 * evento). Um link do SUAP sozinho NÃO basta: o QR de inscrição de qualquer
 * evento antigo também é um link do IFPR.
 *
 *  - padrão definido e o QR não começa com ele      → 'recusar'
 *  - "conferir todo QR" marcado                     → 'pendente'
 *  - padrão definido, mas genérico (outro evento)   → 'pendente'
 *  - padrão definido e exclusivo                    → 'aprovada'
 *  - sem padrão                                     → 'pendente' (professor confere)
 *
 * `padraoGenerico` é calculado pelo controller (consulta o banco).
 */
const avaliarQr = (conteudo, validacao = {}, { padraoGenerico = false } = {}) => {
  const padrao = String(validacao.qrPadrao || '').trim();
  if (padrao && !conteudo.toLowerCase().startsWith(padrao.toLowerCase())) return { status: 'recusar' };
  if (validacao.qrConferir) return { status: 'pendente', observacao: 'Evento configurado para conferir todo QR' };
  if (padrao && padraoGenerico) {
    return { status: 'pendente', observacao: 'O padrão deste evento também aparece em QR de outro evento — confira se o QR é deste evento' };
  }
  if (padrao) return { status: 'aprovada', observacao: 'QR confere com o padrão exclusivo do evento' };
  if (linkInstitucional(conteudo)) {
    return { status: 'pendente', observacao: 'Link do IFPR, mas o evento não tem padrão — confira se o QR é da inscrição DESTE evento' };
  }
  return { status: 'pendente', observacao: 'QR fora do padrão do IFPR — confira o conteúdo' };
};

/** Escapa um texto para usar dentro de uma expressão regular (busca por "começa com"). */
const escaparRegex = (t) => String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Sugere o "padrão" a partir de um QR de exemplo: o link sem a última parte (que muda por aluno). */
const sugerirPadrao = (exemplo) => {
  const s = limparQr(exemplo);
  if (!s) return '';
  try {
    const u = new URL(s);
    const partes = u.pathname.split('/').filter(Boolean);
    partes.pop();
    return `${u.origin}/${partes.length ? `${partes.join('/')}/` : ''}`;
  } catch {
    // Texto: mantém o começo "fixo" (antes do último trecho de letras/números)
    const m = s.match(/^(.*?[^A-Za-z0-9])[A-Za-z0-9]{6,}$/);
    return m ? m[1] : '';
  }
};

/** Data de hoje no fuso do campus, no formato dos eventos (AAAA-MM-DD). */
const hojeSP = (agora = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora);

const diaDe = (v) => {
  if (!v) return null;
  const m = String(v).match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : hojeSP(d);
};

/** O evento já começou? (só então o aluno pode enviar certificado) */
const jaComecou = (ev, hoje = hojeSP()) => {
  const ini = diaDe(ev.data_inicio || ev.data);
  return !!ini && ini <= hoje;
};

/** Hoje está dentro dos dias do evento? */
const acontecendo = (ev, hoje = hojeSP()) => {
  const ini = diaDe(ev.data_inicio || ev.data);
  const fim = diaDe(ev.data_fim) || ini;
  return !!ini && ini <= hoje && hoje <= fim;
};

/** Ainda dá para validar pelo QR? (do início até PRAZO_QR_DIAS depois do fim) */
const qrNoPrazo = (ev, agora = new Date()) => {
  const hoje = hojeSP(agora);
  const ini = diaDe(ev.data_inicio || ev.data);
  const fim = diaDe(ev.data_fim) || ini;
  if (!ini || ini > hoje) return false;
  const limite = new Date(`${fim}T12:00:00-03:00`);
  limite.setDate(limite.getDate() + PRAZO_QR_DIAS);
  return hoje <= hojeSP(limite);
};

// ── Chave do evento na URL: "local-<ObjectId>" ou "suap-<número>" ──
const lerChave = (chave) => {
  const m = String(chave || '').match(/^(local|suap)-(.+)$/);
  if (!m) return null;
  if (m[1] === 'local') return mongoose.isValidObjectId(m[2]) ? { origem: 'local', id: m[2] } : null;
  const n = Number(m[2]);
  return Number.isInteger(n) && n > 0 ? { origem: 'suap', id: n } : null;
};
const chaveDe = (origem, id) => `${origem}-${id}`;

// ── Arquivo do certificado ─────────────────────────────────────
const TAM_MAX_ARQUIVO = 4 * 1024 * 1024; // a Vercel aceita até ~4,5 MB por requisição
const TIPOS_ARQUIVO = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

/** Confere o tipo REAL do arquivo pelos primeiros bytes (não confia no navegador). */
const tipoReal = (buf) => {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
};

const nomeArquivoSeguro = (bruto, tipo) => {
  let nome = '';
  try { nome = decodeURIComponent(String(bruto || '')); } catch { nome = String(bruto || ''); }
  nome = nome.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 120);
  const ext = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[tipo] || '';
  if (!nome) nome = `certificado${ext}`;
  return nome;
};

/**
 * Conquista que pode ser dada POR um evento: categoria "Evento" e que não seja
 * regra automática de outra coisa (projeto, nota) nem "ao completar N eventos"
 * (essa já é contada sozinha, somando todos os eventos).
 */
const conquistaServeParaEvento = (c) => !!c && c.categoria === 'evento' && (
  c.origem !== 'automatica' ||
  (c.regra?.tipo === 'evento_presenca' && !(parseInt(c.regra.valor, 10) > 0))
);

module.exports = {
  conquistaServeParaEvento,
  PRAZO_QR_DIAS, limparQr, hashQr, linkInstitucional, avaliarQr, sugerirPadrao, escaparRegex,
  hojeSP, diaDe, jaComecou, acontecendo, qrNoPrazo,
  lerChave, chaveDe,
  TAM_MAX_ARQUIVO, TIPOS_ARQUIVO, tipoReal, nomeArquivoSeguro,
};

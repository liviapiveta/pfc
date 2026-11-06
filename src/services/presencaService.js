const crypto = require('crypto');
const mongoose = require('mongoose');

/**
 * Regras da validação de presença em eventos (QR Code e certificado).
 */

// Sem letras/números que se confundem (0/O, 1/I/L) — o aluno pode digitar o código
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const TAM_CODIGO = 8;
const JANELA_QR_MS = 30 * 1000;   // QR dinâmico troca a cada 30 s…
const JANELAS_ACEITAS = 4;        // …e vale por ~2 min (dá tempo de abrir o portal e logar)

const novoSegredo = () => crypto.randomBytes(24).toString('hex');

const _codigo = (segredo, contador) => {
  const h = crypto.createHmac('sha256', String(segredo)).update(String(contador)).digest();
  let out = '';
  for (let i = 0; i < TAM_CODIGO; i++) out += ALFABETO[h[i] % ALFABETO.length];
  return out;
};

const janelaAtual = (agora = Date.now()) => Math.floor(agora / JANELA_QR_MS);

/** Código que o QR deve mostrar AGORA (e quando ele expira, se for dinâmico). */
const codigoAtual = (ev, agora = Date.now()) => {
  if (!ev?.qrSegredo) return null;
  if (!ev.validacao?.qrDinamico) return { codigo: _codigo(ev.qrSegredo, 'fixo'), expiraEm: null };
  const j = janelaAtual(agora);
  return { codigo: _codigo(ev.qrSegredo, j), expiraEm: (j + 1) * JANELA_QR_MS };
};

/** O código digitado/lido pelo aluno é válido para o evento? (comparação em tempo constante) */
const codigoConfere = (ev, recebido, agora = Date.now()) => {
  const r = String(recebido || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!ev?.qrSegredo || r.length !== TAM_CODIGO) return false;
  const candidatos = ev.validacao?.qrDinamico
    ? Array.from({ length: JANELAS_ACEITAS }, (_, i) => _codigo(ev.qrSegredo, janelaAtual(agora) - i))
    : [_codigo(ev.qrSegredo, 'fixo')];
  const rb = Buffer.from(r);
  return candidatos.some((c) => crypto.timingSafeEqual(Buffer.from(c), rb));
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

/** Hoje está dentro dos dias do evento? (o QR só vale durante o evento) */
const acontecendo = (ev, hoje = hojeSP()) => {
  const ini = diaDe(ev.data_inicio || ev.data);
  const fim = diaDe(ev.data_fim) || ini;
  return !!ini && ini <= hoje && hoje <= fim;
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

module.exports = {
  ALFABETO, TAM_CODIGO, JANELA_QR_MS,
  novoSegredo, codigoAtual, codigoConfere,
  hojeSP, diaDe, jaComecou, acontecendo,
  lerChave, chaveDe,
  TAM_MAX_ARQUIVO, TIPOS_ARQUIVO, tipoReal, nomeArquivoSeguro,
};

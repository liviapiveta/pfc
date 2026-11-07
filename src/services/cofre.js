const crypto = require('crypto');

/**
 * "Cofre" das chaves de acesso do SUAP (tokens): elas ficam CRIPTOGRAFADAS
 * no banco (AES-256-GCM). Quem vê o banco não consegue usá-las.
 *
 * A chave de criptografia vem de TOKEN_KEY (recomendado: 32 bytes em hex ou
 * base64, só no servidor). Sem TOKEN_KEY, é derivada do JWT_SECRET — assim
 * funciona sem configuração extra, mas trocar o JWT_SECRET exige um novo login.
 *
 * Formato salvo: "v1:" + base64( iv(12) | tag(16) | texto cifrado )
 */
const PREFIXO = 'v1:';

let _chave = null;
const chave = () => {
  if (_chave) return _chave;
  const bruta = String(process.env.TOKEN_KEY || '').trim();
  let k = null;
  if (/^[0-9a-f]{64}$/i.test(bruta)) k = Buffer.from(bruta, 'hex');
  else if (bruta) {
    const b = Buffer.from(bruta, 'base64');
    k = b.length === 32 ? b : crypto.createHash('sha256').update(bruta).digest();
  } else {
    if (!process.env.JWT_SECRET) throw new Error('Sem TOKEN_KEY nem JWT_SECRET para proteger os tokens');
    k = crypto.createHash('sha256').update(`ifplenus-tokens-suap:${process.env.JWT_SECRET}`).digest();
  }
  _chave = k;
  return k;
};

/** Criptografa um token para salvar no banco. Vazio continua vazio. */
const fechar = (texto) => {
  if (texto == null || texto === '') return texto ?? '';
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', chave(), iv);
  const cifrado = Buffer.concat([c.update(String(texto), 'utf8'), c.final()]);
  return PREFIXO + Buffer.concat([iv, c.getAuthTag(), cifrado]).toString('base64');
};

/**
 * Abre um token salvo. Devolve:
 *  - o token em texto (se estava criptografado e a chave confere);
 *  - o próprio valor, se for de antes da criptografia (legado — é
 *    regravado criptografado no próximo acesso);
 *  - null, se não der para abrir (chave trocada ou valor adulterado).
 */
const abrir = (valor) => {
  if (valor == null || valor === '') return valor ?? '';
  const s = String(valor);
  if (!s.startsWith(PREFIXO)) return s;
  try {
    const buf = Buffer.from(s.slice(PREFIXO.length), 'base64');
    if (buf.length < 29) return null;
    const d = crypto.createDecipheriv('aes-256-gcm', chave(), buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
  } catch {
    return null;
  }
};

const estaFechado = (valor) => typeof valor === 'string' && valor.startsWith(PREFIXO);

module.exports = { fechar, abrir, estaFechado };

/**
 * Limite simples de tentativas (em memória).
 * Na Vercel cada instância tem a própria memória, então é uma proteção
 * "de melhor esforço" — mas já barra robôs testando senhas em sequência
 * e quem tenta disparar muitos e-mails de redefinição.
 */
// chave(req): por padrão IP + conta tentada (matrícula/e-mail). Só o IP não
// serve: o campus inteiro sai pelo MESMO IP e os alunos se bloqueariam.
const chavePadrao = (req) => {
  const b = req.body || {};
  const conta = String(b.matricula || b.email || b.token || '').trim().toLowerCase().slice(0, 120);
  return `${req.ip || '?'}|${conta}`;
};

const limiteTaxa = ({ janelaMs = 15 * 60 * 1000, max = 20, mensagem, chave: chaveFn = chavePadrao } = {}) => {
  const hits = new Map();
  return (req, res, next) => {
    const agora = Date.now();
    const chave = chaveFn(req);
    let r = hits.get(chave);
    if (!r || r.expira <= agora) {
      r = { n: 0, expira: agora + janelaMs };
      hits.set(chave, r);
    }
    r.n += 1;
    // Limpeza ocasional para o Map não crescer sem fim
    if (hits.size > 5000) for (const [k, v] of hits) if (v.expira <= agora) hits.delete(k);
    if (r.n > max) {
      res.set('Retry-After', String(Math.ceil((r.expira - agora) / 1000)));
      return res.status(429).json({ erro: mensagem || 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' });
    }
    next();
  };
};

module.exports = limiteTaxa;

const Auditoria = require('../models/Auditoria');

/**
 * Registra uma ação do painel no histórico. Nunca derruba a requisição:
 * se o registro falhar, só loga o erro.
 *   registrar(req, 'conquista.conceder', 'Primeiro A → 2023ABC', { pontos: 20 })
 */
const registrar = (req, acao, alvo = '', detalhes = {}) => {
  const a = req?.admin || {};
  return Auditoria.create({
    adminId: a.id || null,
    adminNome: a.nome || '',
    adminEmail: a.email || '',
    adminCargo: a.cargo || '',
    acao,
    alvo: String(alvo || '').slice(0, 300),
    detalhes,
  }).catch((e) => console.error('Falha ao registrar auditoria:', e.message));
};

module.exports = { registrar };

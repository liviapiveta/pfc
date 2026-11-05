const mongoose = require('mongoose');

/**
 * Auditoria = histórico do que foi feito no painel administrativo.
 * Quem fez (retrato do nome/e-mail/cargo no momento), o quê, em quê.
 * Nunca é editado pelo painel — só lido (seção "Histórico", desenvolvedor).
 */
const auditoriaSchema = new mongoose.Schema(
  {
    adminId: { type: String, default: null },
    adminNome: { type: String, default: '' },
    adminEmail: { type: String, default: '' },
    adminCargo: { type: String, default: '' },

    // ex.: 'conquista.conceder', 'solicitacao.aceito', 'projeto.excluir'
    acao: { type: String, required: true },
    // texto curto do alvo (ex.: "Primeiro conceito A → 2023ABC")
    alvo: { type: String, default: '' },
    detalhes: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditoriaSchema.index({ createdAt: -1 });
auditoriaSchema.index({ acao: 1, createdAt: -1 });

module.exports = mongoose.model('Auditoria', auditoriaSchema);

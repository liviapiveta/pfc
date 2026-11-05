const mongoose = require('mongoose');

/**
 * Espelho local dos projetos que vêm da API do SUAP.
 *
 * Como o admin não autentica no SUAP, ele não consegue consultar a API
 * diretamente. Então, sempre que um aluno abre as abas de Pesquisa/Extensão,
 * os projetos retornados pelo SUAP são gravados/atualizados aqui (upsert).
 * O painel admin lê desta coleção para exibir o catálogo do SUAP.
 *
 * Identificador estável: (suapId, tipo).
 */
const projetoSuapCacheSchema = new mongoose.Schema(
  {
    suapId: { type: Number, required: true },
    tipo: { type: String, enum: ['pesquisa', 'extensao'], required: true },
    titulo: { type: String, default: '' },
    resumo: { type: String, default: '' },
    situacao: { type: String, default: '' },
    dt_inicio: { type: String, default: null },
    dt_final: { type: String, default: null },
    coordenador: { type: String, default: '' },
    email_coordenador: { type: String, default: '' },
    campus_nome: { type: String, default: '' },
    link_suap: { type: String, default: null },
  },
  { timestamps: true }
);

projetoSuapCacheSchema.index({ suapId: 1, tipo: 1 }, { unique: true });

module.exports = mongoose.model('ProjetoSuapCache', projetoSuapCacheSchema);

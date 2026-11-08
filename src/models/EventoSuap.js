const mongoose = require('mongoose');

/**
 * Espelho dos eventos do SUAP + a configuração que o painel dá a eles.
 *
 * Os dados do evento (nome, datas, local) são atualizados pelo servidor
 * sempre que um aluno carrega a lista do SUAP — nunca vêm do navegador.
 * A configuração (validação e conquista) é definida pelos professores
 * no painel e NUNCA é sobrescrita pela atualização.
 *
 * Também serve de reserva: se o SUAP cair, os alunos ainda veem os eventos.
 */
const eventoSuapSchema = new mongoose.Schema(
  {
    suapId: { type: Number, required: true, unique: true },
    nome: { type: String, default: '' },
    apresentacao: { type: String, default: '' },
    data_inicio: { type: String, default: null },
    data_fim: { type: String, default: null },
    periodo_formatado: { type: String, default: '' },
    local: { type: String, default: '' },
    campus: { type: String, default: '' },
    link_suap: { type: String, default: null },
    vistoEm: { type: Date, default: Date.now },

    // Carga horária (horas) — conta nas horas do relatório do aluno
    cargaHoraria: { type: Number, default: null, min: 0, max: 500 },
    validacao: { type: require('./validacaoEvento'), default: () => ({}) },
    conquista: { type: mongoose.Schema.Types.ObjectId, ref: 'Conquista', default: null },
    // Ocultado pelo painel (ex.: evento de teste no SUAP): o aluno não vê
    oculto: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model('EventoSuap', eventoSuapSchema);

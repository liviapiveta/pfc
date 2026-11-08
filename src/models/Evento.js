const mongoose = require('mongoose');

/**
 * Eventos cadastrados localmente pelo painel administrativo.
 * Datas/horas são guardadas como string para baterem diretamente
 * com os <input type="date"> / <input type="time"> do formulário.
 */
const eventoSchema = new mongoose.Schema(
  {
    nome: { type: String, required: true, trim: true },
    apresentacao: { type: String, default: '' },
    data_inicio: { type: String, required: true },
    data_fim: { type: String, default: null },
    hora_inicio: { type: String, default: null },
    hora_fim: { type: String, default: null },
    local: { type: String, default: '' },
    campus: { type: String, default: '' },
    link_suap: { type: String, default: null },

    // Carga horária (horas) — conta nas horas do relatório do aluno
    cargaHoraria: { type: Number, default: null, min: 0, max: 500 },
    // Como o aluno valida a presença (mesmo formato do EventoSuap)
    validacao: { type: require('./validacaoEvento'), default: () => ({}) },
    // Conquista que o aluno ganha por ESTE evento (opcional, além das regras gerais)
    conquista: { type: mongoose.Schema.Types.ObjectId, ref: 'Conquista', default: null },

    // Quem cadastrou no painel (professor só gerencia o que é dele)
    criadoPor: { type: String, default: null },       // id da conta Admin
    criadoPorEmail: { type: String, default: '', lowercase: true, trim: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Evento', eventoSchema);
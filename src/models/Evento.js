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
  },
  { timestamps: true }
);

module.exports = mongoose.model('Evento', eventoSchema);
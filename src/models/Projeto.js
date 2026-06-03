const mongoose = require('mongoose');

/**
 * Projetos cadastrados localmente pelo painel administrativo.
 * Datas são guardadas como string "YYYY-MM-DD" para baterem
 * diretamente com os <input type="date"> do formulário.
 */
const projetoSchema = new mongoose.Schema(
  {
    tipo: {
      type: String,
      enum: ['pesquisa', 'extensao'],
      required: true,
    },
    titulo: { type: String, required: true, trim: true },
    resumo: { type: String, default: '' },
    coordenador: { type: String, default: '' },
    email_coordenador: { type: String, default: '' },
    dt_inicio: { type: String, default: null },
    dt_final: { type: String, default: null },
    campus_nome: { type: String, default: '' },
    situacao: { type: String, default: 'Em execução' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Projeto', projetoSchema);
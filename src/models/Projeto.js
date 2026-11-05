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
    email_coordenador: { type: String, default: '', lowercase: true, trim: true },
    dt_inicio: { type: String, default: null },
    dt_final: { type: String, default: null },
    campus_nome: { type: String, default: '' },
    link_suap: { type: String, default: null },

    // Quem cadastrou no painel (professor só gerencia o que é dele)
    criadoPor: { type: String, default: null },       // id da conta Admin
    criadoPorEmail: { type: String, default: '', lowercase: true, trim: true },
    situacao: { type: String, default: 'Em execução' },
  },
  { timestamps: true }
);

projetoSchema.index({ criadoPor: 1 });
projetoSchema.index({ email_coordenador: 1 });

module.exports = mongoose.model('Projeto', projetoSchema);

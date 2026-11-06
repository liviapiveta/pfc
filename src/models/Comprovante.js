const mongoose = require('mongoose');

/** Arquivo do certificado (PDF/imagem) de uma Presenca. Máx. ~4 MB. */
const comprovanteSchema = new mongoose.Schema(
  {
    presenca: { type: mongoose.Schema.Types.ObjectId, ref: 'Presenca', required: true, unique: true },
    tipo: { type: String, required: true },
    dados: { type: Buffer, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Comprovante', comprovanteSchema);

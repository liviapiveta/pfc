const mongoose = require('mongoose');

/**
 * Presença de um aluno em um evento.
 *  - metodo 'qrcode'      → leu o QR do evento: já nasce APROVADA
 *  - metodo 'certificado' → enviou PDF/foto: fica PENDENTE até um professor decidir
 *
 * O evento pode ser do painel (origem 'local', campo `evento`) ou do SUAP
 * (origem 'suap', campo `eventoSuapId`). Um registro por aluno por evento:
 * se o certificado for recusado, o aluno reenvia no MESMO registro.
 *
 * O arquivo em si fica na coleção Comprovante (fora daqui), para as listas
 * do painel não carregarem megabytes à toa.
 */
const presencaSchema = new mongoose.Schema(
  {
    matricula: { type: String, required: true, trim: true, index: true },
    nomeAluno: { type: String, default: '' },
    curso: { type: String, default: '' },

    origem: { type: String, enum: ['local', 'suap'], required: true },
    evento: { type: mongoose.Schema.Types.ObjectId, ref: 'Evento', default: null },
    eventoSuapId: { type: Number, default: null },
    eventoNome: { type: String, default: '' },
    eventoData: { type: String, default: '' },
    // Dono do evento local (para o professor ver só as presenças dos eventos dele)
    eventoCriadoPor: { type: String, default: null },

    metodo: { type: String, enum: ['qrcode', 'certificado'], required: true },
    status: { type: String, enum: ['pendente', 'aprovada', 'recusada'], default: 'pendente', index: true },

    arquivo: {
      nome: { type: String, default: '' },
      tipo: { type: String, default: '' },
      tamanho: { type: Number, default: 0 },
    },

    motivo: { type: String, default: '' }, // por que foi recusada
    decididoPor: { type: String, default: null },
    decididoPorNome: { type: String, default: '' },
    decididoEm: { type: Date, default: null },
  },
  { timestamps: true }
);

presencaSchema.index(
  { evento: 1, matricula: 1 },
  { unique: true, partialFilterExpression: { origem: 'local' } }
);
presencaSchema.index(
  { eventoSuapId: 1, matricula: 1 },
  { unique: true, partialFilterExpression: { origem: 'suap' } }
);

module.exports = mongoose.model('Presenca', presencaSchema);

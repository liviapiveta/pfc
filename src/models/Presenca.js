const mongoose = require('mongoose');

/**
 * Presença de um aluno em um evento.
 *  - metodo 'qrcode'      → enviou o QR Code do e-mail de inscrição.
 *                           QR que bate com o padrão do evento → APROVADA na hora;
 *                           QR sem padrão conhecido → PENDENTE (professor confere).
 *  - metodo 'certificado' → enviou PDF/foto: fica PENDENTE até um professor decidir.
 *  Qualquer professor pode decidir (quem cadastra os eventos é a coordenação).
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

    metodo: { type: String, enum: ['qrcode', 'certificado'], required: true },
    status: { type: String, enum: ['pendente', 'aprovada', 'recusada'], default: 'pendente', index: true },

    arquivo: {
      nome: { type: String, default: '' },
      tipo: { type: String, default: '' },
      tamanho: { type: Number, default: 0 },
    },

    // QR Code do e-mail de inscrição: o conteúdo (para o professor conferir)
    // e um hash dele — o MESMO QR não pode validar dois alunos/eventos.
    qrConteudo: { type: String, default: '' },
    qrHash: { type: String, default: null },
    // Por que ficou pendente / como foi validada (mostrado ao professor)
    observacao: { type: String, default: '' },

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

presencaSchema.index(
  { qrHash: 1 },
  { unique: true, partialFilterExpression: { qrHash: { $type: 'string' } } }
);

module.exports = mongoose.model('Presenca', presencaSchema);

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

    // Como o aluno pode validar a presença (o professor escolhe um, outro ou os dois)
    validacao: {
      certificado: { type: Boolean, default: true },  // envia PDF/foto do certificado → professor aprova
      qrcode: { type: Boolean, default: false },      // lê o QR Code do evento → validado na hora
      qrDinamico: { type: Boolean, default: false },  // QR muda a cada 30 s (evita foto compartilhada)
    },
    // Segredo que gera o código do QR (nunca vai para o aluno)
    qrSegredo: { type: String, default: null, select: false },
    // Conquista que o aluno ganha ao ter a presença validada (opcional)
    conquista: { type: mongoose.Schema.Types.ObjectId, ref: 'Conquista', default: null },

    // Quem cadastrou no painel (professor só gerencia o que é dele)
    criadoPor: { type: String, default: null },       // id da conta Admin
    criadoPorEmail: { type: String, default: '', lowercase: true, trim: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Evento', eventoSchema);
const mongoose = require('mongoose');

/**
 * Como o aluno pode validar a presença num evento (do painel ou do SUAP).
 *
 *  certificado → envia PDF/foto do certificado; um professor confere.
 *  qrcode      → envia/lê o QR Code que ele RECEBEU NO E-MAIL DE INSCRIÇÃO.
 *                O IFPlenus não gera QR: ele confere o QR do aluno.
 *  qrPadrao    → (opcional) começo do conteúdo que o QR deste evento tem
 *                (ex.: "https://suap.ifpr.edu.br/eventos/"). Se o QR do aluno
 *                começa assim, a presença é validada na hora; se não, é recusado.
 *                Sem padrão: QR com link do IFPR valida na hora; outros vão
 *                para um professor conferir.
 *  qrConferir  → todo QR deste evento fica pendente até um professor conferir.
 */
module.exports = new mongoose.Schema(
  {
    certificado: { type: Boolean, default: true },
    qrcode: { type: Boolean, default: true },
    qrPadrao: { type: String, default: '', trim: true, maxlength: 300 },
    qrConferir: { type: Boolean, default: false }, // true = todo QR vai para um professor conferir
  },
  { _id: false }
);

const mongoose = require('mongoose');

/**
 * Relatórios em PDF emitidos — servem para a página pública de verificação
 * (/verificar/<codigo>), que mostra o RESUMO como estava na emissão.
 *
 * Não guarda o PDF nem a matrícula na parte pública: só o necessário para
 * quem recebeu o relatório conferir que ele é verdadeiro.
 */
const relatorioSchema = new mongoose.Schema(
  {
    codigo: { type: String, required: true, unique: true }, // aleatório, vai no QR
    matricula: { type: String, required: true, index: true }, // só para o aluno/servidor (nunca na página pública)
    nome: { type: String, default: '' },
    curso: { type: String, default: '' },
    idioma: { type: String, enum: ['pt', 'en'], default: 'pt' },
    periodo: { type: String, default: 'tudo' }, // tudo | ano-AAAA | AAAA-1 | AAAA-2
    periodoRotulo: { type: String, default: '' },
    resumo: {
      pontos: { type: Number, default: 0 },
      nivel: { type: Number, default: 1 },
      nivelNome: { type: String, default: '' },
      conquistas: { type: Number, default: 0 },
      eventos: { type: Number, default: 0 },
      projetos: { type: Number, default: 0 },
      horas: { type: Number, default: 0 },
    },
    emitidoEm: { type: Date, default: Date.now },
    revogado: { type: Boolean, default: false },
  },
  { timestamps: false }
);

module.exports = mongoose.model('Relatorio', relatorioSchema);

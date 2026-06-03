const mongoose = require('mongoose');

/**
 * Solicitação de participação de um aluno em um projeto.
 * Funciona para dois tipos de projeto (campo `origem`):
 *   - "local" → projeto criado no painel admin (referência em `projeto`)
 *   - "suap"  → projeto vindo da API do SUAP (identificado por `projetoSuapId`)
 *
 * `projetoTitulo` guarda um "retrato" do título no momento do pedido,
 * para que o admin consiga exibir a solicitação mesmo sem ter um token
 * do SUAP (o admin não autentica no SUAP).
 *
 * Status: "pendente" → "aceito" | "recusado".
 */
const solicitacaoSchema = new mongoose.Schema(
  {
    origem: { type: String, enum: ['local', 'suap'], default: 'local' },

    projeto: { type: mongoose.Schema.Types.ObjectId, ref: 'Projeto' }, // só local
    projetoSuapId: { type: Number },                                   // só suap

    projetoTitulo: { type: String, default: '' },
    tipo: { type: String, enum: ['pesquisa', 'extensao'] },

    matricula: { type: String, required: true, trim: true },
    nomeAluno: { type: String, default: '' },

    status: {
      type: String,
      enum: ['pendente', 'aceito', 'recusado'],
      default: 'pendente',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Solicitacao', solicitacaoSchema);
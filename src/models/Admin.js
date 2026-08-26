const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

/**
 * Conta de acesso ao painel administrativo (professores, servidores
 * e desenvolvedores do projeto). Substitui o login fixo "admin/admin".
 *
 * cargo:
 *  - 'professor'     → acesso normal ao painel (projetos, eventos,
 *                       solicitações, conquistas).
 *  - 'desenvolvedor' → mesmo acesso do professor, MAIS a tela de
 *                       gerenciamento de contas (criar/editar/remover
 *                       outros admins).
 */
const adminSchema = new mongoose.Schema(
  {
    nome: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    senhaHash: {
      type: String,
      required: true,
    },
    cargo: {
      type: String,
      enum: ['professor', 'desenvolvedor'],
      default: 'professor',
    },
    ativo: {
      type: Boolean,
      default: true,
    },
    ultimoAcesso: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Verifica a senha em texto puro contra o hash salvo
adminSchema.methods.verificarSenha = function (senha) {
  return bcrypt.compare(senha, this.senhaHash);
};

// Gera o hash — usado tanto na criação quanto na redefinição de senha
adminSchema.statics.gerarHash = function (senha) {
  return bcrypt.hash(senha, 10);
};

module.exports = mongoose.model('Admin', adminSchema);
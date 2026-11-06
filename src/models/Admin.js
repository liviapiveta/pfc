const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

/**
 * Conta de acesso ao painel administrativo.
 * Só podem entrar docentes, substitutos, técnicos administrativos e o(a) desenvolvedor(a).
 *
 * cargo:
 *  - 'professor'     → docente efetivo (acesso normal ao painel)
 *  - 'substituto'    → docente substituto (acesso normal ao painel)
 *  - 'tecnico'       → técnico(a) administrativo(a) — coordenações, secretaria… (acesso normal)
 *  - 'desenvolvedor' → acesso normal + gerenciamento de contas
 *
 * A conta nasce SEM senha. No primeiro acesso, o servidor digita o
 * e-mail e recebe um link "Cadastrar sua senha" (token de uso único).
 */
const CARGOS = ['professor', 'substituto', 'tecnico', 'desenvolvedor'];
const VALIDADE_TOKEN_MS = 48 * 60 * 60 * 1000; // 48h

const adminSchema = new mongoose.Schema(
  {
    nome: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    area: { type: String, trim: true, default: '' },
    senhaHash: { type: String, default: null },
    cargo: { type: String, enum: CARGOS, default: 'professor' },
    ativo: { type: Boolean, default: true },
    ultimoAcesso: { type: Date, default: null },

    // Link "Cadastrar/Redefinir senha" — guardamos só o hash SHA-256
    tokenSenhaHash: { type: String, default: null },
    tokenSenhaExpira: { type: Date, default: null },
    ultimoEnvioEmail: { type: Date, default: null },

    // Quando a pessoa abriu cada aba do painel pela última vez
    // (para os marcadores de "novidade" no menu). Ex.: { presencas: Date }
    vistoEm: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },

    // Proteção contra força bruta: 5 senhas erradas → bloqueia 15 min
    tentativasFalhas: { type: Number, default: 0 },
    bloqueadoAte: { type: Date, default: null },
  },
  { timestamps: true }
);

adminSchema.virtual('temSenha').get(function () {
  return !!this.senhaHash;
});

adminSchema.methods.verificarSenha = function (senha) {
  if (!this.senhaHash) return Promise.resolve(false);
  return bcrypt.compare(senha, this.senhaHash);
};

adminSchema.statics.gerarHash = function (senha) {
  return bcrypt.hash(senha, 10);
};

adminSchema.statics.hashToken = function (token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
};

/** Gera um novo token de senha, salva o hash e devolve o token em texto puro */
adminSchema.methods.gerarTokenSenha = function () {
  const token = crypto.randomBytes(32).toString('hex');
  this.tokenSenhaHash = this.constructor.hashToken(token);
  this.tokenSenhaExpira = new Date(Date.now() + VALIDADE_TOKEN_MS);
  return token;
};

adminSchema.statics.CARGOS = CARGOS;

module.exports = mongoose.model('Admin', adminSchema);

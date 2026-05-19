const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

/**
 * Armazenamos APENAS o que é necessário localmente:
 * - Matrícula (identificador único)
 * - Token SUAP (para fazer requisições autenticadas)
 * - Preferências e cache mínimo
 * Todos os dados pessoais, boletim, projetos vêm direto da API SUAP
 */
const userSchema = new mongoose.Schema(
    {
        matricula: {
            type: String,
            required: true,
            unique: true,
            trim: true,
        },
        suapToken: {
            type: String,
            required: true,
        },
        suapRefreshToken: {
            type: String,
        },
        // Cache leve do nome para exibir no header sem chamar a API
        nomeUsuario: {
            type: String,
            default: '',
        },
        // Preferências do portal
        preferencias: {
            anoLetivoAtual: { type: Number, default: null },
            periodoLetivoAtual: { type: Number, default: null },
            temaEscuro: { type: Boolean, default: false },
        },
        ultimoAcesso: {
            type: Date,
            default: Date.now,
        },
    },
    {
        timestamps: true,
    }
);

// Atualiza ultimoAcesso ao salvar
userSchema.pre('save', function (next) {
    this.ultimoAcesso = new Date();
    next();
});

module.exports = mongoose.model('User', userSchema);
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

        // ── Gamificação ──────────────────────────────────────────
        // Total de "estrelas" acumuladas. É um CACHE denormalizado: a
        // verdade são os registros em ConquistaUsuario (status confirmada).
        // Mantemos este total aqui só para ordenar o ranking rápido, sem
        // recalcular tudo a cada consulta. Sempre que conceder/remover uma
        // conquista, atualize este campo junto.
        pontos: {
            type: Number,
            default: 0,
            min: 0,
        },
        // Curso do aluno (capturado do SUAP no login). Permite o ranking
        // "do meu curso" além do ranking geral do campus.
        curso: {
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

// Índice para acelerar a ordenação do ranking (maior pontuação primeiro)
userSchema.index({ pontos: -1 });

// Atualiza ultimoAcesso ao salvar
userSchema.pre('save', function (next) {
    this.ultimoAcesso = new Date();
    next();
});

module.exports = mongoose.model('User', userSchema);
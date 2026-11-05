const mongoose = require('mongoose');

/**
 * ConquistaUsuario = registro de que um aluno DESBLOQUEOU uma conquista.
 * É a "ponte" entre o aluno (matricula) e o catálogo (Conquista).
 *
 * Decisões importantes:
 *
 * 1) Guardamos um "retrato" de `nomeConquista` e `pontos` no momento do
 *    desbloqueio. Assim, se o admin editar ou apagar a conquista depois,
 *    o histórico e a pontuação já contabilizada do aluno não se perdem
 *    (mesma lógica do `projetoTitulo` que você já usa em Solicitacao).
 *
 * 2) `contexto` + `chaveContexto` garantem IDEMPOTÊNCIA: o aluno não
 *    ganha a mesma conquista duas vezes pelo mesmo motivo.
 *      - Conquista única (manual, "destaque do semestre"):
 *          chaveContexto = ''  → só pode existir 1 registro por aluno+conquista
 *      - Conquista repetível (ex.: nota A em VÁRIAS disciplinas):
 *          chaveContexto = 'MAT-2024-1' → 1 registro por disciplina/período
 *    O índice único lá embaixo é quem efetivamente impede a duplicação.
 *
 * 3) `origem` e `concedidoPor` formam a trilha de auditoria — essencial
 *    quando houver prêmio em jogo (quem deu? foi o sistema ou um admin?).
 */
const conquistaUsuarioSchema = new mongoose.Schema(
  {
    matricula: { type: String, required: true, trim: true, index: true },

    conquista: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conquista',
      required: true,
    },

    // Retratos (ver decisão 1)
    nomeConquista: { type: String, default: '' },
    pontos: { type: Number, default: 0 },

    // 'confirmada' já conta pontos; 'pendente' aguarda validação do admin
    status: {
      type: String,
      enum: ['confirmada', 'pendente'],
      default: 'confirmada',
    },

    // Quem concedeu
    origem: {
      type: String,
      enum: ['automatica', 'admin'],
      default: 'admin',
    },
    concedidoPor: { type: String, default: null }, // usuário admin, p/ auditoria

    // Idempotência (ver decisão 2)
    contexto: { type: mongoose.Schema.Types.Mixed, default: {} },
    chaveContexto: { type: String, default: '' },
  },
  { timestamps: true }
);

/**
 * Um aluno não pode ganhar a mesma conquista + mesmo contexto duas vezes.
 * Como `chaveContexto` é '' para conquistas únicas, o índice limita a 1
 * registro por (aluno, conquista) nesse caso — exatamente o desejado.
 */
conquistaUsuarioSchema.index(
  { matricula: 1, conquista: 1, chaveContexto: 1 },
  { unique: true }
);

module.exports = mongoose.model('ConquistaUsuario', conquistaUsuarioSchema);
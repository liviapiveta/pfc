const mongoose = require('mongoose');

/**
 * Conquista = o "catálogo" de conquistas disponíveis no campus.
 * Gerenciado pelo painel administrativo (como você já faz com Projeto/Evento).
 *
 * Uma conquista pode ser:
 *   - manual    → o admin concede na mão (ex.: "Destaque do semestre")
 *   - automatica→ o sistema concede sozinho quando uma regra é satisfeita
 *                 (ex.: tirar nota A, ter solicitação de projeto aceita)
 *
 * O campo `regra` só é usado nas automáticas. Nas manuais ele fica vazio.
 */
const conquistaSchema = new mongoose.Schema(
  {
    nome: { type: String, required: true, trim: true },
    descricao: { type: String, default: '' },

    // Ícone exibido no card (emoji simples por enquanto: 🏆 🎓 🔬 🌱 ⭐ …)
    icone: { type: String, default: '🏆' },

    // Agrupa as conquistas nas telas (e ajuda a filtrar regras automáticas)
    categoria: {
      type: String,
      enum: ['academico', 'projeto', 'evento', 'especial'],
      default: 'especial',
    },

    // Quantas "estrelas" (pontos) esta conquista vale
    pontos: { type: Number, required: true, default: 0, min: 0 },

    // Como a conquista é concedida
    origem: {
      type: String,
      enum: ['manual', 'automatica'],
      default: 'manual',
    },

    /**
     * Regra de concessão automática (ignorada quando origem = 'manual').
     *   tipo  = o que dispara a conquista
     *   valor = parâmetro da regra (depende do tipo)
     *
     * Exemplos:
     *   { tipo: 'nota',           valor: 'A' }   → tirar nota/conceito A
     *   { tipo: 'projeto_aceito', valor: null }  → ter participação aceita em projeto
     */
    regra: {
      tipo: {
        type: String,
        enum: ['nota', 'projeto_aceito', 'evento_presenca', null],
        default: null,
      },
      valor: { type: String, default: null },
    },

    // Permite "aposentar" uma conquista sem apagá-la (e sem perder o histórico)
    ativa: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Conquista', conquistaSchema);
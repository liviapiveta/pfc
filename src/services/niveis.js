/**
 * niveis.js — faixas de nível da gamificação.
 *
 * Cada nível tem um `min` (pontos necessários para alcançá-lo). A escala
 * abaixo é um ponto de partida inspirado no "100 estrelas = Amador" que
 * você descreveu — ajuste os números/nomes à vontade, é só editar aqui.
 *
 * Regra: o aluno está no nível de maior `min` que ele já alcançou.
 */
const NIVEIS = [
  { nivel: 1, nome: 'Iniciante',     min: 0 },
  { nivel: 2, nome: 'Amador',        min: 100 },
  { nivel: 3, nome: 'Intermediário', min: 300 },
  { nivel: 4, nome: 'Avançado',      min: 600 },
  { nivel: 5, nome: 'Veterano',      min: 1000 },
  { nivel: 6, nome: 'Mestre',        min: 1500 },
  { nivel: 7, nome: 'Lenda',         min: 2200 },
];

/**
 * Dado o total de pontos, retorna o nível atual, o próximo, e o progresso
 * dentro da faixa atual (para desenhar a barra).
 *
 * Exemplo (pontos = 1200, com a escala acima):
 *   atual   = Veterano (min 1000)
 *   proximo = Mestre   (min 1500)
 *   faltam  = 300
 *   progresso = 40%  (200 de 500 pontos da faixa percorridos)
 */
const calcularNivel = (pontos = 0) => {
  const p = Math.max(0, Number(pontos) || 0);

  // Nível atual = o de maior `min` que o aluno já atingiu
  let atual = NIVEIS[0];
  for (const n of NIVEIS) {
    if (p >= n.min) atual = n;
    else break;
  }

  const proximo = NIVEIS.find((n) => n.min > atual.min) || null;

  // Progresso dentro da faixa atual (0–100). No último nível, fica 100%.
  let progresso = 100;
  let faltam = 0;
  if (proximo) {
    const faixa = proximo.min - atual.min;          // tamanho da faixa atual
    const percorrido = p - atual.min;               // quanto já andou nela
    progresso = Math.round((percorrido / faixa) * 100);
    faltam = proximo.min - p;                        // pontos para o próximo nível
  }

  return {
    nivel: atual.nivel,
    nome: atual.nome,
    pontos: p,
    progresso,                                       // % da barra (0–100)
    faltamParaProximo: faltam,                       // pontos restantes (0 no último)
    proximoNome: proximo ? proximo.nome : null,
    proximoMin: proximo ? proximo.min : null,
    inicioFaixa: atual.min,
  };
};

module.exports = { NIVEIS, calcularNivel };
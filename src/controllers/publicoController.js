const NodeCache = require('node-cache');
const User = require('../models/User');
const Presenca = require('../models/Presenca');
const ConquistaUsuario = require('../models/ConquistaUsuario');
const Evento = require('../models/Evento');
const EventoSuap = require('../models/EventoSuap');
const { NIVEIS } = require('../services/niveis');

/**
 * Dados da página inicial (pública, sem login).
 * Só CONTAGENS do campus e a tabela de níveis — nenhum dado de aluno.
 * Fica em cache por 10 minutos para não consultar o banco a cada visita.
 */
const cache = new NodeCache({ stdTTL: 600, checkperiod: 120 });

// Abaixo disso os números ainda não impressionam ninguém: a página esconde a faixa
const MINIMO_ALUNOS = 10;

const inicio = async (req, res) => {
  try {
    let dados = cache.get('inicio');
    if (!dados) {
      const ano = String(new Date().getFullYear());
      const doAno = { data_inicio: { $regex: `^${ano}` } };
      const [alunos, presencas, conquistas, eventosPainel, eventosSuap] = await Promise.all([
        User.countDocuments({}),
        Presenca.countDocuments({ status: 'aprovada' }),
        ConquistaUsuario.countDocuments({ status: 'confirmada' }),
        Evento.countDocuments(doAno),
        EventoSuap.countDocuments({ ...doAno, oculto: { $ne: true } }),
      ]);
      dados = {
        ano: Number(ano),
        numeros: alunos >= MINIMO_ALUNOS
          ? { alunos, presencas, conquistas, eventos: eventosPainel + eventosSuap }
          : null,
        niveis: NIVEIS.map(({ nivel, nome, min }) => ({ nivel, nome, min })),
      };
      cache.set('inicio', dados);
    }
    res.set('Cache-Control', 'public, max-age=300');
    res.json(dados);
  } catch (err) {
    console.error('Erro nos dados da página inicial:', err.message);
    res.status(500).json({ erro: 'Não foi possível carregar os números' });
  }
};

module.exports = { inicio };

const Solicitacao = require('../models/Solicitacao');
const Presenca = require('../models/Presenca');
const { calcularNivel } = require('../services/niveis');
const { registrar } = require('../services/auditoria');

/**
 * Exportações em CSV para o painel (abrem direto no Excel / Planilhas).
 * Separador ";" e BOM UTF-8 — é o que o Excel em português espera.
 * Os escopos são os mesmos das telas: o professor só exporta o que já vê.
 */

// Célula que começa com = + - @ vira fórmula no Excel (injeção de CSV) → prefixa com '
const celula = (v) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const montarCsv = (cabecalho, linhas) =>
  '﻿' + [cabecalho, ...linhas].map((l) => l.map(celula).join(';')).join('\r\n') + '\r\n';

const dataHora = (d) => (d ? new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '');
const hoje = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

const enviarCsv = (res, nome, conteudo) => {
  res.set({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${nome}-${hoje()}.csv"`,
    'Cache-Control': 'no-store',
  });
  return res.send(conteudo);
};

const ROTULO_SOL = { pendente: 'Pendente', aceito: 'Aceita', recusado: 'Recusada' };
const ROTULO_PRES = { pendente: 'Em análise', aprovada: 'Validada', recusada: 'Recusada' };

/** GET /api/admin/exportar/solicitacoes?status= */
const solicitacoes = async (req, res) => {
  try {
    const { filtroMinhasSolicitacoes } = require('./adminController');
    const filtro = await filtroMinhasSolicitacoes(req);
    if (['pendente', 'aceito', 'recusado'].includes(req.query.status)) filtro.status = req.query.status;
    const lista = await Solicitacao.find(filtro).populate('projeto', 'titulo tipo').sort({ createdAt: -1 }).lean();
    const linhas = lista.map((s) => [
      s.nomeAluno || '', s.matricula,
      s.projeto?.titulo || s.projetoTitulo || '(projeto removido)',
      ({ pesquisa: 'Pesquisa', extensao: 'Extensão' })[s.projeto?.tipo || s.tipo] || '',
      s.origem === 'suap' ? 'SUAP' : 'Painel',
      ROTULO_SOL[s.status] || s.status,
      dataHora(s.createdAt), dataHora(s.decididoEm),
    ]);
    registrar(req, 'exportar.solicitacoes', `${linhas.length} linha(s)`, {});
    return enviarCsv(res, 'solicitacoes', montarCsv(
      ['Aluno', 'Matrícula', 'Projeto', 'Tipo', 'Origem', 'Situação', 'Pedido em', 'Decidido em'], linhas));
  } catch (err) {
    console.error('Erro ao exportar solicitações:', err.message);
    return res.status(500).json({ erro: 'Erro ao exportar' });
  }
};

/**
 * GET /api/admin/exportar/ranking?curso=
 * Respeita a privacidade escolhida pelo aluno: quem pediu "oculto" não sai,
 * quem pediu "anônimo" sai sem nome e sem matrícula.
 */
const ranking = async (req, res) => {
  try {
    const { _rankearAlunos, _rankingVisivel } = require('./conquistaController');
    const curso = typeof req.query.curso === 'string' ? req.query.curso.trim().slice(0, 200) : '';
    const todos = await _rankearAlunos(curso ? { curso } : {});
    const { visiveis } = _rankingVisivel(todos, null);
    const linhas = visiveis.map((u) => {
      const anon = u.privacidadeRanking === 'anonimo';
      const nv = calcularNivel(u.pontosReais || 0);
      return [u.posicao, anon ? 'Aluno anônimo' : (u.nomeUsuario || ''), anon ? '' : u.matricula, u.curso || '',
        u.pontosReais || 0, `${nv.nivel} · ${nv.nome}`];
    });
    registrar(req, 'exportar.ranking', `${linhas.length} aluno(s)${curso ? ` · ${curso}` : ''}`, {});
    return enviarCsv(res, 'ranking', montarCsv(['Posição', 'Aluno', 'Matrícula', 'Curso', 'Pontos', 'Nível'], linhas));
  } catch (err) {
    console.error('Erro ao exportar ranking:', err.message);
    return res.status(500).json({ erro: 'Erro ao exportar' });
  }
};

/** GET /api/admin/exportar/presencas?status= — lista de presença dos eventos */
const presencas = async (req, res) => {
  try {
    const { filtroMinhasPresencas } = require('./presencaController');
    const filtro = { ...filtroMinhasPresencas(req) };
    if (['pendente', 'aprovada', 'recusada'].includes(req.query.status)) filtro.status = req.query.status;
    const lista = await Presenca.find(filtro).sort({ eventoNome: 1, nomeAluno: 1 }).lean();
    const linhas = lista.map((p) => [
      p.eventoNome, p.eventoData, p.origem === 'suap' ? 'SUAP' : 'Painel',
      p.nomeAluno || '', p.matricula, p.curso || '',
      p.metodo === 'qrcode' ? 'QR Code' : 'Certificado',
      ROTULO_PRES[p.status] || p.status, p.motivo || '', p.decididoPorNome || '', dataHora(p.decididoEm || p.updatedAt),
    ]);
    registrar(req, 'exportar.presencas', `${linhas.length} linha(s)`, {});
    return enviarCsv(res, 'presencas', montarCsv(
      ['Evento', 'Data do evento', 'Origem', 'Aluno', 'Matrícula', 'Curso', 'Validação', 'Situação', 'Motivo', 'Decidido por', 'Quando'], linhas));
  } catch (err) {
    console.error('Erro ao exportar presenças:', err.message);
    return res.status(500).json({ erro: 'Erro ao exportar' });
  }
};

module.exports = { solicitacoes, ranking, presencas, _celula: celula };

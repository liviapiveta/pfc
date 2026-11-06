const User = require('../models/User');
const { enviarNotificacao } = require('./emailService');

/**
 * Notificações por e-mail para o aluno. Só envia se:
 *   - o aluno tem e-mail (vem do SUAP no login), e
 *   - deixou "Notificações por e-mail" ligado nas Configurações.
 * NUNCA lança erro: uma falha de e-mail não pode quebrar a ação do painel.
 */
const MODELOS = {
  conquista: (d) => ({
    assunto: 'Você desbloqueou uma conquista!',
    titulo: `🏆 ${d.nome}`,
    mensagem: `Parabéns! Você ganhou a conquista "${d.nome}" e ${d.pontos} ponto(s) no IFPlenus.`,
    botao: 'Ver minhas conquistas',
  }),
  nivel: (d) => ({
    assunto: `Você subiu para o nível ${d.nivel}!`,
    titulo: `⭐ Nível ${d.nivel} · ${d.nome}`,
    mensagem: `Mandou bem! Com ${d.pontos} pontos você chegou ao nível ${d.nome}.${d.proximo ? ` O próximo é ${d.proximo}.` : ' Esse é o nível máximo!'}`,
    botao: 'Ver meus níveis',
  }),
  solicitacao: (d) => (d.status === 'aceito'
    ? {
        assunto: 'Sua participação foi aceita!',
        titulo: '✅ Participação aceita',
        mensagem: `Sua solicitação para participar do projeto "${d.projetoTitulo}" foi aceita pelo professor.`,
        botao: 'Ver meus projetos',
      }
    : {
        assunto: 'Atualização da sua solicitação',
        titulo: 'Solicitação não aceita',
        mensagem: `Sua solicitação para o projeto "${d.projetoTitulo}" não foi aceita desta vez. Você pode procurar outros projetos no portal.`,
        botao: 'Ver projetos',
      }),
  presenca: (d) => (d.status === 'aprovada'
    ? {
        assunto: 'Sua presença foi validada!',
        titulo: '🎟️ Presença validada',
        mensagem: `Sua participação no evento "${d.eventoNome}" foi validada.${d.conquista ? ` Você ganhou a conquista "${d.conquista}".` : ''}`,
        botao: 'Ver meus eventos',
      }
    : {
        assunto: 'Certificado não aceito',
        titulo: 'Certificado não aceito',
        mensagem: `O certificado que você enviou para "${d.eventoNome}" não foi aceito${d.motivo ? `: ${d.motivo}` : '.'} Você pode enviar outro pelo portal, em Eventos.`,
        botao: 'Ver meus eventos',
      }),
};

const notificarAluno = async (matricula, tipo, dados = {}) => {
  try {
    const modelo = MODELOS[tipo];
    if (!modelo || !matricula) return false;
    const aluno = await User.findOne({ matricula }).select('email nomeUsuario notificarEmail').lean();
    if (!aluno || aluno.notificarEmail === false || !aluno.email) return false;
    await enviarNotificacao({ email: aluno.email, nome: aluno.nomeUsuario, ...modelo(dados) });
    return true;
  } catch (e) {
    console.error(`Falha ao notificar aluno (${tipo}):`, e.message);
    return false;
  }
};

module.exports = { notificarAluno };

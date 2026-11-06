const nodemailer = require('nodemailer');

/**
 * Envio de e-mails automáticos pelo noreply do IFPlenus (Gmail).
 * Variáveis de ambiente:
 *   SMTP_USER  → noreplyifplenus@gmail.com
 *   SMTP_PASS  → "Senha de app" do Gmail (16 caracteres, sem espaços)
 */
let transporter = null;
const getTransporter = () => {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      // Reaproveita a conexão entre e-mails seguidos e não deixa um Gmail lento
      // segurar a requisição até a Vercel derrubar a função (limite ~10 s)
      pool: true,
      connectionTimeout: 6000,
      greetingTimeout: 5000,
      socketTimeout: 8000,
    });
  }
  return transporter;
};

const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * Envia o link "Cadastrar sua senha" (ou "Redefinir senha").
 * @param {{ nome: string, email: string, link: string, redefinir?: boolean }} dados
 */
const enviarLinkSenha = async ({ nome, email, link, redefinir = false }) => {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    throw new Error('SMTP_USER / SMTP_PASS não configurados');
  }

  const primeiroNome = String(nome || '').split(' ')[0] || 'servidor(a)';
  const titulo = redefinir ? 'Redefinir sua senha' : 'Cadastrar sua senha';
  const intro = redefinir
    ? 'Recebemos um pedido para redefinir a senha da sua conta no Painel Administrativo do IFPlenus.'
    : 'Você foi autorizado(a) a acessar o Painel Administrativo do IFPlenus. Para entrar, cadastre sua senha clicando no botão abaixo.';

  const html = `
  <div style="background:#1b1b1f;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;">
    <div style="max-width:480px;margin:0 auto;background:#26262b;border-radius:16px;padding:32px;color:#f4f5f7;">
      <div style="font-size:22px;font-weight:800;margin-bottom:24px;">IF<span style="color:#44d883">Plenus</span></div>
      <p style="font-size:16px;margin:0 0 12px;">Olá, ${esc(primeiroNome)}!</p>
      <p style="font-size:14px;line-height:1.6;color:#c2c6cf;margin:0 0 24px;">${intro}</p>
      <a href="${esc(link)}" style="display:inline-block;background:#44d883;color:#06281a;text-decoration:none;font-weight:700;padding:14px 28px;border-radius:10px;font-size:15px;">${titulo}</a>
      <p style="font-size:12px;line-height:1.6;color:#8b909b;margin:24px 0 0;">
        O link vale por 48 horas e só pode ser usado uma vez.<br>
        Se o botão não funcionar, copie e cole este endereço no navegador:<br>
        <span style="color:#c2c6cf;word-break:break-all;">${esc(link)}</span>
      </p>
      <p style="font-size:12px;color:#8b909b;margin:16px 0 0;">Se você não pediu isso, pode ignorar este e-mail.</p>
    </div>
    <p style="text-align:center;font-size:11px;color:#8b909b;margin-top:16px;">E-mail automático — não responda.</p>
  </div>`;

  const texto = `Olá, ${primeiroNome}!\n\n${intro}\n\n${titulo}: ${link}\n\nO link vale por 48 horas e só pode ser usado uma vez.\nSe você não pediu isso, ignore este e-mail.`;

  await getTransporter().sendMail({
    from: `"IFPlenus" <${process.env.SMTP_USER}>`,
    to: email,
    subject: `IFPlenus — ${titulo}`,
    text: texto,
    html,
  });
};

/** Endereço público do site (para botões nos e-mails). Sem ele, o e-mail sai sem botão. */
const urlDoSite = () => {
  const doEnv = String(process.env.APP_URL || '').split(',')[0].trim();
  if (doEnv) return doEnv.replace(/\/+$/, '');
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return null;
};

/**
 * Notificação para o ALUNO (conquista nova, subiu de nível, solicitação decidida).
 * @param {{ email, nome, assunto, titulo, mensagem, botao? }} dados
 */
const enviarNotificacao = async ({ email, nome, assunto, titulo, mensagem, botao = 'Abrir o IFPlenus' }) => {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    throw new Error('SMTP_USER / SMTP_PASS não configurados');
  }
  const primeiroNome = String(nome || '').split(' ')[0] || 'aluno(a)';
  const site = urlDoSite();

  const html = `
  <div style="background:#1b1b1f;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;">
    <div style="max-width:480px;margin:0 auto;background:#26262b;border-radius:16px;padding:32px;color:#f4f5f7;">
      <div style="font-size:22px;font-weight:800;margin-bottom:24px;">IF<span style="color:#44d883">Plenus</span></div>
      <p style="font-size:16px;margin:0 0 8px;">Olá, ${esc(primeiroNome)}!</p>
      <p style="font-size:19px;font-weight:700;margin:0 0 12px;color:#ffffff;">${esc(titulo)}</p>
      <p style="font-size:14px;line-height:1.6;color:#c2c6cf;margin:0 0 24px;">${esc(mensagem)}</p>
      ${site ? `<a href="${esc(site)}" style="display:inline-block;background:#44d883;color:#06281a;text-decoration:none;font-weight:700;padding:14px 28px;border-radius:10px;font-size:15px;">${esc(botao)}</a>` : ''}
      <p style="font-size:12px;line-height:1.6;color:#9da2ad;margin:24px 0 0;">
        Você recebe este e-mail porque as notificações estão ligadas.
        Para desligar: no portal, abra <strong>Configurações → Notificações por e-mail</strong>.
      </p>
    </div>
    <p style="text-align:center;font-size:11px;color:#9da2ad;margin-top:16px;">E-mail automático — não responda.</p>
  </div>`;

  const texto = `Olá, ${primeiroNome}!\n\n${titulo}\n${mensagem}\n\n${site ? site + '\n\n' : ''}Para desligar estes e-mails: Configurações → Notificações por e-mail.`;

  await getTransporter().sendMail({
    from: `"IFPlenus" <${process.env.SMTP_USER}>`,
    to: email,
    subject: `IFPlenus — ${assunto}`,
    text: texto,
    html,
  });
};

module.exports = { enviarLinkSenha, enviarNotificacao, urlDoSite };

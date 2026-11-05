require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const connectDB = require('./config/database');
const apiRoutes = require('./src/routes/api');
const adminAuth = require('./src/middleware/adminAuth');
const Admin = require('./src/models/Admin');
const { importarServidores, garantirContaDev } = require('./src/services/contasService');

const app = express();
// Necessário na Vercel para req.protocol ser "https" (usado nos links de e-mail)
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

// Detecta se está rodando como função serverless na Vercel.
// A Vercel define automaticamente a variável de ambiente VERCEL=1.
const NA_VERCEL = !!process.env.VERCEL;

// ── Middlewares globais ───────────────────────────────────────
// O site e a API são servidos pelo mesmo domínio, então não precisamos
// liberar outras origens. Antes, `origin: true` + credentials permitia que
// QUALQUER site fizesse requisições autenticadas em nome do usuário.
const ORIGENS_PERMITIDAS = (process.env.APP_URL || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => cb(null, !origin || ORIGENS_PERMITIDAS.includes(origin)),
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ── Páginas: decide login × portal ANTES de servir o HTML ─────
// Sem isso, quem não estava logado via o portal "piscar" e só então era
// mandado para o /login; e quem já estava logado caía no login de novo.
const tokenValido = (token, campo) => {
  if (!token) return false;
  try { const d = jwt.verify(token, process.env.JWT_SECRET); return campo ? !!d[campo] : true; }
  catch { return false; }
};
app.get('/admin.html', (req, res) => res.redirect('/admin'));
app.get(['/', '/index.html'], (req, res, next) =>
  tokenValido(req.cookies?.authToken, 'userId') ? next() : res.redirect('/login'));
app.get('/login', (req, res, next) =>
  (!('admin' in req.query) && tokenValido(req.cookies?.authToken, 'userId')) ? res.redirect('/') : next());

// ── Arquivos estáticos (não dependem do banco) ────────────────
// Ficam ANTES da conexão com o Mongo: CSS, imagens e a tela de login
// carregam mesmo se o banco estiver lento ou fora do ar.
app.use(express.static(path.join(__dirname, 'src', 'public'), { index: false }));

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'src', 'public', 'login.html'));
});
app.get('/admin/login', (req, res) => res.redirect('/login?admin'));
app.get('/admin/definir-senha', (req, res) => {
  res.sendFile(path.join(__dirname, 'src', 'public', 'admin-definir-senha.html'));
});

// Na Vercel não há um "start" único que conecta ao banco antes de ligar
// o servidor — cada requisição pode ser uma invocação nova da função.
// Este middleware garante que o Mongo está conectado antes de seguir;
// como a conexão fica em cache (config/database.js), isso só tem custo
// real na primeira requisição de cada instância "fria" (cold start).
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    console.error('Erro ao conectar no banco:', err.message);
    res.status(500).json({ erro: 'Erro ao conectar ao banco de dados' });
  }
});


// ── Rotas da API ─────────────────────────────────────────────
app.use('/api', apiRoutes);

// Rota de API inexistente → 404 em JSON (antes devolvia a página HTML com
// status 200, o que escondia erros como uma rota que ainda não subiu).
app.use('/api', (req, res) => res.status(404).json({ erro: 'Rota não encontrada' }));

// ── Painel administrativo ─────────────────────────────────────
app.get('/admin', adminAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'src', 'public', 'admin.html'));
});

// ── Portal do aluno (o '/' já passou pela checagem de login lá em cima) ──
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'src', 'public', 'index.html'));
});

// Qualquer outro endereço volta para o início
app.get('*', (req, res) => res.redirect('/'));

// ── Error handler global ──────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Erro não tratado:', err);
  res.status(500).json({ erro: 'Erro interno do servidor' });
});

// ── Contas iniciais ───────────────────────────────────────────
// 1) Garante a conta de desenvolvedor(a) (DEV_EMAIL).
// 2) Se o banco ainda não tem nenhum docente/substituto, importa a lista
//    oficial de servidores (src/data/servidores.js). Depois disso, novas
//    importações são feitas pelo botão "Importar lista IFPR" no painel.
const seedAdmin = async () => {
  await garantirContaDev();
  const temServidores = await Admin.exists({ cargo: { $in: ['professor', 'substituto'] } });
  if (!temServidores) {
    const r = await importarServidores();
    console.log(`✅ Lista de servidores importada: ${r.novas} contas criadas`);
  }
};

if (NA_VERCEL) {
  // ── Ambiente Vercel (serverless) ──────────────────────────────
  // Não chamamos app.listen(): a Vercel invoca o app exportado a cada
  // requisição. O seed de admin roda "em segundo plano" na primeira
  // invocação; se falhar, só loga o erro (não pode derrubar a função).
  seedAdmin().catch((e) => console.error('Erro ao criar conta admin inicial:', e.message));
} else {
  // ── Ambiente local / servidor tradicional (Railway, Render, VPS...) ──
  const start = async () => {
    try {
      await connectDB();
      await seedAdmin();
      app.listen(PORT, () => {
        console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
        console.log(`📡 API SUAP: ${process.env.SUAP_BASE_URL || 'https://suap.ifpr.edu.br/api (padrão)'}`);
      });
    } catch (err) {
      console.error('❌ Falha ao iniciar o servidor:', err.message);
      process.exit(1);
    }
  };
  start();
}

// Exporta o app para a Vercel conseguir importá-lo como função serverless.
module.exports = app;

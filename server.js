require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('path');
const connectDB = require('./config/database');
const apiRoutes = require('./src/routes/api');
const adminAuth = require('./src/middleware/adminAuth');
const Admin = require('./src/models/Admin');

const app = express();
const PORT = process.env.PORT || 3000;

// Detecta se está rodando como função serverless na Vercel.
// A Vercel define automaticamente a variável de ambiente VERCEL=1.
const NA_VERCEL = !!process.env.VERCEL;

// ── Middlewares globais ───────────────────────────────────────
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

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

// ── Arquivos estáticos ───────────────────────────────────────
app.use(express.static(path.join(__dirname, 'src', 'public')));

// ── Rotas da API ─────────────────────────────────────────────
app.use('/api', apiRoutes);

// ── Rotas de páginas (SPA-style: tudo vai para o index.html) ──
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'src', 'public', 'login.html'));
});

// ── Painel administrativo ─────────────────────────────────────
app.get('/admin/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'src', 'public', 'admin-login.html'));
});

app.get('/admin', adminAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'src', 'public', 'admin.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'src', 'public', 'index.html'));
});

// ── Error handler global ──────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Erro não tratado:', err);
  res.status(500).json({ erro: 'Erro interno do servidor' });
});

// ── Cria a primeira conta de desenvolvedor, se ainda não existir ──
// Usa ADMIN_SEED_EMAIL / ADMIN_SEED_SENHA das variáveis de ambiente.
// Só roda se a coleção "Admin" estiver vazia — depois disso, contas são
// criadas pela própria tela de gerenciamento dentro do painel.
const seedAdmin = async () => {
  const jaExiste = await Admin.countDocuments();
  if (jaExiste > 0) return;

  const email = process.env.ADMIN_SEED_EMAIL;
  const senha = process.env.ADMIN_SEED_SENHA;

  if (!email || !senha) {
    console.warn('⚠️  Nenhuma conta admin cadastrada e ADMIN_SEED_EMAIL/ADMIN_SEED_SENHA não definidos — o painel /admin ficará inacessível até essas variáveis serem definidas.');
    return;
  }

  const senhaHash = await Admin.gerarHash(senha);
  await Admin.create({
    nome: 'Desenvolvedor(a)',
    email: email.trim().toLowerCase(),
    senhaHash,
    cargo: 'desenvolvedor',
  });
  console.log(`✅ Conta admin inicial criada para ${email} (cargo: desenvolvedor)`);
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
        console.log(`📡 API SUAP: ${process.env.SUAP_BASE_URL}`);
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

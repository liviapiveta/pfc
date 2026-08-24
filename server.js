require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('path');
const connectDB = require('./config/database');
const apiRoutes = require('./src/routes/api');
const adminAuth = require('./src/middleware/adminAuth');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middlewares globais ───────────────────────────────────────
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

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

// ── Inicialização ─────────────────────────────────────────────
const start = async () => {
  await connectDB();
  app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
    console.log(`📡 API SUAP: ${process.env.SUAP_BASE_URL}`);
  });
};

start();
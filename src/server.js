require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('path');
const connectDB = require('../config/database');
const apiRoutes = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middlewares globais ───────────────────────────────────────
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ── Arquivos estáticos ───────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── Rotas da API ─────────────────────────────────────────────
app.use('/api', apiRoutes);

// ── Rotas de páginas (SPA-style: tudo vai para o index.html) ──
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Error handler global ──────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Erro não tratado:', err);
  res.status(500).json({ erro: 'Erro interno do servidor' });
});

// ── Inicialização ─────────────────────────────────────────────
const start = async () => {
  await connectDB();
  console.log("teste")
  app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
    console.log(`📡 API SUAP: ${process.env.SUAP_BASE_URL}`);
  });
};

start();
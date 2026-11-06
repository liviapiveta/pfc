/**
 * Importa a lista oficial de servidores (docentes, substitutos e técnicos administrativos) no MongoDB
 * e garante a conta de desenvolvedor(a).
 * Uso:  npm run importar-servidores
 */
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/database');
const { importarServidores, garantirContaDev } = require('../src/services/contasService');

(async () => {
  try {
    await connectDB();
    await garantirContaDev();
    const r = await importarServidores();
    console.log(`✅ ${r.novas} contas novas criadas (${r.total} servidores na lista).`);
  } catch (e) {
    console.error('❌ Erro na importação:', e.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
})();

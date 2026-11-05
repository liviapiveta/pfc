const mongoose = require('mongoose');

/**
 * Em ambiente serverless (Vercel), cada invocação pode reaproveitar o
 * mesmo processo ("warm start"). Sem cache, cada requisição abriria uma
 * conexão nova com o MongoDB, esgotando rapidamente o limite de conexões
 * do banco. Guardamos a conexão (e a Promise em andamento) em `global`,
 * que persiste entre invocações dentro do mesmo processo.
 */
let cached = global._mongooseConn;
if (!cached) {
  cached = global._mongooseConn = { conn: null, promise: null };
}

const connectDB = async () => {
  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    cached.promise = mongoose
      .connect(process.env.MONGODB_URI, {
        serverSelectionTimeoutMS: 5000,
      })
      .then((mongooseInstance) => {
        console.log(`✅ MongoDB conectado: ${mongooseInstance.connection.host}`);
        return mongooseInstance;
      });
  }

  try {
    cached.conn = await cached.promise;
  } catch (error) {
    // Se a conexão falhar, limpa a promise para permitir nova tentativa
    // na próxima requisição, em vez de ficar presa num erro para sempre.
    cached.promise = null;
    console.error('❌ Erro ao conectar no MongoDB:', error.message);
    throw error;
  }

  return cached.conn;
};

module.exports = connectDB;

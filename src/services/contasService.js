const Admin = require('../models/Admin');
const servidores = require('../data/servidores');

/**
 * Importa a lista oficial de servidores (src/data/servidores.js).
 * Só CRIA contas que ainda não existem — nunca sobrescreve senha,
 * cargo ou status de contas já cadastradas. Pode rodar várias vezes.
 */
const importarServidores = async () => {
  const ops = servidores.map((s) => ({
    updateOne: {
      filter: { email: s.email.trim().toLowerCase() },
      update: {
        $setOnInsert: {
          nome: s.nome,
          email: s.email.trim().toLowerCase(),
          area: s.area || '',
          cargo: s.cargo === 'substituto' ? 'substituto' : 'professor',
          ativo: true,
          senhaHash: null,
        },
      },
      upsert: true,
    },
  }));

  const r = await Admin.bulkWrite(ops, { ordered: false });
  return { total: servidores.length, novas: r.upsertedCount || 0 };
};

/**
 * Garante que a conta de desenvolvedor(a) exista (DEV_EMAIL no .env).
 * Também força o cargo "desenvolvedor" e reativa a conta, caso alguém
 * tenha alterado — assim o acesso de dev nunca se perde.
 */
const garantirContaDev = async () => {
  const email = String(process.env.DEV_EMAIL || '').trim().toLowerCase();
  if (!email) {
    console.warn('⚠️  DEV_EMAIL não definido — nenhuma conta de desenvolvedor(a) garantida.');
    return;
  }
  await Admin.updateOne(
    { email },
    {
      $set: { cargo: 'desenvolvedor', ativo: true },
      $setOnInsert: { nome: process.env.DEV_NOME || 'Desenvolvedor(a)', email, senhaHash: null },
    },
    { upsert: true }
  );
};

module.exports = { importarServidores, garantirContaDev };

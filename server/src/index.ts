import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { createUser } from './users.js';

const cfg = loadConfig();
const db = openDb(cfg.dbFile);

const userCount = (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
if (userCount === 0) {
  const { ADMIN_USER, ADMIN_PASSWORD } = process.env;
  if (ADMIN_USER && ADMIN_PASSWORD) {
    createUser(db, ADMIN_USER, ADMIN_PASSWORD, 'admin');
    console.log(`Administrador "${ADMIN_USER}" criado.`);
  } else {
    console.warn('Nenhum usuário cadastrado. Crie o primeiro com: npm run user:create -- <usuario> <senha> admin (ou defina ADMIN_USER e ADMIN_PASSWORD na primeira execução).');
  }
}

const app = buildApp(db, cfg);
app.listen({ port: cfg.port, host: cfg.host }).then(() => console.log(`Servidor em http://${cfg.host}:${cfg.port}`));

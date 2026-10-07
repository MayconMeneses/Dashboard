import { loadConfig } from '../config.js';
import { openDb } from '../db.js';
import { createUser } from '../users.js';
import type { Role } from '../auth.js';

// Uso: npm run user:create -- <usuario> <senha> <admin|analista|leitor>
const [username, password, role] = process.argv.slice(2);
if (!username || !password || !['admin', 'analista', 'leitor'].includes(role ?? '')) {
  console.error('Uso: npm run user:create -- <usuario> <senha(>=10)> <admin|analista|leitor>');
  process.exit(1);
}
const db = openDb(loadConfig().dbFile);
try {
  createUser(db, username, password, role as Role);
  console.log(`Usuário "${username}" criado com perfil ${role}.`);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}

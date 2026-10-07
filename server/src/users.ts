import { hashPassword, type Role } from './auth.js';
import type { Db } from './db.js';

export function createUser(db: Db, username: string, password: string, role: Role): number {
  if (!/^[a-z0-9._-]{3,40}$/i.test(username)) throw new Error('Usuário deve ter 3–40 caracteres (letras, números, . _ -).');
  if (password.length < 10) throw new Error('A senha deve ter pelo menos 10 caracteres.');
  const r = db.prepare('INSERT INTO users (username, password_hash, role, active, created_at) VALUES (?,?,?,1,?)').run(username.toLowerCase(), hashPassword(password), role, new Date().toISOString());
  return Number(r.lastInsertRowid);
}

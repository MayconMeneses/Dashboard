import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from './db.js';

export type Role = 'admin' | 'analista' | 'leitor';
export interface AuthUser {
  id: number;
  username: string;
  role: Role;
}

export const COOKIE = 'sid';

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(actual, expected);
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export function createSession(db: Db, userId: number, hours: number): { token: string; expires: Date } {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + hours * 3600_000);
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?,?,?,?)').run(sha(token), userId, expires.toISOString(), new Date().toISOString());
  return { token, expires };
}

export function destroySession(db: Db, token: string): void {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token));
}

export function userFromToken(db: Db, token: string | undefined): AuthUser | null {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.id, u.username, u.role, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND u.active = 1`,
    )
    .get(sha(token)) as { id: number; username: string; role: Role; expires_at: string } | undefined;
  if (!row || new Date(row.expires_at) < new Date()) return null;
  return { id: row.id, username: row.username, role: row.role };
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser | null;
  }
}

/** Permissões por perfil. leitor: só visualiza; analista: importa/registra/exporta; admin: tudo. */
const CAN = {
  importar: ['admin', 'analista'],
  ativar: ['admin', 'analista'],
  manual: ['admin', 'analista'],
  exportar: ['admin', 'analista'],
  restrito: ['admin', 'analista'], // endereço residencial
  auditoria: ['admin'],
  baixarOriginal: ['admin'],
  administrar: ['admin'],
} as const;
export type Permission = keyof typeof CAN;

export function can(user: AuthUser | null, p: Permission): boolean {
  return !!user && (CAN[p] as readonly string[]).includes(user.role);
}

export function requireUser(req: FastifyRequest, reply: FastifyReply): AuthUser | null {
  if (!req.user) {
    void reply.code(401).send({ error: 'nao_autenticado', message: 'Entre com seu usuário para continuar.' });
    return null;
  }
  return req.user;
}

export function requirePermission(req: FastifyRequest, reply: FastifyReply, p: Permission): AuthUser | null {
  const u = requireUser(req, reply);
  if (!u) return null;
  if (!can(u, p)) {
    void reply.code(403).send({ error: 'sem_permissao', message: 'Seu perfil não tem permissão para esta ação.' });
    return null;
  }
  return u;
}

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../audit.js';
import { hashPassword, requirePermission } from '../auth.js';
import { createBackup } from '../backup.js';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import { ServiceError } from '../services/importer.js';
import { createUser } from '../users.js';

const roleEnum = z.enum(['admin', 'analista', 'leitor']);
const createBody = z.object({ username: z.string().min(3).max(40), password: z.string().min(10).max(200), role: roleEnum });
const patchBody = z
  .object({ role: roleEnum.optional(), active: z.boolean().optional(), password: z.string().min(10).max(200).optional() })
  .refine((b) => b.role !== undefined || b.active !== undefined || b.password !== undefined, 'Nada para alterar.');

interface UserRow {
  id: number;
  username: string;
  role: 'admin' | 'analista' | 'leitor';
  active: number;
  created_at: string;
}

export function registerAdminRoutes(app: FastifyInstance, db: Db, cfg: Config): void {
  const list = () => (db.prepare('SELECT id, username, role, active, created_at FROM users ORDER BY username').all() as unknown as UserRow[]).map((u) => ({ id: u.id, username: u.username, role: u.role, active: u.active === 1, createdAt: u.created_at }));
  const activeAdmins = (excludeId?: number) => (db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id != ?").get(excludeId ?? -1) as { n: number }).n;

  app.get('/api/users', async (req, reply) => {
    if (!requirePermission(req, reply, 'administrar')) return;
    return list();
  });

  app.post('/api/users', async (req, reply) => {
    const me = requirePermission(req, reply, 'administrar');
    if (!me) return;
    const b = createBody.safeParse(req.body);
    if (!b.success) throw new ServiceError(400, 'dados_invalidos', 'Informe usuário (3 a 40 caracteres), senha com pelo menos 10 caracteres e perfil.');
    try {
      const id = createUser(db, b.data.username, b.data.password, b.data.role);
      audit(db, me, 'usuario_criado', `user:${id}`, { username: b.data.username.toLowerCase(), role: b.data.role });
      return reply.code(201).send({ id });
    } catch (e) {
      const msg = (e as Error).message;
      throw new ServiceError(/UNIQUE/i.test(msg) ? 409 : 400, /UNIQUE/i.test(msg) ? 'usuario_existe' : 'dados_invalidos', /UNIQUE/i.test(msg) ? 'Já existe um usuário com esse nome.' : msg);
    }
  });

  app.patch('/api/users/:id', async (req, reply) => {
    const me = requirePermission(req, reply, 'administrar');
    if (!me) return;
    const id = Number((req.params as { id: string }).id);
    const b = patchBody.safeParse(req.body);
    if (!Number.isInteger(id) || !b.success) throw new ServiceError(400, 'dados_invalidos', 'Dados inválidos.');
    const u = db.prepare('SELECT id, username, role, active FROM users WHERE id = ?').get(id) as Pick<UserRow, 'id' | 'username' | 'role' | 'active'> | undefined;
    if (!u) throw new ServiceError(404, 'nao_encontrado', 'Usuário não encontrado.');
    const newRole = b.data.role ?? u.role;
    const newActive = b.data.active ?? u.active === 1;
    if (u.id === me.id && (newRole !== u.role || !newActive)) throw new ServiceError(409, 'proprio_usuario', 'Você não pode desativar nem rebaixar a si mesmo. Peça a outro administrador.');
    if (u.role === 'admin' && u.active === 1 && (newRole !== 'admin' || !newActive) && activeAdmins(u.id) === 0) throw new ServiceError(409, 'ultimo_admin', 'É preciso manter pelo menos um administrador ativo.');
    db.prepare('UPDATE users SET role = ?, active = ?, password_hash = COALESCE(?, password_hash) WHERE id = ?').run(newRole, newActive ? 1 : 0, b.data.password ? hashPassword(b.data.password) : null, id);
    // Mudou perfil, situação ou senha: encerra as sessões abertas desse usuário.
    if (b.data.role !== undefined || b.data.active !== undefined || b.data.password !== undefined) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    audit(db, me, 'usuario_alterado', `user:${id}`, { role: b.data.role, active: b.data.active, senhaRedefinida: b.data.password !== undefined });
    return { ok: true };
  });

  app.get('/api/admin/backup', async (req, reply) => {
    const me = requirePermission(req, reply, 'administrar');
    if (!me) return;
    let b: ReturnType<typeof createBackup>;
    try {
      b = createBackup(db, cfg);
    } catch (e) {
      throw new ServiceError(413, 'backup_grande', (e as Error).message);
    }
    audit(db, me, 'backup_baixado', undefined, { arquivo: b.name, bytes: b.bytes.length });
    return reply.header('Content-Type', 'application/zip').header('Content-Disposition', `attachment; filename="${b.name}"`).send(Buffer.from(b.bytes));
  });
}

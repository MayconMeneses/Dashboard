import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../audit.js';
import { requirePermission, requireUser } from '../auth.js';
import type { Db } from '../db.js';
import { normalizeName } from '../parsing/index.js';
import { ServiceError } from '../services/importer.js';

const body = z.object({
  locality: z.string().trim().min(2).max(80),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  result: z.enum(['com_captura', 'sem_captura']),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  notes: z.string().trim().max(280).optional(),
});

export function registerManualRoutes(app: FastifyInstance, db: Db): void {
  app.get('/api/manual-visits', async (req, reply) => {
    if (!requireUser(req, reply)) return;
    return db
      .prepare(
        `SELECT m.id, m.locality_raw AS locality, m.visit_date AS date, m.search_result AS result, m.lat, m.lng, m.notes, m.created_at AS createdAt, u.username AS createdBy
         FROM manual_visits m JOIN users u ON u.id = m.created_by WHERE m.voided_at IS NULL ORDER BY m.visit_date DESC, m.id DESC LIMIT 500`,
      )
      .all();
  });

  app.post('/api/manual-visits', async (req, reply) => {
    const user = requirePermission(req, reply, 'manual');
    if (!user) return;
    const p = body.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'dados_invalidos', message: 'Confira localidade, data e resultado da busca.', issues: p.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })) });
    const d = new Date(`${p.data.date}T00:00:00Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== p.data.date) throw new ServiceError(400, 'data_invalida', 'Data inválida.');
    if (d.getTime() > Date.now() + 86_400_000) throw new ServiceError(400, 'data_futura', 'A data da visita não pode estar no futuro.');
    if ((p.data.lat === undefined) !== (p.data.lng === undefined)) throw new ServiceError(400, 'coordenada_incompleta', 'Informe latitude e longitude juntas, ou nenhuma.');
    const key = normalizeName(p.data.locality);
    // Usa a grafia já existente da localidade quando houver
    const known = db.prepare('SELECT locality_raw FROM features f JOIN imports i ON i.id = f.import_id WHERE i.status = \'active\' AND f.locality_key = ? LIMIT 1').get(key) as { locality_raw: string } | undefined;
    const r = db
      .prepare('INSERT INTO manual_visits (locality_raw, locality_key, visit_date, search_result, lat, lng, notes, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(known?.locality_raw ?? p.data.locality, key, p.data.date, p.data.result, p.data.lat ?? null, p.data.lng ?? null, p.data.notes ?? null, user.id, new Date().toISOString());
    audit(db, user, 'visita_manual_criada', `manual:${r.lastInsertRowid}`, { locality: p.data.locality, result: p.data.result });
    return reply.code(201).send({ id: Number(r.lastInsertRowid), localidadeNova: !known });
  });

  app.delete('/api/manual-visits/:id', async (req, reply) => {
    const user = requirePermission(req, reply, 'manual');
    if (!user) return;
    const id = Number((req.params as { id: string }).id);
    const r = db.prepare('UPDATE manual_visits SET voided_at = ?, voided_by = ? WHERE id = ? AND voided_at IS NULL').run(new Date().toISOString(), user.id, id);
    if (!r.changes) throw new ServiceError(404, 'nao_encontrado', 'Registro não encontrado.');
    audit(db, user, 'visita_manual_anulada', `manual:${id}`);
    return { ok: true };
  });
}

import { readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../audit.js';
import { requirePermission, requireUser } from '../auth.js';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import type { FieldMapping, ParseReport } from '../parsing/index.js';
import { ServiceError, activateImport, discardImport, getImport, importReportText, remapImport, restoreImport, stageImport, type ImportRow } from '../services/importer.js';

const FEATURE_TYPES = ['localidade', 'visita', 'captura', 'pit', 'area', 'rota', 'outro'] as const;
const CANON = ['localidade', 'data_visita', 'data_exame', 'resultado_busca', 'resultado_exame', 'quantidade', 'fase', 'sexo', 'especie', 'endereco', 'imovel', 'pit', 'id_origem', 'ignorar'] as const;
const mappingSchema = z.object({
  fields: z.record(z.string().max(120), z.enum(CANON)).optional(),
  folders: z.record(z.string().max(240), z.enum(FEATURE_TYPES)).optional(),
  localityAliases: z.record(z.string().max(120), z.string().max(120)).optional(),
});

const present = (r: ImportRow) => ({
  id: r.id,
  version: r.version,
  filename: r.filename,
  sha256: r.sha256,
  sizeBytes: r.size_bytes,
  status: r.status,
  createdAt: r.created_at,
  activatedAt: r.activated_at,
  decisionNote: r.decision_note,
  error: r.error_message ? { code: r.error_code, message: r.error_message } : null,
  mapping: JSON.parse(r.mapping_json) as FieldMapping,
  report: r.report_json ? (JSON.parse(r.report_json) as ParseReport) : null,
});

export function registerImportRoutes(app: FastifyInstance, db: Db, cfg: Config): void {
  const name = (id: number) => (db.prepare('SELECT username FROM users WHERE id = ?').get(id) as { username: string } | undefined)?.username ?? '?';
  const idParam = (v: unknown) => {
    const n = Number((v as { id: string }).id);
    if (!Number.isInteger(n)) throw new ServiceError(400, 'id_invalido', 'Identificador inválido.');
    return n;
  };

  app.get('/api/imports', async (req, reply) => {
    if (!requireUser(req, reply)) return;
    const rows = db.prepare("SELECT * FROM imports WHERE status != 'discarded' ORDER BY id DESC LIMIT 100").all() as unknown as ImportRow[];
    return rows.map((r) => ({ ...present(r), report: undefined, createdBy: name(r.created_by) }));
  });

  app.post('/api/imports', async (req, reply) => {
    const user = requirePermission(req, reply, 'importar');
    if (!user) return;
    const file = await req.file();
    if (!file) throw new ServiceError(400, 'sem_arquivo', 'Selecione um arquivo .kml ou .kmz.');
    const bytes = await file.toBuffer();
    let mapping: FieldMapping = {};
    const field = file.fields['mapping'] as { value?: string } | undefined;
    if (field?.value) {
      let json: unknown = null;
      try {
        json = JSON.parse(field.value);
      } catch {
        /* tratado abaixo */
      }
      const parsed = mappingSchema.safeParse(json);
      if (!parsed.success) throw new ServiceError(400, 'mapeamento_invalido', 'Mapeamento inválido.');
      mapping = parsed.data;
    }
    const row = stageImport(db, cfg, user, file.filename, bytes, mapping);
    return reply.code(row.status === 'failed' ? 422 : 201).send(present(row));
  });

  app.get('/api/imports/:id', async (req, reply) => {
    if (!requireUser(req, reply)) return;
    const row = getImport(db, idParam(req.params));
    if (!row) throw new ServiceError(404, 'nao_encontrado', 'Importação não encontrada.');
    return present(row);
  });

  app.put('/api/imports/:id/mapping', async (req, reply) => {
    const user = requirePermission(req, reply, 'importar');
    if (!user) return;
    const parsed = mappingSchema.safeParse(req.body);
    if (!parsed.success) throw new ServiceError(400, 'mapeamento_invalido', 'Mapeamento inválido.');
    const row = remapImport(db, user, idParam(req.params), parsed.data);
    return reply.code(row.status === 'failed' ? 422 : 200).send(present(row));
  });

  app.post('/api/imports/:id/activate', async (req, reply) => {
    const user = requirePermission(req, reply, 'ativar');
    if (!user) return;
    const body = z.object({ confirm: z.literal(true), excludeRepeats: z.boolean().optional(), note: z.string().max(300).optional() }).safeParse(req.body);
    if (!body.success) throw new ServiceError(400, 'confirmacao_necessaria', 'Confirme a ativação para substituir os dados atuais.');
    return present(activateImport(db, user, idParam(req.params), body.data));
  });

  app.post('/api/imports/:id/restore', async (req, reply) => {
    const user = requirePermission(req, reply, 'ativar');
    if (!user) return;
    const body = z.object({ confirm: z.literal(true) }).safeParse(req.body);
    if (!body.success) throw new ServiceError(400, 'confirmacao_necessaria', 'Confirme a restauração.');
    return present(restoreImport(db, user, idParam(req.params)));
  });

  app.post('/api/imports/:id/discard', async (req, reply) => {
    const user = requirePermission(req, reply, 'importar');
    if (!user) return;
    discardImport(db, user, idParam(req.params));
    return { ok: true };
  });

  app.get('/api/imports/:id/report.txt', async (req, reply) => {
    if (!requirePermission(req, reply, 'importar')) return;
    const row = getImport(db, idParam(req.params));
    if (!row) throw new ServiceError(404, 'nao_encontrado', 'Importação não encontrada.');
    return reply.header('Content-Type', 'text/plain; charset=utf-8').header('Content-Disposition', `attachment; filename="relatorio-importacao-${row.id}.txt"`).send(importReportText(row, name));
  });

  app.get('/api/imports/:id/original', async (req, reply) => {
    const user = requirePermission(req, reply, 'baixarOriginal');
    if (!user) return;
    const row = getImport(db, idParam(req.params));
    if (!row) throw new ServiceError(404, 'nao_encontrado', 'Importação não encontrada.');
    audit(db, user, 'original_baixado', `import:${row.id}`);
    return reply.header('Content-Type', 'application/octet-stream').header('Content-Disposition', `attachment; filename="${row.filename.replace(/"/g, '')}"`).send(readFileSync(row.stored_path));
  });
}

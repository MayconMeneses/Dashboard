import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { audit } from '../audit.js';
import type { AuthUser } from '../auth.js';
import type { Config } from '../config.js';
import { tx, type Db } from '../db.js';
import { ImportError, parseKmlOrKmz, type FieldMapping, type NormalizedFeature, type ParseReport } from '../parsing/index.js';

export interface ImportRow {
  id: number;
  version: number | null;
  filename: string;
  sha256: string;
  size_bytes: number;
  stored_path: string;
  status: 'staged' | 'active' | 'archived' | 'failed' | 'discarded';
  mapping_json: string;
  report_json: string | null;
  error_code: string | null;
  error_message: string | null;
  created_by: number;
  created_at: string;
  activated_at: string | null;
  decision_note: string | null;
}

export class ServiceError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export const getImport = (db: Db, id: number) => db.prepare('SELECT * FROM imports WHERE id = ?').get(id) as ImportRow | undefined;
export const getActiveImport = (db: Db) => db.prepare("SELECT * FROM imports WHERE status = 'active'").get() as ImportRow | undefined;

function insertFeatures(db: Db, importId: number, features: NormalizedFeature[]): void {
  const stmt = db.prepare(`INSERT INTO features (import_id, idx, source_id, type, name, folder_path, locality_raw, locality_key, geometry, lat, lng,
    visit_date, exam_date, search_result, exam_result, triatomine_count, stage, sex, species, property_ref, pit_ref, address, is_boundary, duplicate_of, raw_json, issues_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const f of features) {
    stmt.run(
      importId, f.index, f.sourceId, f.type, f.name, f.folderPath.join(' / '), f.localityRaw, f.localityKey,
      f.geometry ? JSON.stringify(f.geometry) : null, f.lat, f.lng, f.visitDate, f.examDate, f.searchResult, f.examResult,
      f.triatomineCount, f.stage, f.sex, f.species, f.propertyRef, f.pitRef, f.address, f.isBoundary ? 1 : 0, f.duplicateOf,
      JSON.stringify(f.raw), JSON.stringify(f.issues),
    );
  }
}

function runParse(db: Db, row: ImportRow, bytes: Uint8Array, mapping: FieldMapping): void {
  try {
    const { features, report } = parseKmlOrKmz(bytes, mapping);
    const fatal = report.issues.find((i) => i.severity === 'erro');
    tx(db, () => {
      db.prepare('DELETE FROM features WHERE import_id = ?').run(row.id);
      insertFeatures(db, row.id, features);
      db.prepare("UPDATE imports SET status = ?, mapping_json = ?, report_json = ?, error_code = ?, error_message = ? WHERE id = ?").run(
        fatal ? 'failed' : 'staged', JSON.stringify(mapping), JSON.stringify(report), fatal ? fatal.code : null, fatal ? fatal.message : null, row.id,
      );
    });
  } catch (e) {
    if (!(e instanceof ImportError)) throw e;
    db.prepare("UPDATE imports SET status = 'failed', error_code = ?, error_message = ? WHERE id = ?").run(e.code, e.message, row.id);
  }
}

/** Valida, guarda o original e processa em área de preparação ("staged"). Nunca altera a versão ativa. */
export function stageImport(db: Db, cfg: Config, user: AuthUser, filename: string, bytes: Uint8Array, mapping: FieldMapping = {}): ImportRow {
  const safeName = filename.replace(/[^\w.\- ()]/g, '_').slice(0, 120) || 'arquivo';
  if (!/\.(kml|kmz)$/i.test(safeName)) throw new ServiceError(400, 'extensao_invalida', 'Envie um arquivo .kml ou .kmz.');
  if (bytes.length === 0) throw new ServiceError(400, 'arquivo_vazio', 'O arquivo está vazio.');
  if (bytes.length > cfg.maxUploadBytes) throw new ServiceError(413, 'arquivo_grande', `O arquivo excede o limite de ${Math.round(cfg.maxUploadBytes / 1048576)} MB.`);
  const sha = createHash('sha256').update(bytes).digest('hex');
  mkdirSync(cfg.uploadDir, { recursive: true });
  const stored = join(cfg.uploadDir, `${randomUUID()}.bin`); // nome gerado pelo servidor (sem path traversal)
  writeFileSync(stored, bytes, { mode: 0o600 });
  const r = db.prepare("INSERT INTO imports (filename, sha256, size_bytes, stored_path, status, mapping_json, created_by, created_at) VALUES (?,?,?,?, 'staged', ?,?,?)").run(
    safeName, sha, bytes.length, stored, JSON.stringify(mapping), user.id, new Date().toISOString(),
  );
  const row = getImport(db, Number(r.lastInsertRowid))!;
  runParse(db, row, bytes, mapping);
  const after = getImport(db, row.id)!;
  audit(db, user, 'importacao_enviada', `import:${row.id}`, { filename: safeName, sha256: sha, status: after.status, error: after.error_code });
  return after;
}

export function remapImport(db: Db, user: AuthUser, id: number, mapping: FieldMapping): ImportRow {
  const row = getImport(db, id);
  if (!row) throw new ServiceError(404, 'nao_encontrado', 'Importação não encontrada.');
  if (row.status !== 'staged' && row.status !== 'failed') throw new ServiceError(409, 'estado_invalido', 'Só é possível remapear importações ainda não ativadas.');
  runParse(db, row, readFileSync(row.stored_path), mapping);
  audit(db, user, 'importacao_remapeada', `import:${id}`, mapping);
  return getImport(db, id)!;
}

export function activateImport(db: Db, user: AuthUser, id: number, opts: { excludeRepeats?: boolean; note?: string }): ImportRow {
  return tx(db, () => {
    const row = getImport(db, id);
    if (!row) throw new ServiceError(404, 'nao_encontrado', 'Importação não encontrada.');
    if (row.status !== 'staged') throw new ServiceError(409, 'estado_invalido', 'Só uma importação em prévia pode ser ativada.');
    const report = JSON.parse(row.report_json ?? '{}') as ParseReport;
    if (report.issues?.some((i) => i.severity === 'erro')) throw new ServiceError(422, 'importacao_com_erro', 'A importação tem erros e não pode ser ativada.');
    db.prepare("UPDATE imports SET status = 'archived' WHERE status = 'active'").run();
    const next = ((db.prepare('SELECT MAX(version) AS v FROM imports').get() as { v: number | null }).v ?? 0) + 1;
    if (opts.excludeRepeats) db.prepare('UPDATE features SET excluded = 1 WHERE import_id = ? AND duplicate_of IS NOT NULL').run(id);
    db.prepare("UPDATE imports SET status = 'active', version = ?, activated_by = ?, activated_at = ?, decision_note = ? WHERE id = ?").run(
      next, user.id, new Date().toISOString(), `${opts.excludeRepeats ? 'Possíveis duplicatas excluídas. ' : 'Duplicatas mantidas. '}${opts.note ?? ''}`.trim(), id,
    );
    audit(db, user, 'importacao_ativada', `import:${id}`, { version: next, excludeRepeats: !!opts.excludeRepeats });
    return getImport(db, id)!;
  });
}

export function restoreImport(db: Db, user: AuthUser, id: number): ImportRow {
  return tx(db, () => {
    const row = getImport(db, id);
    if (!row) throw new ServiceError(404, 'nao_encontrado', 'Versão não encontrada.');
    if (row.status !== 'archived') throw new ServiceError(409, 'estado_invalido', 'Só versões arquivadas podem ser restauradas.');
    db.prepare("UPDATE imports SET status = 'archived' WHERE status = 'active'").run();
    db.prepare("UPDATE imports SET status = 'active', activated_by = ?, activated_at = ? WHERE id = ?").run(user.id, new Date().toISOString(), id);
    audit(db, user, 'versao_restaurada', `import:${id}`, { version: row.version });
    return getImport(db, id)!;
  });
}

export function discardImport(db: Db, user: AuthUser, id: number): void {
  const row = getImport(db, id);
  if (!row) throw new ServiceError(404, 'nao_encontrado', 'Importação não encontrada.');
  if (row.status !== 'staged' && row.status !== 'failed') throw new ServiceError(409, 'estado_invalido', 'Só prévias ou importações com falha podem ser descartadas.');
  // O arquivo original continua guardado para auditoria; só os registros de preparação são removidos.
  tx(db, () => {
    db.prepare('DELETE FROM features WHERE import_id = ?').run(id);
    db.prepare("UPDATE imports SET status = 'discarded' WHERE id = ?").run(id);
  });
  audit(db, user, 'importacao_descartada', `import:${id}`);
}

export function importReportText(row: ImportRow, usernameById: (id: number) => string): string {
  const report = row.report_json ? (JSON.parse(row.report_json) as ParseReport) : null;
  const L: string[] = [];
  L.push(`RELATÓRIO DE IMPORTAÇÃO #${row.id}`);
  L.push(`Arquivo: ${row.filename}  (SHA-256 ${row.sha256}, ${row.size_bytes} bytes)`);
  L.push(`Enviado em: ${row.created_at} por ${usernameById(row.created_by)}`);
  L.push(`Situação: ${row.status}${row.version ? ` (versão ${row.version})` : ''}`);
  if (row.activated_at) L.push(`Ativado em: ${row.activated_at}. Decisão: ${row.decision_note ?? '-'}`);
  if (row.error_message) L.push(`ERRO: ${row.error_message}`);
  if (report) {
    const c = report.counts;
    L.push('', 'TOTAIS RECONHECIDOS');
    L.push(`Pastas/camadas: ${report.folders.length} | Registros: ${c.placemarks} | Localidades: ${c.localities}`);
    L.push(`Pontos: ${c.points} | Linhas: ${c.lines} | Polígonos: ${c.polygons} | Sem geometria: ${c.semGeometria}`);
    L.push(`Por tipo: ${Object.entries(c.byType).map(([k, v]) => `${k}=${v}`).join(', ')}`);
    L.push('', `AVISOS E ERROS (${report.issues.length})`);
    for (const i of report.issues.slice(0, 500)) L.push(`[${i.severity}] ${i.code}: ${i.message}${i.placemark !== undefined ? ` (registro ${i.placemark})` : ''}`);
  }
  return L.join('\n') + '\n';
}

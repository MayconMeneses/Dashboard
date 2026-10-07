import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { strToU8, unzipSync, zipSync } from 'fflate';
import type { Config } from './config.js';
import type { Db } from './db.js';

const MAX_BACKUP_BYTES = 400 * 1024 * 1024;

/**
 * Backup completo: cópia consistente do banco (VACUUM INTO) + arquivos originais enviados, em um ZIP.
 * Quem faz o backup precisa guardá-lo em local seguro: ele contém os dados da campanha.
 */
export function createBackup(db: Db, cfg: Config, now = new Date()): { name: string; bytes: Uint8Array } {
  mkdirSync(cfg.dataDir, { recursive: true });
  const tmp = join(cfg.dataDir, `.backup-${process.pid}-${Date.now()}.sqlite`);
  db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  try {
    const files: Record<string, Uint8Array> = { 'dashboard.sqlite': new Uint8Array(readFileSync(tmp)) };
    let total = files['dashboard.sqlite']!.length;
    if (existsSync(cfg.uploadDir)) {
      for (const f of readdirSync(cfg.uploadDir)) {
        const p = join(cfg.uploadDir, f);
        if (!statSync(p).isFile()) continue;
        total += statSync(p).size;
        if (total > MAX_BACKUP_BYTES) throw new Error('Os dados passam de 400 MB; copie a pasta de dados manualmente.');
        files[`uploads/${f}`] = new Uint8Array(readFileSync(p));
      }
    }
    files['LEIA-ME.txt'] = strToU8(
      `Backup do painel de vigilância de triatomíneos\nGerado em ${now.toISOString()}\n\nConteúdo: dashboard.sqlite (banco) e uploads/ (arquivos KML/KMZ originais).\nPara restaurar, com o servidor parado: npm run restore -- "este-arquivo.zip"\nGuarde em local seguro: contém dados da campanha.\n`,
    );
    const stamp = now.toISOString().slice(0, 16).replace(/[-:T]/g, '');
    return { name: `backup-painel-${stamp}.zip`, bytes: zipSync(files, { level: 6 }) };
  } finally {
    rmSync(tmp, { force: true });
  }
}

const SAFE = (name: string) => !name.includes('..') && !name.startsWith('/') && !/^[a-zA-Z]:/.test(name) && !name.includes('\\') && !name.includes('\0');

/** Restaura um backup na pasta de dados. Guarda uma cópia do banco atual antes de substituir. */
export function restoreBackup(zip: Uint8Array, cfg: Config, now = new Date()): { restoredUploads: number; previousDb: string | null } {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zip, { filter: (f) => SAFE(f.name) && (f.name === 'dashboard.sqlite' || /^uploads\/[\w.-]+$/.test(f.name)) && f.originalSize < MAX_BACKUP_BYTES });
  } catch {
    throw new Error('Arquivo de backup inválido ou corrompido.');
  }
  const dbBytes = entries['dashboard.sqlite'];
  if (!dbBytes) throw new Error('O backup não contém o banco (dashboard.sqlite).');
  if (new TextDecoder('latin1').decode(dbBytes.subarray(0, 15)) !== 'SQLite format 3') throw new Error('O banco do backup não é um arquivo SQLite válido.');
  mkdirSync(cfg.dataDir, { recursive: true });
  let previousDb: string | null = null;
  if (existsSync(cfg.dbFile)) {
    previousDb = `${cfg.dbFile}.antes-da-restauracao-${now.toISOString().slice(0, 19).replace(/[-:T]/g, '')}`;
    renameSync(cfg.dbFile, previousDb);
    for (const ext of ['-wal', '-shm']) if (existsSync(cfg.dbFile + ext)) rmSync(cfg.dbFile + ext, { force: true });
  }
  writeFileSync(cfg.dbFile, dbBytes, { mode: 0o600 });
  mkdirSync(cfg.uploadDir, { recursive: true });
  let n = 0;
  for (const [name, bytes] of Object.entries(entries)) {
    if (!name.startsWith('uploads/')) continue;
    const target = resolve(cfg.uploadDir, basename(name));
    if (!target.startsWith(resolve(cfg.uploadDir) + sep) || dirname(target) !== resolve(cfg.uploadDir)) continue;
    writeFileSync(target, bytes, { mode: 0o600 });
    n++;
  }
  return { restoredUploads: n, previousDb };
}

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','analista','leitor')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
-- Cada importação é uma versão. status: staged | active | archived | failed | discarded
CREATE TABLE IF NOT EXISTS imports (
  id INTEGER PRIMARY KEY,
  version INTEGER,
  filename TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  stored_path TEXT NOT NULL,
  status TEXT NOT NULL,
  mapping_json TEXT NOT NULL DEFAULT '{}',
  report_json TEXT,
  error_code TEXT,
  error_message TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  activated_by INTEGER REFERENCES users(id),
  activated_at TEXT,
  decision_note TEXT
);
CREATE TABLE IF NOT EXISTS features (
  id INTEGER PRIMARY KEY,
  import_id INTEGER NOT NULL REFERENCES imports(id),
  idx INTEGER NOT NULL,
  source_id TEXT,
  type TEXT NOT NULL,
  name TEXT,
  folder_path TEXT,
  locality_raw TEXT,
  locality_key TEXT,
  geometry TEXT,
  lat REAL,
  lng REAL,
  visit_date TEXT,
  exam_date TEXT,
  search_result TEXT NOT NULL,
  exam_result TEXT NOT NULL,
  triatomine_count INTEGER,
  stage TEXT,
  sex TEXT,
  species TEXT,
  property_ref TEXT,
  pit_ref TEXT,
  address TEXT,
  is_boundary INTEGER NOT NULL DEFAULT 0,
  duplicate_of INTEGER,
  excluded INTEGER NOT NULL DEFAULT 0,
  raw_json TEXT,
  issues_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_features_import ON features(import_id, type, locality_key);
-- Visitas registradas à mão (não dependem do KML). Origem: "registro manual".
CREATE TABLE IF NOT EXISTS manual_visits (
  id INTEGER PRIMARY KEY,
  locality_raw TEXT NOT NULL,
  locality_key TEXT NOT NULL,
  visit_date TEXT NOT NULL,
  search_result TEXT NOT NULL CHECK (search_result IN ('com_captura','sem_captura')),
  lat REAL,
  lng REAL,
  notes TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  voided_at TEXT,
  voided_by INTEGER REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  user_id INTEGER,
  username TEXT,
  action TEXT NOT NULL,
  target TEXT,
  detail_json TEXT
);
`;

export function openDb(file: string): Db {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

export function tx<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

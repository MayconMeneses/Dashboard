import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDb, type Db } from '../src/db.js';
import { createUser } from '../src/users.js';

export const SAMPLE = readFileSync(new URL('./fixtures/exemplo-ficticio.kml', import.meta.url));
export const SAMPLE_KMZ = Buffer.from(zipSync({ 'doc.kml': new Uint8Array(SAMPLE) }));

export interface Ctx {
  app: FastifyInstance;
  db: Db;
  cookie: Record<'admin' | 'analista' | 'leitor', string>;
}

export async function setup(): Promise<Ctx> {
  const dir = mkdtempSync(join(tmpdir(), 'dash-'));
  const cfg = loadConfig({}, { dataDir: dir, uploadDir: join(dir, 'uploads'), dbFile: ':memory:', webDist: null, tileUrl: null, boundaryFile: null });
  const db = openDb(':memory:');
  const app = buildApp(db, cfg);
  const cookie = {} as Ctx['cookie'];
  for (const role of ['admin', 'analista', 'leitor'] as const) {
    createUser(db, role, `senha-${role}-123456`, role);
    const r = await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: role, password: `senha-${role}-123456` } });
    cookie[role] = String(r.cookies[0]!.name) + '=' + String(r.cookies[0]!.value);
  }
  return { app, db, cookie };
}

export const H = { 'x-requested-with': 'dashboard' };

export function multipart(filename: string, data: Uint8Array | string, fields: Record<string, string> = {}) {
  const b = '----testboundary7MA4YWxkTrZu0gW';
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`));
  parts.push(Buffer.from(typeof data === 'string' ? strToU8(data) : data), Buffer.from(`\r\n--${b}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { ...H, 'content-type': `multipart/form-data; boundary=${b}` } };
}

export async function upload(ctx: Ctx, who: keyof Ctx['cookie'], filename: string, data: Uint8Array | string, fields?: Record<string, string>) {
  const m = multipart(filename, data, fields);
  return ctx.app.inject({ method: 'POST', url: '/api/imports', payload: m.payload, headers: { ...m.headers, cookie: ctx.cookie[who] } });
}

export const get = (ctx: Ctx, url: string, who: keyof Ctx['cookie'] = 'admin') => ctx.app.inject({ method: 'GET', url, headers: { cookie: ctx.cookie[who] } });
export const post = (ctx: Ctx, url: string, payload: unknown, who: keyof Ctx['cookie'] = 'admin') =>
  ctx.app.inject({ method: 'POST', url, payload: payload as object, headers: { ...H, cookie: ctx.cookie[who] } });

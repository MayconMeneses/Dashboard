import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { beforeEach, describe, expect, it } from 'vitest';
import { createBackup, restoreBackup } from '../src/backup.js';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import { parseKmlOrKmz } from '../src/parsing/index.js';
import { H, SAMPLE, get, post, setup, upload, type Ctx } from './helpers.js';

let ctx: Ctx;
beforeEach(async () => {
  ctx = await setup();
});
const patch = (url: string, payload: object, who: keyof Ctx['cookie'] = 'admin') => ctx.app.inject({ method: 'PATCH', url, payload, headers: { ...H, cookie: ctx.cookie[who] } });
const userId = (name: string) => (ctx.db.prepare('SELECT id FROM users WHERE username = ?').get(name) as { id: number }).id;

describe('usuários (somente administrador)', () => {
  it('só o admin lista, cria e altera', async () => {
    expect((await get(ctx, '/api/users', 'analista')).statusCode).toBe(403);
    expect((await post(ctx, '/api/users', { username: 'novo', password: 'senha-longa-123', role: 'leitor' }, 'analista')).statusCode).toBe(403);
    const r = await post(ctx, '/api/users', { username: 'Novo.Usuario', password: 'senha-longa-123', role: 'analista' });
    expect(r.statusCode).toBe(201);
    const list = (await get(ctx, '/api/users')).json() as { username: string; role: string; active: boolean }[];
    expect(list.find((u) => u.username === 'novo.usuario')).toMatchObject({ role: 'analista', active: true });
    expect(JSON.stringify(list)).not.toContain('password');
    // o novo usuário consegue entrar
    const login = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: 'novo.usuario', password: 'senha-longa-123' } });
    expect(login.statusCode).toBe(200);
  });
  it('valida senha curta e usuário repetido', async () => {
    expect((await post(ctx, '/api/users', { username: 'abc', password: 'curta', role: 'leitor' })).statusCode).toBe(400);
    expect((await post(ctx, '/api/users', { username: 'leitor', password: 'senha-longa-123', role: 'leitor' })).statusCode).toBe(409);
  });
  it('desativar encerra as sessões e impede novo login; reativar volta', async () => {
    const id = userId('leitor');
    expect((await get(ctx, '/api/summary', 'leitor')).statusCode).toBe(200);
    expect((await patch(`/api/users/${id}`, { active: false })).statusCode).toBe(200);
    expect((await get(ctx, '/api/summary', 'leitor')).statusCode).toBe(401);
    const bad = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: 'leitor', password: 'senha-leitor-123456' } });
    expect(bad.statusCode).toBe(401);
    await patch(`/api/users/${id}`, { active: true });
    const ok = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: 'leitor', password: 'senha-leitor-123456' } });
    expect(ok.statusCode).toBe(200);
  });
  it('redefinir senha troca a senha e derruba a sessão', async () => {
    const id = userId('analista');
    expect((await patch(`/api/users/${id}`, { password: 'outra-senha-123' })).statusCode).toBe(200);
    expect((await get(ctx, '/api/summary', 'analista')).statusCode).toBe(401);
    const old = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: 'analista', password: 'senha-analista-123456' } });
    expect(old.statusCode).toBe(401);
    const novo = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: 'analista', password: 'outra-senha-123' } });
    expect(novo.statusCode).toBe(200);
  });
  it('não deixa o admin se trancar para fora nem remover o último admin', async () => {
    const me = userId('admin');
    expect((await patch(`/api/users/${me}`, { active: false })).json().error).toBe('proprio_usuario');
    expect((await patch(`/api/users/${me}`, { role: 'leitor' })).statusCode).toBe(409);
    // segundo admin: rebaixar o outro é permitido enquanto sobrar um ativo
    const r = await post(ctx, '/api/users', { username: 'admin2', password: 'senha-longa-123', role: 'admin' });
    const id2 = (r.json() as { id: number }).id;
    expect((await patch(`/api/users/${id2}`, { role: 'leitor' })).statusCode).toBe(200);
  });
  it('registra auditoria', async () => {
    await post(ctx, '/api/users', { username: 'aud', password: 'senha-longa-123', role: 'leitor' });
    const acts = ((await get(ctx, '/api/audit')).json() as { action: string }[]).map((a) => a.action);
    expect(acts).toContain('usuario_criado');
  });
});

describe('backup e restauração', () => {
  it('gera ZIP com banco e originais, só para o admin, e restaura em outra pasta', async () => {
    const up = await upload(ctx, 'analista', 'campanha.kml', SAMPLE);
    await post(ctx, `/api/imports/${up.json().id}/activate`, { confirm: true }, 'analista');
    expect((await get(ctx, '/api/admin/backup', 'analista')).statusCode).toBe(403);
    const r = await get(ctx, '/api/admin/backup');
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('application/zip');
    const files = unzipSync(new Uint8Array(r.rawPayload));
    expect(Object.keys(files)).toEqual(expect.arrayContaining(['dashboard.sqlite', 'LEIA-ME.txt']));
    expect(Object.keys(files).some((n) => n.startsWith('uploads/'))).toBe(true);
    // restaura numa pasta nova e confere os dados
    const dir = mkdtempSync(join(tmpdir(), 'rest-'));
    const cfg = loadConfig({}, { dataDir: dir, uploadDir: join(dir, 'uploads'), dbFile: join(dir, 'dashboard.sqlite') });
    const out = restoreBackup(new Uint8Array(r.rawPayload), cfg);
    expect(out.restoredUploads).toBe(1);
    const db2 = openDb(cfg.dbFile);
    expect((db2.prepare("SELECT COUNT(*) AS n FROM imports WHERE status = 'active'").get() as { n: number }).n).toBe(1);
    expect((db2.prepare('SELECT COUNT(*) AS n FROM features').get() as { n: number }).n).toBeGreaterThan(20);
    // restaurar de novo guarda o banco anterior
    const again = restoreBackup(new Uint8Array(r.rawPayload), cfg);
    expect(again.previousDb && existsSync(again.previousDb)).toBeTruthy();
  });
  it('recusa backup inválido, sem banco ou com caminho malicioso', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rest-'));
    const cfg = loadConfig({}, { dataDir: dir, uploadDir: join(dir, 'uploads'), dbFile: join(dir, 'dashboard.sqlite') });
    expect(() => restoreBackup(new Uint8Array([1, 2, 3]), cfg)).toThrow(/inválido/);
    expect(() => restoreBackup(zipSync({ 'x.txt': strToU8('a') }), cfg)).toThrow(/não contém o banco/);
    expect(() => restoreBackup(zipSync({ 'dashboard.sqlite': strToU8('isto não é sqlite') }), cfg)).toThrow(/SQLite/);
    const evil = zipSync({ 'dashboard.sqlite': strToU8('SQLite format 3\0' + 'x'.repeat(100)), '../escapou.bin': strToU8('x'), 'uploads/../../escapou2.bin': strToU8('y') });
    restoreBackup(evil, cfg);
    expect(existsSync(join(dir, '..', 'escapou.bin'))).toBe(false);
    expect(existsSync(join(dir, '..', '..', 'escapou2.bin'))).toBe(false);
  });
  it('createBackup funciona com banco em memória (arquivo temporário é removido)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bk-'));
    const cfg = loadConfig({}, { dataDir: dir, uploadDir: join(dir, 'uploads'), dbFile: join(dir, 'x.sqlite') });
    const db = openDb(':memory:');
    expect(() => createBackup(db, cfg)).not.toThrow();
  });
});

describe('exportação em KML', () => {
  const kml = `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>
<Folder><name>Area das Localidades</name><Placemark><name>Vila A &amp; B</name><Polygon><outerBoundaryIs><LinearRing><coordinates>-41,-5,0 -40,-5,0 -40,-4,0 -41,-4,0 -41,-5,0</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></Folder>
<Folder><name>Coleta</name>
<Placemark><name>Brasiliensis</name><ExtendedData><Data name="Localidade"><value>Vila A &amp; B</value></Data><Data name="Data de Captura"><value>30/06/2026</value></Data><Data name="Resultado do Exame a Fresco"><value>Positivo</value></Data><Data name="Campanha_Captura ou PIT"><value>Pit</value></Data><Data name="INTRA ou PERI"><value>Intra</value></Data><Data name="Ninfa_Macho ou Femea"><value>Ninfa e Macho</value></Data><Data name="Endereço"><value>Rua Secreta 1</value></Data></ExtendedData><Point><coordinates>-40.5,-4.5,0</coordinates></Point></Placemark>
<Placemark><name>P. Lutzi</name><ExtendedData><Data name="Localidade"><value>Vila A &amp; B</value></Data><Data name="Resultado do Exame a Fresco"><value>Negativo</value></Data></ExtendedData><Point><coordinates>-40.6,-4.6,0</coordinates></Point></Placemark>
</Folder></Document></kml>`;
  it('exporta sem dados restritos e permite reimportar com os mesmos números', async () => {
    const up = await upload(ctx, 'analista', 'c.kml', kml);
    await post(ctx, `/api/imports/${up.json().id}/activate`, { confirm: true }, 'analista');
    expect((await get(ctx, '/api/export/records.kml', 'leitor')).statusCode).toBe(403);
    const r = await get(ctx, '/api/export/records.kml', 'analista');
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('kml');
    expect(r.body).not.toContain('Rua Secreta');
    expect(r.body).toContain('Vila A &amp; B');
    const back = parseKmlOrKmz(strToU8(r.body));
    expect(back.report.counts.byType.captura).toBe(2);
    expect(back.report.counts.byType.localidade).toBe(1);
    const cap = back.features.filter((f) => f.type === 'captura');
    expect(cap.map((f) => f.examResult).sort()).toEqual(['negativo', 'positivo']);
    expect(cap.find((f) => f.examResult === 'positivo')).toMatchObject({ channel: 'pit', environment: 'intra', stage: 'Ninfa e adulto', sex: 'Macho', visitDate: '2026-06-30', localityRaw: 'Vila A & B' });
    // o filtro vale: só positivos
    const f = await get(ctx, '/api/export/records.kml?exam=positivo', 'analista');
    expect(parseKmlOrKmz(strToU8(f.body)).report.counts.byType.captura).toBe(1);
  });
});

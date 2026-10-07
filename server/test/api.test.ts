import { beforeEach, describe, expect, it } from 'vitest';
import { SAMPLE, SAMPLE_KMZ, get, post, setup, upload, H, type Ctx } from './helpers.js';

let ctx: Ctx;
beforeEach(async () => {
  ctx = await setup();
});

async function activateSample(file: Uint8Array | string = SAMPLE, name = 'campanha.kml') {
  const up = await upload(ctx, 'analista', name, file);
  expect(up.statusCode).toBe(201);
  const id = up.json().id as number;
  const act = await post(ctx, `/api/imports/${id}/activate`, { confirm: true }, 'analista');
  expect(act.statusCode).toBe(200);
  return id;
}

describe('autenticação e permissões', () => {
  it('exige login e rejeita senha errada', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/api/summary' })).statusCode).toBe(401);
    const r = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: 'admin', password: 'errada' } });
    expect(r.statusCode).toBe(401);
  });
  it('recusa requisições que alteram dados sem o cabeçalho anti-CSRF', async () => {
    const r = await ctx.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: ctx.cookie.admin } });
    expect(r.statusCode).toBe(403);
  });
  it('leitor visualiza, mas não importa nem exporta', async () => {
    await activateSample();
    expect((await get(ctx, '/api/summary', 'leitor')).statusCode).toBe(200);
    expect((await upload(ctx, 'leitor', 'a.kml', SAMPLE)).statusCode).toBe(403);
    expect((await get(ctx, '/api/export/records.csv', 'leitor')).statusCode).toBe(403);
    expect((await get(ctx, '/api/audit', 'analista')).statusCode).toBe(403);
  });
  it('bloqueia a conta após tentativas repetidas', async () => {
    for (let i = 0; i < 5; i++) await ctx.app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: 'leitor', password: 'x' } });
    const r = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: 'leitor', password: 'senha-leitor-123456' } });
    expect(r.statusCode).toBe(429);
  });
});

describe('importação em duas etapas e versões', () => {
  it('importa KML e KMZ válidos e mostra prévia sem ativar', async () => {
    const a = await upload(ctx, 'analista', 'a.kml', SAMPLE);
    const b = await upload(ctx, 'analista', 'b.kmz', SAMPLE_KMZ);
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(201);
    expect(a.json().status).toBe('staged');
    expect(a.json().report.counts).toEqual(b.json().report.counts);
    expect(a.json().report.counts.byType.captura).toBe(20);
    const s = (await get(ctx, '/api/summary')).json();
    expect(s.versao).toBeNull(); // nada ativo ainda
  });
  it('importação inválida não altera os dados ativos', async () => {
    await activateSample();
    const before = (await get(ctx, '/api/summary')).json();
    for (const [name, data] of [['x.kml', 'isto não é xml'], ['y.kml', '<?xml version="1.0"?><!DOCTYPE a [<!ENTITY e SYSTEM "file:///etc/passwd">]><kml/>'], ['z.txt', 'abc']] as const) {
      const r = await upload(ctx, 'analista', name, data);
      expect([400, 422]).toContain(r.statusCode);
    }
    const bad = await upload(ctx, 'analista', 'v.kml', '<kml xmlns="http://www.opengis.net/kml/2.2"><Document/></kml>');
    expect(bad.statusCode).toBe(422);
    expect(bad.json().status).toBe('failed');
    expect((await post(ctx, `/api/imports/${bad.json().id}/activate`, { confirm: true }, 'analista')).statusCode).toBe(409);
    expect((await get(ctx, '/api/summary')).json()).toEqual(before);
  });
  it('exige confirmação, ativa nova versão sem apagar a anterior e permite restaurar', async () => {
    const v1 = await activateSample();
    const up = await upload(ctx, 'analista', 'novo.kml', SAMPLE);
    const id2 = up.json().id as number;
    expect((await post(ctx, `/api/imports/${id2}/activate`, {}, 'analista')).statusCode).toBe(400);
    expect((await post(ctx, `/api/imports/${id2}/activate`, { confirm: true }, 'analista')).json().version).toBe(2);
    const list = (await get(ctx, '/api/imports')).json() as { id: number; status: string }[];
    expect(list.find((i) => i.id === v1)!.status).toBe('archived');
    expect(list.find((i) => i.id === id2)!.status).toBe('active');
    const rest = await post(ctx, `/api/imports/${v1}/restore`, { confirm: true }, 'analista');
    expect(rest.json().status).toBe('active');
    expect(((await get(ctx, '/api/imports')).json() as { id: number; status: string }[]).find((i) => i.id === id2)!.status).toBe('archived');
  });
  it('registra auditoria e gera relatório da importação', async () => {
    const id = await activateSample();
    const rep = await get(ctx, `/api/imports/${id}/report.txt`, 'analista');
    expect(rep.body).toContain('RELATÓRIO DE IMPORTAÇÃO');
    const actions = ((await get(ctx, '/api/audit')).json() as { action: string }[]).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['importacao_enviada', 'importacao_ativada']));
  });
  it('remapeia campos/pastas antes de ativar', async () => {
    const kml = `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Folder><name>Pontos X</name><Placemark><name>p</name><ExtendedData><Data name="Localidade"><value>Vila Z</value></Data><Data name="Laudo"><value>Positivo</value></Data></ExtendedData><Point><coordinates>-40.9,-4.4</coordinates></Point></Placemark></Folder></Document></kml>`;
    const up = await upload(ctx, 'analista', 'm.kml', kml);
    expect(up.json().report.counts.byType.outro).toBe(1);
    const r = await ctx.app.inject({ method: 'PUT', url: `/api/imports/${up.json().id}/mapping`, headers: { ...H, cookie: ctx.cookie.analista }, payload: { folders: { 'Pontos X': 'captura' }, fields: { Laudo: 'resultado_exame' } } });
    expect(r.json().report.counts.byType.captura).toBe(1);
    await post(ctx, `/api/imports/${up.json().id}/activate`, { confirm: true }, 'analista');
    const chart = (await get(ctx, '/api/chart?mode=exame')).json();
    expect(chart.series.find((s: { key: string }) => s.key === 'positivo').data).toEqual([1]);
  });
});

describe('busca ≠ exame, e nunca inferir negativos', () => {
  it('gráficos separam as duas dimensões e batem com os totais', async () => {
    await activateSample();
    const busca = (await get(ctx, '/api/chart?mode=busca')).json();
    const exame = (await get(ctx, '/api/chart?mode=exame')).json();
    const sum = (c: { series: { key: string; data: number[] }[] }, k: string) => c.series.find((s) => s.key === k)!.data.reduce((a, b) => a + b, 0);
    expect(busca.series.map((s: { key: string }) => s.key)).toEqual(['com_captura', 'sem_captura', 'nao_informado']);
    expect(exame.series.map((s: { key: string }) => s.key)).toEqual(['positivo', 'negativo', 'pendente', 'nao_realizado', 'nao_informado']);
    expect(sum(busca, 'com_captura')).toBe(20);
    expect(sum(busca, 'sem_captura')).toBe(4); // visitas explícitas do arquivo
    const examTotal = ['positivo', 'negativo', 'pendente', 'nao_realizado', 'nao_informado'].reduce((a, k) => a + sum(exame, k), 0);
    expect(examTotal).toBe(20); // só registros de captura; visitas não entram
    const s = (await get(ctx, '/api/summary')).json().kpis;
    expect(s.comCaptura.value).toBe(20);
    expect(s.semCaptura.value).toBe(4);
    expect(s.examePositivo.value).toBe(sum(exame, 'positivo'));
    expect(s.pits.value).toBe(3);
  });
  it('sem campo de busca no arquivo, "sem captura" fica ausente (não zero)', async () => {
    const kml = `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Folder><name>Capturas</name><Placemark><name>c</name><ExtendedData><Data name="Localidade"><value>Vila Z</value></Data></ExtendedData><Point><coordinates>-40.9,-4.4</coordinates></Point></Placemark></Folder></Document></kml>`;
    await activateSample(kml, 'so-capturas.kml');
    const k = (await get(ctx, '/api/summary')).json().kpis;
    expect(k.semCaptura).toMatchObject({ value: null, status: 'ausente' });
    expect(k.examePositivo).toMatchObject({ value: null, status: 'ausente' });
    expect(k.comCaptura.value).toBe(1);
    const busca = (await get(ctx, '/api/chart?mode=busca')).json();
    expect(busca.series.find((s: { key: string }) => s.key === 'sem_captura').data.every((n: number) => n === 0)).toBe(true);
  });
  it('visita manual sem captura entra nas contagens com origem "registro manual"', async () => {
    await activateSample(`<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Folder><name>Capturas</name><Placemark><name>c</name><ExtendedData><Data name="Localidade"><value>Vila Z</value></Data></ExtendedData><Point><coordinates>-40.9,-4.4</coordinates></Point></Placemark></Folder></Document></kml>`);
    const r = await post(ctx, '/api/manual-visits', { locality: 'vila z', date: '2026-04-02', result: 'sem_captura', notes: 'sem sinais' }, 'analista');
    expect(r.statusCode).toBe(201);
    expect(r.json().localidadeNova).toBe(false);
    const k = (await get(ctx, '/api/summary')).json().kpis;
    expect(k.semCaptura).toMatchObject({ value: 1, status: 'confirmado' });
    const recs = (await get(ctx, '/api/records?layers=visita')).json();
    expect(recs.rows[0]).toMatchObject({ origin: 'manual', search_result: 'sem_captura', locality_raw: 'Vila Z' });
    // validações
    expect((await post(ctx, '/api/manual-visits', { locality: 'V', date: '2026-04-02', result: 'sem_captura' }, 'analista')).statusCode).toBe(400);
    expect((await post(ctx, '/api/manual-visits', { locality: 'Vila Z', date: '2099-01-01', result: 'sem_captura' }, 'analista')).statusCode).toBe(400);
    expect((await post(ctx, '/api/manual-visits', { locality: 'Vila Z', date: '2026-02-31', result: 'sem_captura' }, 'analista')).statusCode).toBe(400);
    expect((await post(ctx, '/api/manual-visits', { locality: 'Vila Z', date: '2026-04-02', result: 'sem_captura' }, 'leitor')).statusCode).toBe(403);
  });
});

describe('filtros, mapa, tabela e exportação', () => {
  it('filtra por localidade e período de forma consistente (gráfico, mapa, tabela)', async () => {
    await activateSample();
    const locs = (await get(ctx, '/api/localities')).json() as { key: string; name: string; capturas: number }[];
    const loc = locs.find((l) => l.capturas > 0)!;
    const recs = (await get(ctx, `/api/records?locality=${encodeURIComponent(loc.key)}&layers=captura&pageSize=100`)).json();
    expect(recs.total).toBe(loc.capturas);
    const map = (await get(ctx, `/api/map?layers=captura`)).json();
    expect(map.features).toHaveLength(20);
    expect(map.features.every((f: { properties: { address?: string } }) => !('address' in f.properties))).toBe(true);
    const none = (await get(ctx, '/api/records?from=2030-01-01&layers=captura')).json();
    expect(none.total).toBe(0);
  });
  it('preserva polígonos, linhas e pontos no mapa', async () => {
    await activateSample();
    const map = (await get(ctx, '/api/map')).json();
    const kinds = new Set(map.features.map((f: { geometry: { type: string } }) => f.geometry.type));
    expect(kinds).toEqual(new Set(['Point', 'Polygon', 'LineString']));
    expect(map.features.filter((f: { properties: { is_boundary: boolean } }) => f.properties.is_boundary)).toHaveLength(1);
  });
  it('endereço só aparece para perfis autorizados e fora da exportação por padrão', async () => {
    const kml = `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Folder><name>Capturas</name><Placemark><name>=cmd()</name><ExtendedData><Data name="Localidade"><value>Vila Z</value></Data><Data name="Endereço"><value>Rua Secreta 10</value></Data></ExtendedData><Point><coordinates>-40.9,-4.4</coordinates></Point></Placemark></Folder></Document></kml>`;
    await activateSample(kml);
    const asLeitor = await get(ctx, '/api/records?includeAddress=true', 'leitor');
    expect(asLeitor.body).not.toContain('Rua Secreta');
    expect((await get(ctx, '/api/records?includeAddress=true', 'analista')).body).toContain('Rua Secreta');
    const csv = await get(ctx, '/api/export/records.csv', 'analista');
    expect(csv.body).not.toContain('Rua Secreta');
    expect(csv.body).toContain("'=cmd()"); // neutraliza injeção de fórmula
    expect((await get(ctx, '/api/export/records.csv?includeAddress=true', 'analista')).body).toContain('Rua Secreta');
    expect(csv.body).toContain('campanha.kml');
  });
  it('mantém possíveis duplicatas por padrão e só exclui quando o usuário decide', async () => {
    const dup = (id: string) => `<Placemark><name>${id}</name><ExtendedData><Data name="ID"><value>7</value></Data><Data name="Localidade"><value>V1</value></Data></ExtendedData><Point><coordinates>-40.9,-4.4</coordinates></Point></Placemark>`;
    const kml = `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Folder><name>Capturas</name>${dup('a')}${dup('b')}</Folder></Document></kml>`;
    const up = await upload(ctx, 'analista', 'd.kml', kml);
    expect(up.json().report.duplicates).toHaveLength(1);
    await post(ctx, `/api/imports/${up.json().id}/activate`, { confirm: true }, 'analista');
    expect((await get(ctx, '/api/summary')).json().kpis.comCaptura.value).toBe(2);
    const up2 = await upload(ctx, 'analista', 'd2.kml', kml);
    await post(ctx, `/api/imports/${up2.json().id}/activate`, { confirm: true, excludeRepeats: true }, 'analista');
    expect((await get(ctx, '/api/summary')).json().kpis.comCaptura.value).toBe(1);
  });
});

import { readFileSync } from 'node:fs';
import { strToU8 } from 'fflate';
import { beforeAll, describe, expect, it } from 'vitest';
import { handle, type Snapshot } from '../../web/src/static/engine.js';
import { buildSnapshot } from '../src/snapshot.js';
import { SAMPLE, get, post, setup, upload, type Ctx } from './helpers.js';

/** KML no estilo da campanha, com cópias em Resultados e dados restritos (FICTÍCIOS). */
const d = (o: Record<string, string>) => `<ExtendedData>${Object.entries(o).map(([k, v]) => `<Data name="${k}"><value>${v}</value></Data>`).join('')}</ExtendedData>`;
const pt = (lng: number, lat: number) => `<Point><coordinates>${lng},${lat},0</coordinates></Point>`;
const sq = (lng: number, lat: number) => `<Polygon><outerBoundaryIs><LinearRing><coordinates>${lng - 0.01},${lat - 0.01},0 ${lng + 0.01},${lat - 0.01},0 ${lng + 0.01},${lat + 0.01},0 ${lng - 0.01},${lat + 0.01},0 ${lng - 0.01},${lat - 0.01},0</coordinates></LinearRing></outerBoundaryIs></Polygon>`;
const cap = (name: string, o: Record<string, string>, lng: number, lat: number) => `<Placemark><name>${name}</name>${d(o)}${pt(lng, lat)}</Placemark>`;
const CAMPANHA = strToU8(`<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>
<Folder><name>Area das Localidades</name><Placemark><name>Vila Alfa</name>${sq(-40.9, -4.4)}</Placemark><Placemark><name>Sítio Beta</name>${sq(-40.8, -4.3)}</Placemark></Folder>
<Folder><name>Coleta</name>
${cap('Brasiliensis', { Localidade: 'Vila Alfa', 'Numero da Residencia': '12', 'Nº da Etiqueta': '5', 'Data de Captura': '30/06/2026', 'Campanha_Captura ou PIT': 'Pit', 'INTRA ou PERI': 'Intra', 'Ninfa_Macho ou Femea': 'Femea', 'Resultado do Exame a Fresco': 'Positivo', 'Data do exame': '01/07/2026' }, -40.9, -4.4)}
${cap('P. Lutzi', { Localidade: 'Sitio Beta', 'Numero da Residencia': '7', 'Data de Captura': '27/07/2026', 'Campanha_Captura ou PIT': 'Captura', 'INTRA ou PERI': 'Peri', 'Ninfa_Macho ou Femea': 'Ninfa', 'Resultado do Exame a Fresco': 'Negativo' }, -40.8, -4.3)}
</Folder>
<Folder><name>Positivos</name>${cap('Triatominio', { Localidade: 'Vila Alfa', 'Numero da Residencia': '12', 'Campanha_Captura ou PIT': 'PIT', 'INTRA ou PERI': 'INTRA', 'Ninfa_Macho ou Femea': 'Femea', 'Resultado do Exame a Fresco': 'Positivo' }, -40.9, -4.4)}</Folder>
<Folder><name>pits</name><Placemark><name>PIT 01</name>${d({ 'Nome do PIT': 'X', 'Endereço Completo': 'Rua Secreta 99' })}${pt(-40.9, -4.4)}</Placemark></Folder>
</Document></kml>`);

const URLS = [
  '/api/summary',
  '/api/summary?exam=positivo',
  '/api/summary?from=2026-07-01&to=2026-12-31',
  '/api/chart?mode=busca&sort=total&hideEmpty=true',
  '/api/chart?mode=exame&sort=nome&hideEmpty=false',
  '/api/chart?mode=exame&sort=total&hideEmpty=true&channel=pit',
  '/api/localities',
  '/api/localities?exam=positivo',
  '/api/map',
  '/api/map?layers=captura,pit&exam=negativo',
  '/api/records?pageSize=50&sort=visit_date&dir=desc',
  '/api/records?pageSize=50&sort=locality_raw&dir=asc&layers=captura',
  '/api/records?pageSize=2&page=2&sort=species&dir=asc',
  '/api/records?q=lutzi&layers=captura',
];

const sortKeys = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as object).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sortKeys(x)]));
  return v;
};
/** O servidor numera as linhas do banco; o painel compartilhado usa a posição no arquivo. Comparamos o conteúdo. */
const norm = (v: unknown) => JSON.parse(JSON.stringify(v, (k, x) => (k === 'rid' ? undefined : typeof x === 'number' && !Number.isInteger(x) ? Math.round(x * 1e6) / 1e6 : x))) as unknown;

describe.each([
  ['arquivo de exemplo', new Uint8Array(SAMPLE), 'exemplo.kml'],
  ['KML no formato da campanha', CAMPANHA, 'campanha.kml'],
])('painel compartilhado × servidor: %s', (_n, bytes, name) => {
  let ctx: Ctx;
  let snap: Snapshot;
  beforeAll(async () => {
    ctx = await setup();
    snap = buildSnapshot(bytes, name, { precision: 8 });
    const up = await upload(ctx, 'analista', name, bytes);
    const rep = up.json().report as { duplicates: { crossFolder: boolean }[] };
    const exclude = rep.duplicates.length > 0 && rep.duplicates.every((x) => x.crossFolder);
    await post(ctx, `/api/imports/${up.json().id}/activate`, { confirm: true, excludeRepeats: exclude }, 'analista');
  });

  it.each(URLS)('%s devolve os mesmos números', async (url) => {
    const server = (await get(ctx, url)).json() as unknown;
    const local = handle(snap, url);
    if (url.startsWith('/api/summary')) {
      const a = server as { kpis: unknown };
      expect(sortKeys(norm((local as { kpis: unknown }).kpis))).toEqual(sortKeys(norm(a.kpis)));
    } else if (url.startsWith('/api/localities')) {
      const byKey = (x: { key: string }[]) => [...x].sort((p, q) => p.key.localeCompare(q.key));
      expect(sortKeys(byKey(local as { key: string }[]))).toEqual(sortKeys(byKey(server as { key: string }[])));
    } else if (url.startsWith('/api/map')) {
      const feats = (x: { features: { properties: { rid: string } }[] }) => (norm(x) as { features: object[] }).features;
      const sorter = (a: object, b: object) => JSON.stringify(a).localeCompare(JSON.stringify(b));
      expect(feats(local as never).sort(sorter)).toEqual(feats(server as never).sort(sorter));
    } else if (url.startsWith('/api/records')) {
      const l = local as { total: number; rows: unknown[] };
      const s = server as { total: number; rows: unknown[] };
      expect(l.total).toBe(s.total);
      const strip = (rows: unknown[]) => rows.map((r) => ({ ...(norm(r) as object), property_ref: null, pit_ref: null }));
      expect(sortKeys(strip(l.rows))).toEqual(sortKeys(strip(s.rows)));
    } else {
      expect(sortKeys(norm(local))).toEqual(sortKeys(norm(server)));
    }
  });
});

describe('privacidade do painel compartilhado', () => {
  const snap = buildSnapshot(CAMPANHA, 'campanha.kml');
  const text = JSON.stringify(snap);
  it('não leva endereço, número do imóvel, etiqueta nem valores brutos', () => {
    expect(text).not.toContain('Rua Secreta');
    expect(text).not.toContain('Residencia');
    expect(text).not.toContain('"property_ref"');
    expect(text).not.toContain('originalValues');
    expect(snap.sobre.camposRestritosRemovidos.length).toBeGreaterThan(0);
  });
  it('exclui as cópias entre pastas por padrão e mantém quando pedido', () => {
    expect(snap.sobre.duplicatasExcluidas).toBe(1);
    expect(buildSnapshot(CAMPANHA, 'x.kml', { excludeRepeats: false }).sobre.duplicatasExcluidas).toBe(0);
  });
  it('arredonda as coordenadas', () => {
    const p = snap.rec.find((r) => r.type === 'captura')!;
    expect(String(p.lat).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(5);
  });
  it('lê KML grande sem estourar (smoke)', () => {
    expect(readFileSync(new URL('./fixtures/exemplo-ficticio.kml', import.meta.url)).length).toBeGreaterThan(1000);
  });
});

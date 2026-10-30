// Medições de desempenho com dados sintéticos. Cada medida é de UMA execução, nesta máquina, em Node (não no navegador).
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, platform, totalmem } from 'node:os';
import { it } from 'vitest';
import { parseFile } from '../src/parse.js';
import { profileTable } from '../src/profile.js';
import { analyzeJoin, joinTables } from '../src/join/join.js';
import { countPointsIn } from '../src/join/spatial.js';
import type { Geometry } from '../src/geo/geometry.js';
import type { Row, Table } from '../src/types.js';

const medidas: Record<string, unknown> = {};
const tempo = async <T>(nome: string, f: () => Promise<T> | T, extra: (r: T) => Record<string, unknown> = () => ({})): Promise<T> => {
  const t0 = performance.now();
  const r = await f();
  medidas[nome] = { ms: Math.round(performance.now() - t0), ...extra(r) };
  return r;
};

it('desempenho', async () => {
  const linhas = ['id;uf;nome;valor;taxa;data;a;b;c;d;e;f'];
  for (let i = 0; i < 300000; i++) linhas.push([i, 'UF' + (i % 27), 'cidade numero ' + (i % 5000), ((i * 7) % 10000) + ',50', (i % 100) + '%', '2024-0' + (1 + (i % 9)) + '-15', i % 3, i % 5, i % 7, 'texto ' + (i % 11), i * 3, 'x'].join(';'));
  const bytes = new TextEncoder().encode(linhas.join('\n'));
  medidas.csv = { megabytes: +(bytes.length / 1048576).toFixed(1), linhasNoArquivo: 300000, colunas: 12 };
  const ds = await tempo('leitura_csv', () => parseFile('grande.csv', bytes), (d) => ({ linhasLidas: d.tables[0]!.rows.length, naoLidas: d.info!.truncated }));
  await tempo('perfil_colunas', () => profileTable(ds.tables[0]!));

  // junção: 200 mil linhas contra 5 mil chaves
  const esq: Table = { name: 'esq', columns: ['k', 'v'], rows: Array.from({ length: 200000 }, (_, i): Row => ({ k: String(i % 5000), v: i })) };
  const dir: Table = { name: 'dir', columns: ['k', 'p'], rows: Array.from({ length: 5000 }, (_, i): Row => ({ k: String(i), p: i * 2 })) };
  const spec = { kind: 'chave' as const, left: 'esq', right: 'dir', leftKey: 'k', rightKey: 'k', how: 'left' as const };
  await tempo('analise_juncao_200k_x_5k', () => analyzeJoin(esq, dir, spec), (a) => ({ resultado: a.resultRows }));
  await tempo('juncao_200k_x_5k', () => joinTables(esq, dir, spec), (t) => ({ linhas: t.rows.length }));

  // pontos em polígonos: 5.000 polígonos x 10.000 pontos
  const shapes: Record<string, Geometry> = {};
  const areas: Table = { name: 'areas', columns: ['id_geom'], geo: { lat: 'la', lon: 'lo', id: 'id_geom' }, shapes, rows: [] };
  for (let i = 0; i < 5000; i++) {
    const x = (i % 100) * 0.1;
    const y = Math.floor(i / 100) * 0.1;
    shapes['g' + i] = { type: 'Polygon', coordinates: [[[x, y], [x + 0.08, y], [x + 0.08, y + 0.08], [x, y + 0.08], [x, y]]] };
    areas.rows.push({ id_geom: 'g' + i });
  }
  const pontos: Table = { name: 'pontos', columns: ['latitude', 'longitude'], geo: { lat: 'latitude', lon: 'longitude' }, rows: Array.from({ length: 10000 }, (_, i): Row => ({ latitude: ((i * 37) % 500) / 100, longitude: ((i * 91) % 1000) / 100 })) };
  await tempo('pontos_em_poligonos_10k_x_5k', () => countPointsIn(areas, pontos), (r) => ({ dentro: Object.values(r.counts).reduce((a, b) => a + b, 0), fora: r.outside }));

  mkdirSync('../docs/benchmarks', { recursive: true });
  writeFileSync('../docs/benchmarks/ultimo.json', JSON.stringify({ geradoEm: new Date().toISOString(), ambiente: { node: process.version, so: platform(), cpu: cpus()[0]?.model, memoriaGB: +(totalmem() / 1073741824).toFixed(1) }, observacao: 'uma execução por medida, em Node; não vale para o navegador', medidas }, null, 2));
});

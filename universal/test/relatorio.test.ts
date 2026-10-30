// Fase 8: modelos do relatório PDF e tabela territorial (dados sintéticos; valores calculados à mão).
import { describe, expect, it } from 'vitest';
import { profileTable } from '../src/profile.js';
import { applyTemplate, buildPdfDoc } from '../src/report.js';
import type { ReportModel } from '../src/report.js';
import { buildTerritory } from '../src/reports/territory.js';
import type { Geometry } from '../src/geo/geometry.js';
import type { Row, Table } from '../src/types.js';

const quad = (x: number): Geometry => ({ type: 'Polygon', coordinates: [[[x, 0], [x + 1, 0], [x + 1, 1], [x, 1], [x, 0]]] });
const bairros = (): Table => ({
  name: 'bairros',
  columns: ['id_geom', 'nome', 'pop', 'latitude', 'longitude', 'geometria'],
  geo: { lat: 'latitude', lon: 'longitude', id: 'id_geom' },
  shapes: { g1: quad(0), g2: quad(2), g3: quad(4), g4: quad(6), g5: quad(8), g6: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [0, 0]]] } },
  rows: [
    { id_geom: 'g1', nome: 'A', pop: 100, latitude: 0.5, longitude: 0.5, geometria: 'Polygon' },
    { id_geom: 'g2', nome: 'B', pop: 500, latitude: 0.5, longitude: 2.5, geometria: 'Polygon' },
    { id_geom: 'g3', nome: 'C', pop: 300, latitude: 0.5, longitude: 4.5, geometria: 'Polygon' },
    { id_geom: 'g4', nome: 'D', pop: null, latitude: 0.5, longitude: 6.5, geometria: 'Polygon' },
    { id_geom: 'g5', nome: 'E', pop: 200, latitude: 0.5, longitude: 8.5, geometria: 'Polygon' },
    { id_geom: 'g6', nome: 'F', pop: 400, latitude: null, longitude: null, geometria: 'Polygon' },
  ] as Row[],
});

describe('relatório territorial', () => {
  const t = bairros();
  const tr = buildTerritory(t, profileTable(t))!;
  it('uma linha por unidade, da maior para a menor medida, “sem dado” no fim', () => {
    expect(tr.columns).toEqual(['Unidade', 'Geometria', 'pop', 'Classe']);
    expect(tr.rows.map((r) => r[0])).toEqual(['B', 'F', 'C', 'E', 'A', 'D']);
    expect(tr.rows.find((r) => r[0] === 'D')).toEqual(['D', 'Polygon', 'sem dado', 'sem dado']);
  });
  it('classes por quantis (5 valores → 5 classes, a maior unidade na classe 5)', () => {
    expect(tr.rows.find((r) => r[0] === 'B')![3]).toBe('classe 5 de 5');
    expect(tr.rows.find((r) => r[0] === 'A')![3]).toBe('classe 1 de 5');
  });
  it('notas: contagem de unidades e problema de geometria; mapa fora do PDF', () => {
    expect(tr.notes.join(' ')).toMatch(/6 unidade/);
    expect(tr.notes.join(' ')).toMatch(/1 com problema de geometria/);
    expect(tr.notes.join(' ')).toMatch(/mapa não entra no PDF/);
  });
  it('tabela sem coordenadas não tem seção territorial', () => {
    expect(buildTerritory({ name: 'x', columns: ['a'], rows: [{ a: 1 }] }, profileTable({ name: 'x', columns: ['a'], rows: [{ a: 1 }] }))).toBeUndefined();
  });
});

describe('modelos do relatório', () => {
  const chart = (i: number) => ({ title: `G${i}`, paragraphs: [], images: [] });
  const modelo = (): ReportModel => ({
    title: 'T', generatedAt: 'agora', version: '0.8.0', origin: [['Arquivo', 'a.csv']], records: [], adjustments: ['filtro x'], kpis: [['Registros', '6']],
    charts: [1, 2, 3, 4, 5, 6].map(chart), criteria: ['c1'], limits: ['l1'], reproduce: 'r',
    sample: { columns: ['a'], rows: [['1']] }, territory: { title: 'Território', columns: ['Unidade'], rows: Array.from({ length: 12 }, (_, i) => [`U${i}`]), notes: ['n'] },
  });
  it('completo não muda nada', () => {
    const m = modelo();
    expect(applyTemplate(m, 'completo')).toBe(m);
  });
  it('resumido: 4 gráficos, sem amostra, território curto e aviso do que ficou de fora; filtros e critérios ficam', () => {
    const r = applyTemplate(modelo(), 'resumido');
    expect(r.charts).toHaveLength(4);
    expect(r.sample).toBeUndefined();
    expect(r.territory!.rows).toHaveLength(10);
    expect(r.limits[0]).toMatch(/2 gráfico\(s\)/);
    expect(r.limits).toContain('l1');
    expect(r.adjustments).toEqual(['filtro x']);
    expect(r.criteria).toEqual(['c1']);
  });
  it('o PDF traz o anexo territorial com as notas e a tabela', () => {
    const txt = JSON.stringify(buildPdfDoc(modelo()).content);
    expect(txt).toContain('Anexo B. Território');
    expect(txt).toContain('U11');
    expect(JSON.stringify(buildPdfDoc(applyTemplate(modelo(), 'resumido')).content)).not.toContain('Anexo A. Amostra');
  });
});

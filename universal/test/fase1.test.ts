// Regressões da Fase 1 (dados 100% sintéticos).
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { csvField } from '../src/csv.js';
import { docxToMatrix } from '../src/docx.js';
import { parseFile } from '../src/parse.js';
import { compareTables } from '../src/project.js';
import type { Table } from '../src/types.js';

const col = (vals: (string | number | null)[]): Table => ({ name: 't', columns: ['v'], rows: vals.map((v) => ({ v })) });

describe('comparação de versões (project.ts)', () => {
  it('lê decimal com ponto e vírgula do mesmo jeito que o restante do painel', () => {
    const antes = col(['1234.5', '10,5', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11']);
    const depois = col(['1234.5', '10,5', '2', '3', '4', '5', '6', '7', '8', '9', '10', '12']);
    const d = compareTables(antes, depois);
    expect(d.sums).toEqual([{ col: 'v', before: 1234.5 + 10.5 + 2 + 3 + 4 + 5 + 6 + 7 + 8 + 9 + 10 + 11, after: 1234.5 + 10.5 + 2 + 3 + 4 + 5 + 6 + 7 + 8 + 9 + 10 + 12 }]);
  });
  it('vazio e texto não numérico não entram na soma', () => {
    const mk = (extra: string | null) => col([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, extra, 'abc']);
    expect(compareTables(mk(null), mk(null)).sums).toEqual([]);
  });
});

describe('exportação CSV (csv.ts)', () => {
  it('neutraliza fórmulas e preserva números negativos', () => {
    expect(csvField('=1+1')).toBe("'=1+1");
    expect(csvField('@SOMA(A1)')).toBe("'@SOMA(A1)");
    expect(csvField('+55 85 9999')).toBe("'+55 85 9999");
    expect(csvField('-cmd')).toBe("'-cmd");
    expect(csvField('-12,5')).toBe('-12,5');
    expect(csvField(-3)).toBe('-3');
    expect(csvField(null)).toBe('');
  });
  it('mantém as regras de aspas', () => {
    expect(csvField('a;b')).toBe('"a;b"');
    expect(csvField('diz "oi"')).toBe('"diz ""oi"""');
    expect(csvField('linha\n2')).toBe('"linha\n2"');
  });
});

describe('GeoJSON poligonal', () => {
  it('o vértice de fechamento não pesa duas vezes no ponto de referência', async () => {
    const g = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { n: 'q' }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] } }] };
    const r = (await parseFile('p.geojson', strToU8(JSON.stringify(g)))).tables[0]!.rows[0]!;
    expect(r.latitude).toBeCloseTo(5);
    expect(r.longitude).toBeCloseTo(5);
  });
});

describe('arquivos compactados e XML (entradas hostis)', () => {
  it('KMZ cujo KML declara mais de 50 MB não é descompactado', async () => {
    const z = zipSync({ 'doc.kml': new Uint8Array(51 * 1024 * 1024) }, { level: 9 });
    expect(z.length).toBeLessThan(200_000);
    await expect(parseFile('bomba.kmz', z)).rejects.toThrow();
  });
  it('KML com DOCTYPE/entidades é recusado', async () => {
    const xml = '<?xml version="1.0"?><!DOCTYPE kml [<!ENTITY a "aaaa">]><kml><Document><Placemark><name>&a;</name></Placemark></Document></kml>';
    await expect(parseFile('x.kml', strToU8(xml))).rejects.toThrow(/DOCTYPE/);
  });
  it('DOCX com DOCTYPE no documento é recusado', () => {
    const xml = '<?xml version="1.0"?><!DOCTYPE w [<!ENTITY a "x">]><w:document xmlns:w="w"><w:body/></w:document>';
    expect(() => docxToMatrix(zipSync({ 'word/document.xml': strToU8(xml) }))).toThrow(/DOCTYPE/);
  });
  it('DOCX que declara document.xml acima de 60 MB não é lido', () => {
    const z = zipSync({ 'word/document.xml': new Uint8Array(61 * 1024 * 1024) }, { level: 9 });
    expect(() => docxToMatrix(z)).toThrow();
  });
  it('arquivo corrompido gera erro compreensível', async () => {
    await expect(parseFile('x.kmz', strToU8('isto não é zip'))).rejects.toThrow();
    await expect(parseFile('x.xlsx', strToU8('isto não é xlsx'))).rejects.toThrow();
  });
});

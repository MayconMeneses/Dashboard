import { describe, expect, it } from 'vitest';
import { parseFile } from '../src/parse.js';
import { profileTable, toDate, toNumber } from '../src/profile.js';
import { chartData, kpis, suggestCharts } from '../src/suggest.js';

const enc = (s: string) => new TextEncoder().encode(s);

describe('leitura', () => {
  it('lê CSV com BOM, vírgula decimal e vazios', async () => {
    const d = await parseFile('v.csv', enc('﻿cidade,valor,data\nA,"1.234,50",01/02/2024\nB,,03/02/2024\nA,10,2024-03-05\n'));
    expect(d.tables[0]!.rows).toHaveLength(3);
    expect(d.tables[0]!.rows[1]!.valor).toBeNull();
  });
  it('lê JSON em lista, objeto com listas e GeoJSON', async () => {
    expect((await parseFile('a.json', enc('[{"a":1},{"a":2,"b":"x"}]'))).tables[0]!.columns).toEqual(['a', 'b']);
    expect((await parseFile('b.json', enc('{"vendas":[{"x":1}],"meta":{"k":1}}'))).tables[0]!.name).toBe('vendas');
    const g = await parseFile('c.geojson', enc(JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { n: 'p' }, geometry: { type: 'Point', coordinates: [-40.9, -4.4] } }] })));
    expect(g.tables[0]!.rows[0]!.latitude).toBeCloseTo(-4.4);
    expect(g.tables[0]!.geo).toBeDefined();
  });
  it('lê KML com ExtendedData e rejeita DOCTYPE', async () => {
    const kml = '<kml><Document><Folder><name>F</name><Placemark><name>P1</name><ExtendedData><Data name="tipo"><value>X</value></Data></ExtendedData><Point><coordinates>-40.9,-4.4,0</coordinates></Point></Placemark></Folder></Document></kml>';
    const d = await parseFile('a.kml', enc(kml));
    expect(d.tables[0]!.rows[0]).toMatchObject({ nome: 'P1', tipo: 'X', pasta: 'F', latitude: -4.4 });
    await expect(parseFile('b.kml', enc('<!DOCTYPE x [<!ENTITY a "b">]>' + kml))).rejects.toThrow(/DOCTYPE/);
  });
  it('rejeita formato desconhecido e arquivo vazio', async () => {
    await expect(parseFile('a.exe', enc('x'))).rejects.toThrow(/não suportado/);
    await expect(parseFile('a.csv', enc(''))).rejects.toThrow(/Nenhum dado/);
  });
});

describe('perfil e gráficos', () => {
  it('converte números e datas brasileiros', () => {
    expect(toNumber('1.234,5')).toBe(1234.5);
    expect(toNumber('abc')).toBeNull();
    expect(toDate('31/02/2024')).toBeNull();
    expect(toDate('05/03/2024')).toBe(Date.UTC(2024, 2, 5));
  });
  it('infere tipos e sugere gráficos adequados', async () => {
    const lines = ['bairro,status,valor,data,lat,lon'];
    for (let i = 0; i < 40; i++) lines.push(`B${i % 5},${i % 2 ? 'ok' : 'falha'},${i * 3},2024-0${1 + (i % 4)}-10,-4.${i},-40.${i}`);
    const t = (await parseFile('x.csv', enc(lines.join('\n')))).tables[0]!;
    const p = profileTable(t);
    expect(Object.fromEntries(p.map((c) => [c.name, c.type]))).toMatchObject({ bairro: 'category', valor: 'integer', data: 'date', lat: 'lat', lon: 'lon' });
    const s1 = suggestCharts(t, p, 1);
    const s3 = suggestCharts(t, p, 3);
    expect(s1.length).toBeLessThan(s3.length);
    expect(s3.some((c) => c.kind === 'map')).toBe(true);
    expect(kpis(t, p)[0]!.value).toBe('40');
  });
  it('não transforma ausente em zero e preenche meses vazios', async () => {
    const t = (await parseFile('x.csv', enc('d,v\n2024-01-05,1\n2024-04-05,\n2024-04-06,3\n'))).tables[0]!;
    const sd = chartData(t, { id: 'l', kind: 'line', x: 'd', y: 'v', agg: 'sum', title: '', description: '', score: 1 });
    expect(sd.labels).toEqual(['2024-01', '2024-02', '2024-03', '2024-04']);
    expect(sd.values).toEqual([1, 0, 0, 3]);
    const mean = chartData(t, { id: 'b', kind: 'bar', x: 'd', y: 'v', agg: 'mean', title: '', description: '', score: 1 });
    expect(mean.labels).not.toContain('2024-04-05');
  });
});

import { bestCorrelation, qualityAlerts } from '../src/suggest.js';
describe('qualidade e correlação', () => {
  it('detecta correlação, duplicatas, vazias e constantes', async () => {
    const L = ['a,b,c,k'];
    for (let i = 0; i < 20; i++) L.push(`${i},${i * 2 + (i % 3)},,x`);
    L.push('1,3,,x');
    const t = (await parseFile('q.csv', enc(L.join('\n')))).tables[0]!;
    const p = profileTable(t);
    const c = bestCorrelation(t, p.filter((x) => x.type === 'integer' && x.unique > 2));
    expect(c).toMatchObject({ a: 'a', b: 'b' });
    expect(c!.r).toBeGreaterThan(0.95);
    const txt = qualityAlerts(t, p).map((a) => a.text).join('|');
    expect(txt).toMatch(/idêntica/);
    expect(txt).toMatch(/“c” está totalmente vazia/);
    expect(txt).toMatch(/“k” tem um único valor/);
  });
  it('permite forçar o tipo de uma coluna', async () => {
    const t = (await parseFile('f.csv', enc('cod,v\n1,a\n2,b\n3,a\n1,b\n2,a\n3,b\n1,a\n'))).tables[0]!;
    expect(profileTable(t).find((x) => x.name === 'cod')!.type).not.toBe('text');
    expect(profileTable(t, { cod: 'text' }).find((x) => x.name === 'cod')!.type).toBe('text');
  });
});

describe('planilha de formulário', () => {
  it('separa blocos e ignora títulos acima do cabeçalho', async () => {
    const csv = ['TÍTULO,,,', 'A,B,C,D', '', 'BLOCO UM,,,', 'ciclo,x,y,z', 'c1,1,2,3', 'c2,4,5,6', 'c3,7,8,9', '', 'func,a,b', 'f1,1,2', 'f2,3,4', 'f3,5,6'].join('\n');
    const d = await parseFile('form.csv', enc(csv));
    expect(d.tables).toHaveLength(2);
    expect(d.tables[0]!.columns).toEqual(['ciclo', 'x', 'y', 'z']);
    expect(d.tables[0]!.rows).toHaveLength(3);
    expect(d.tables[1]!.columns).toEqual(['func', 'a', 'b']);
  });
});

describe('tabela por rótulo (ex.: ciclos)', () => {
  it('plota cada indicador por linha, na ordem do arquivo, sem histograma de poucos pontos', async () => {
    const t = (await parseFile('c.csv', enc('ciclo,trab,pct\n1º Ciclo,8219,"87,19"\n2º Ciclo,4587,"48,64"\n3º Ciclo,,"66,36"\n'))).tables[0]!;
    const s = suggestCharts(t, profileTable(t), 2);
    expect(s.some((c) => c.kind === 'hist')).toBe(false);
    const c = s.find((x) => x.y === 'trab')!;
    expect(c.keepOrder).toBe(true);
    expect(chartData(t, c).labels).toEqual(['1º Ciclo', '2º Ciclo']);
    expect(chartData(t, s.find((x) => x.y === 'pct')!).values).toEqual([87.19, 48.64, 66.36]);
  });
});

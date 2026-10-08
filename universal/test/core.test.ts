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

import { bestCorrelation, qualityAlerts, rateData } from '../src/suggest.js';
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

describe('comparativo e contexto', () => {
  it('compara colunas de mesma grandeza e guarda título/contexto', async () => {
    const csv = ['PLANILHA X,,,', 'MUNICÍPIO:,CROATÁ,,', '', 'VISITAS,,,', 'ciclo,a,b,total', 'c1,3,3,6000', 'c2,12,15,9000', 'c3,4,9,7000'].join('\n');
    const d = await parseFile('p.csv', enc(csv));
    const t = d.tables[0]!;
    expect(t.title).toBe('VISITAS');
    expect(t.context).toMatch(/CROATÁ/);
    const m = suggestCharts(t, profileTable(t), 2).find((c) => c.kind === 'multi')!;
    expect(m.series).toEqual(['a', 'b']);
    const sd = chartData(t, m);
    expect(sd.datasets!.map((x) => x.values)).toEqual([[3, 12, 4], [3, 15, 9]]);
  });
});

import { readFileSync } from 'node:fs';
describe('PDF', () => {
  const load = async () => {
    const lib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    return lib as unknown as NonNullable<Parameters<typeof parseFile>[2]>['pdfjs'];
  };
  it('extrai a tabela de blocos mensais de um PDF e a reorganiza', async () => {
    const d = await parseFile('tabela-meses.pdf', new Uint8Array(readFileSync(new URL('./fixtures/tabela-meses.pdf', import.meta.url))), { pdfjs: await load() });
    const t = d.tables[0]!;
    expect(t.tidy).toBeDefined();
    expect(t.rows.length).toBe(3 * 10 * 4);
    expect([...new Set(t.rows.map((r) => r['Mês']))]).toEqual(['Janeiro', 'Fevereiro', 'Março']);
    expect(new Set(t.rows.map((r) => r['Município'])).size).toBe(4);
    expect(t.notes!.join(' ')).toMatch(/PDF/);
  });
  it('PDF só com texto vira tabela de linhas, com aviso', async () => {
    const d = await parseFile('texto.pdf', new Uint8Array(readFileSync(new URL('./fixtures/texto.pdf', import.meta.url))), { pdfjs: await load() });
    expect(d.tables[0]!.columns).toEqual(['Página', 'Linha', 'Texto']);
    expect(d.tables[0]!.notes![0]).toMatch(/texto linha a linha/);
  });
});

describe('blocos repetidos (um por mês)', () => {
  const csv = [
    'Controle 2026,,,,', 'Mês,Janeiro,,,', 'Municipio,A,B,C,Total', 'Notificados Dengue,10,20,,', 'Notificados Zica,1,0,0,', 'Confirmados Dengue,4,5,6,', 'Confirmados Zica,0,0,0,', 'Descartados Dengue,6,15,,', 'Descartados Zica,1,0,0,', 'Em Andamento,0,0,0,', '',
    'Mês,FEVEREIRO,,,', 'Municipio,A,B,C,Total', 'Notificados Dengue,30,40,50,', 'Notificados Zica,0,0,0,', 'Confirmados Dengue,9,9,9,', 'Confirmados Zica,0,0,0,', 'Descartados Dengue,21,31,41,', 'Descartados Zica,0,0,0,', 'Em Andamento,1,1,1,',
  ].join('\n');
  it('reúne os blocos, ignora coluna vazia, mantém sem dado e separa situação/agravo', async () => {
    const t = (await parseFile('c.csv', enc(csv))).tables[0]!;
    expect(t.tidy).toBeDefined();
    expect(t.columns).toEqual(['Mês', 'Município', 'Indicador', 'Situação', 'Agravo', 'Total']);
    expect([...new Set(t.rows.map((r) => r['Mês']))]).toEqual(['Janeiro', 'Fevereiro']);
    expect(t.rows.filter((r) => r['Total'] == null)).toHaveLength(2); // C em Notificados/Descartados Dengue de janeiro
    expect(t.rows.find((r) => r['Indicador'] === 'Em Andamento')!['Agravo']).toBeNull();
    expect(t.notes!.join(' ')).toMatch(/“Total”/);
  });
  it('gráficos somam certo, deixam lacuna (não zero) e o filtro ∅ aceita indicador sem agravo', async () => {
    const t = (await parseFile('c.csv', enc(csv))).tables[0]!;
    const specs = suggestCharts(t, profileTable(t), 2);
    const rank = specs.find((s) => s.id === 'tid-rank')!;
    const r = chartData(t, rank);
    expect(Object.fromEntries(r.labels.map((l, i) => [l, r.values[i]]))).toEqual({ A: 40, B: 60, C: 50 });
    const mes = chartData(t, specs.find((s) => s.id === 'tid-mes-ent')!);
    expect(mes.datasets!.find((s) => s.label === 'C')!.values[0]).toBeNaN();
    const evo = chartData(t, specs.find((s) => s.id === 'tid-evol')!);
    expect(evo.datasets!.some((s) => s.label === 'Em Andamento')).toBe(true);
  });
});

describe('positividade sobre as colunas', () => {
  const csv = ['Mês,Janeiro,,', 'Municipio,A,B,Total', 'Notificados Dengue,100,50,', 'Notificados Zica,1,1,', 'Confirmados Dengue,20,10,', 'Confirmados Zica,0,0,', 'Descartados Dengue,60,30,', 'Descartados Zica,1,1,', 'Em Andamento,20,10,', '', 'Mês,Fevereiro,,', 'Municipio,A,B,Total', 'Notificados Dengue,10,10,', 'Notificados Zica,0,0,', 'Confirmados Dengue,5,5,', 'Confirmados Zica,0,0,', 'Descartados Dengue,0,0,', 'Descartados Zica,0,0,', 'Em Andamento,5,5,'].join('\n');
  it('calcula a taxa por mês nas duas definições e deixa lacuna sem concluídos', async () => {
    const t = (await parseFile('p.csv', enc(csv))).tables[0]!;
    const s = suggestCharts(t, profileTable(t), 2).find((c) => c.id === 'tid-pos')!;
    expect(s.rate!.options).toHaveLength(2);
    const a = rateData(t, s, 0)!;
    expect(a.labels).toEqual(['Janeiro', 'Fevereiro']);
    expect(a.values[0]).toBeCloseTo((30 / (30 + 90)) * 100); // 30 confirmados ÷ (30 + 90 descartados)
    expect(a.values[1]).toBeCloseTo(100); // 10 confirmados, 0 descartados
    const b = rateData(t, s, 1)!;
    expect(b.values[0]).toBeCloseTo((30 / 150) * 100);
  });
});

import { strToU8, zipSync } from 'fflate';
describe('Word (.docx)', () => {
  const p = (t: string) => `<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
  const cell = (t: string, span = 1) => `<w:tc>${span > 1 ? `<w:tcPr><w:gridSpan w:val="${span}"/></w:tcPr>` : ''}${p(t)}</w:tc>`;
  const row = (c: string[]) => `<w:tr>${c.map((x) => cell(x)).join('')}</w:tr>`;
  const table = (rows: string[][]) => `<w:tbl>${rows.map(row).join('')}</w:tbl>`;
  const docx = (body: string) => zipSync({ 'word/document.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="x"><w:body>${body}</w:body></w:document>`) });
  const hdr = ['Municipio', 'A', 'B', 'Total'];
  const rows = (k: number) => [hdr, ['Notificados Dengue', `${k}0`, `${k}5`, ''], ['Notificados Zica', '1', '0', ''], ['Confirmados Dengue', '4', '2', ''], ['Confirmados Zica', '0', '0', ''], ['Descartados Dengue', '5', '3', ''], ['Descartados Zica', '0', '0', ''], ['Em Andamento', '1', '0', '']];
  it('lê tabelas do Word, com o período em parágrafos acima de cada tabela, e as reorganiza', async () => {
    const f = docx(p('Controle (fictício)') + '<w:p><w:r><w:t xml:space="preserve">Mês: </w:t></w:r><w:r><w:t>Janeiro</w:t></w:r></w:p>' + table(rows(1)) + p('Mês Fevereiro') + table(rows(2)));
    const t = (await parseFile('c.docx', f)).tables[0]!;
    expect(t.tidy).toBeDefined();
    expect([...new Set(t.rows.map((r) => r['Mês']))]).toEqual(['Janeiro', 'Fevereiro']);
    expect(t.rows.find((r) => r['Mês'] === 'Fevereiro' && r['Município'] === 'B' && r['Indicador'] === 'Notificados Dengue')!['Total']).toBe(25);
    expect(t.notes!.join(' ')).toMatch(/Word/);
  });
  it('célula mesclada (gridSpan) mantém as colunas alinhadas', async () => {
    const f = docx(`<w:tbl><w:tr>${cell('Título', 3)}</w:tr><w:tr>${['Nome', 'X', 'Y'].map((x) => cell(x)).join('')}</w:tr><w:tr>${['a', '1', '2'].map((x) => cell(x)).join('')}</w:tr><w:tr>${['b', '3', '4'].map((x) => cell(x)).join('')}</w:tr><w:tr>${['c', '5', '6'].map((x) => cell(x)).join('')}</w:tr></w:tbl>`);
    const t = (await parseFile('m.docx', f)).tables[0]!;
    expect(t.columns).toEqual(['Nome', 'X', 'Y']);
    expect(t.rows).toHaveLength(3);
  });
  it('documento sem tabelas vira texto, e .doc / arquivo inválido dão mensagem clara', async () => {
    const d = await parseFile('t.docx', docx(p('Primeiro parágrafo') + p('Segundo')));
    expect(d.tables[0]!.columns).toEqual(['Parágrafo', 'Texto']);
    expect(d.tables[0]!.noCharts).toBe(true);
    await expect(parseFile('x.doc', enc('abc'))).rejects.toThrow(/\.docx/);
    await expect(parseFile('x.docx', enc('não é zip'))).rejects.toThrow(/inválido|corrompido/);
  });
});

import { decodeText, detectDelimiter } from '../src/csv.js';
import { applyMerges, similarGroups } from '../src/similar.js';
import { inferLocale, isMissingToken, locale } from '../src/profile.js';

describe('arquivos grandes, codificação e separador', () => {
  it('abre CSV com 200.500 linhas sem estourar a pilha e avisa do que ficou de fora', async () => {
    let s = 'id,v\n';
    for (let i = 0; i < 200500; i++) s += `${i},${i % 7}\n`;
    const d = await parseFile('grande.csv', enc(s));
    expect(d.tables[0]!.rows).toHaveLength(200000);
    expect(d.info!.truncated).toBe(500);
    expect(d.tables[0]!.notes!.join(' ')).toMatch(/só as primeiras/);
    const p = profileTable(d.tables[0]!);
    expect(p).toHaveLength(2);
  }, 30000);
  it('detecta Windows-1252 e avisa; UTF-8 não dispara o aviso', async () => {
    const l1 = (x: string) => Uint8Array.from([...x].map((c) => c.charCodeAt(0)));
    const d = await parseFile('a.csv', l1('cidade;valor\nCroatá;10\nSão Benedito;20\nTianguá;30\n'));
    expect(d.tables[0]!.rows.map((r) => r['cidade'])).toEqual(['Croatá', 'São Benedito', 'Tianguá']);
    expect(d.info!.encoding).toBe('Windows-1252');
    expect(d.info!.notes.join(' ')).toMatch(/Windows-1252/);
    const u = await parseFile('b.csv', enc('cidade;valor\nCroatá;10\nSão;20\n'));
    expect(u.info!.encoding).toBe('UTF-8');
    expect(u.info!.notes.join(' ')).not.toMatch(/não está em UTF-8/);
    expect(decodeText(l1('Croatá'), 'utf-8').encoding).toBe('UTF-8');
  });
  it('detecta o separador (; com 2 colunas, tab, |) e aceita escolha manual', async () => {
    expect(detectDelimiter('cidade;valor\nCroatá;10\nSão;20\n')).toBe(';');
    expect(detectDelimiter('a\tb\n1\t2\n3\t4\n')).toBe('\t');
    expect(detectDelimiter('a|b|c\n1|2|3\n')).toBe('|');
    expect(detectDelimiter('nome,valor\nA,10\nB,20\n')).toBe(',');
    expect(detectDelimiter('nome;valor\nA;1,5\nB;2,5\nC;3,5\n')).toBe(';');
    const d = await parseFile('x.csv', enc('a;b\n1;2\n3;4\n5;6\n'), { delimiter: ',' });
    expect(d.tables[0]!.columns).toEqual(['a;b']);
    expect((await parseFile('x.csv', enc('a;b\n1;2\n3;4\n5;6\n'))).tables[0]!.columns).toEqual(['a', 'b']);
  });
  it('avisa colunas com nome repetido e linhas em branco', async () => {
    const t = (await parseFile('d.csv', enc('a,a,b\n1,2,3\n\n4,5,6\n7,8,9\n'))).tables[0]!;
    expect(t.columns).toEqual(['a', 'a (2)', 'b']);
    expect(t.notes!.join(' ')).toMatch(/renomeadas/);
    expect(t.notes!.join(' ')).toMatch(/em branco/);
  });
});

describe('valores inválidos, marcadores e interpretação regional', () => {
  it('coluna numérica com 1 valor inválido continua numérica e lista a linha', async () => {
    const t = (await parseFile('n.csv', enc('v\n10\n20\n30\n40\n50\n60\n70\n80\n90\nabc\n'))).tables[0]!;
    const c = profileTable(t)[0]!;
    expect(c.type).toBe('integer');
    expect(c.invalid).toEqual([{ row: 10, value: 'abc' }]);
    expect(qualityAlerts(t, profileTable(t)).map((a) => a.text).join(' ')).toMatch(/linha 10: “abc”/);
  });
  it('n/d e "-" são ausência, não valor inválido', async () => {
    const t = (await parseFile('m.csv', enc('v\n1\n2\nn/d\n4\n-\n6\n7\n8\n9\n'))).tables[0]!;
    const c = profileTable(t)[0]!;
    expect(c.invalidCount).toBeUndefined();
    expect(c.missingMarkers).toBe(2);
    expect(c.missing).toBe(2);
    expect(isMissingToken('S/I')).toBe(true);
  });
  it('datas: detecta ordem pelo dia > 12 e avisa quando é ambígua', async () => {
    const mk = (cells: string[]) => [{ name: 't', columns: ['d'], rows: cells.map((d) => ({ d })) }];
    expect(inferLocale(mk(['13/04/2024', '05/04/2024'])).dateOrder).toBe('dmy');
    expect(inferLocale(mk(['04/13/2024', '04/05/2024'])).dateOrder).toBe('mdy');
    const amb = inferLocale(mk(['03/04/2024', '05/06/2024']));
    expect(amb.dateAmbiguous).toBe(true);
    expect(amb.dateOrder).toBe('dmy');
    locale.dateOrder = 'mdy';
    expect(new Date(toDate('03/04/2024')!).toISOString().slice(0, 10)).toBe('2024-03-04');
    locale.dateOrder = 'dmy';
    expect(new Date(toDate('03/04/2024')!).toISOString().slice(0, 10)).toBe('2024-04-03');
  });
  it('números: formatos inequívocos sempre funcionam; "1.234" é ambíguo e depende da escolha', () => {
    expect(toNumber('1.234,56')).toBe(1234.56);
    expect(toNumber('1,234.56')).toBe(1234.56);
    expect(toNumber('1.234')).toBe(1234);
    locale.numbers = 'us';
    expect(toNumber('1.234')).toBe(1.234);
    expect(toNumber('1,234')).toBe(1234);
    locale.numbers = 'br';
    const mk = (cells: string[]) => [{ name: 't', columns: ['v'], rows: cells.map((v) => ({ v })) }];
    expect(inferLocale(mk(['1.234', '2.500'])).numberAmbiguous).toBe(true);
    expect(inferLocale(mk(['1,234.56', '2,500.10'])).numbers).toBe('us');
  });
});

describe('categorias parecidas', () => {
  const csv = ['cidade,valor', ...Array.from({ length: 40 }, (_, i) => `${['Croatá', 'Croata', 'CROATÁ', 'Tianguá', 'Tiangua'][i % 5]},${i}`)].join('\n');
  it('agrupa acento, caixa e 1 letra de diferença, e sugere a grafia mais frequente', async () => {
    const t = (await parseFile('c.csv', enc(csv))).tables[0]!;
    const g = similarGroups(t, profileTable(t));
    expect(g.map((x) => x.values.map((v) => v.value).sort())).toEqual([['CROATÁ', 'Croata', 'Croatá'], ['Tiangua', 'Tianguá']]);
    const a = qualityAlerts(t, profileTable(t)).find((x) => x.merge?.col === 'cidade')!;
    expect(a.merge!.values).toContain('Croata');
  });
  it('juntar grafias troca os valores e unifica os gráficos', async () => {
    const t = (await parseFile('c.csv', enc(csv))).tables[0]!;
    const m = applyMerges(t, { cidade: { Croata: 'Croatá', CROATÁ: 'Croatá', Tiangua: 'Tianguá' } });
    expect(new Set(m.rows.map((r) => r['cidade'])).size).toBe(2);
    expect(t.rows.some((r) => r['cidade'] === 'Croata')).toBe(true); // original intacto
  });
});

describe('XLSX e KMZ', () => {
  it('lê todas as abas de um XLSX, com título, datas e fórmula sem valor calculado', async () => {
    const d = await parseFile('planilha.xlsx', new Uint8Array(readFileSync(new URL('./fixtures/planilha.xlsx', import.meta.url))));
    expect(d.tables.length).toBeGreaterThanOrEqual(2);
    const v = d.tables.find((t) => t.columns.includes('Quantidade'))!;
    expect(v.rows).toHaveLength(12);
    expect(profileTable(v).find((c) => c.name === 'Data')!.type).toBe('date');
    expect(d.tables.some((t) => t.columns.includes('Meta'))).toBe(true);
  });
  it('lê KMZ (zip com .kml) e ignora outros arquivos do zip', async () => {
    const kml = '<kml><Document><Placemark><name>P1</name><Point><coordinates>-40.9,-4.4,0</coordinates></Point></Placemark><Placemark><name>P2</name><Point><coordinates>-40.8,-4.5,0</coordinates></Point></Placemark><Placemark><name>P3</name><Point><coordinates>-40.7,-4.6,0</coordinates></Point></Placemark></Document></kml>';
    const z = zipSync({ 'doc.kml': strToU8(kml), 'imagem.png': new Uint8Array([1, 2, 3]) });
    const d = await parseFile('a.kmz', z);
    expect(d.tables[0]!.rows.map((r) => r['nome'])).toEqual(['P1', 'P2', 'P3']);
    await expect(parseFile('b.kmz', zipSync({ 'x.txt': strToU8('oi') }))).rejects.toThrow(/sem arquivo .kml/);
  });
});

import { buildXlsx } from '../src/xlsx.js';
describe('exportar Excel', () => {
  it('gera um .xlsx que o próprio leitor abre, com números, datas, texto, acentos e vazios', async () => {
    const bytes = buildXlsx([
      { name: 'Dados', columns: ['Município', 'Valor', 'Data', 'Obs'], rows: [['Croatá', 10.5, new Date(Date.UTC(2024, 2, 5)), null], ['São <&> "x"', 20, new Date(Date.UTC(2024, 3, 6)), 'ok'], ['C', 30, new Date(Date.UTC(2024, 4, 7)), 'ok'], ['D', 40, new Date(Date.UTC(2024, 5, 8)), 'ok']] },
      { name: 'Origem: a/b?', columns: ['Campo', 'Valor'], rows: [['Arquivo', 'a.xlsx'], ['Filtro', 'x'], ['Z', '1']] },
    ]);
    const d = await parseFile('saida.xlsx', bytes);
    expect(d.tables).toHaveLength(2);
    const t = d.tables[0]!;
    expect(t.columns).toEqual(['Município', 'Valor', 'Data', 'Obs']);
    expect(t.rows[0]).toMatchObject({ 'Município': 'Croatá', Valor: 10.5, Obs: null });
    expect(t.rows[1]!['Município']).toBe('São <&> "x"');
    expect(t.rows[0]!['Data']).toBeInstanceOf(Date);
    expect((t.rows[0]!['Data'] as Date).toISOString().slice(0, 10)).toBe('2024-03-05');
    expect(d.tables[1]!.columns).toEqual(['Campo', 'Valor']);
  });
});

// Fixtures sintéticas de domínios variados (produtos, escolas, finanças, logística) lidas pelo caminho completo: arquivo → perfil → papéis → gráficos → indicadores.
// Os valores esperados foram calculados à mão.
import { describe, expect, it } from 'vitest';
import { chartData, kpis, qualityAlerts, suggestCharts } from '../src/suggest.js';
import { semanticProfile } from '../src/analytics/semantic.js';
import { parseFile } from '../src/parse.js';
import { locale, profileTable, toNumber } from '../src/profile.js';
import type { ChartSpec, Table } from '../src/types.js';

const NL = String.fromCharCode(10);
const csv = async (nome: string, linhas: string[]): Promise<Table> => (await parseFile(nome, new TextEncoder().encode(linhas.join(NL)))).tables[0]!;
const spec = (s: Partial<ChartSpec>): ChartSpec => ({ id: 'x', kind: 'hbar', title: 't', description: 'd', score: 1, ...s });
const porRotulo = (d: { labels: string[]; values: number[] }) => Object.fromEntries(d.labels.map((l, i) => [l, d.values[i]!]));

describe('produtos: código com zeros à esquerda não é quantidade', () => {
  const linhas = ['sku;produto;categoria;preco;estoque', '0001;Caneta;Papelaria;R$ 2,50;100', '0002;Lápis;Papelaria;R$ 1,20;250', '0003;Mouse;Informática;R$ 89,90;15', '0004;Teclado;Informática;R$ 150,00;8', '0005;Cabo USB;Informática;R$ 19,90;60', '0006;Grampeador;Papelaria;R$ 22,00;30'];
  it('sku é identificador (pelos zeros à esquerda e pelo nome), preço é dinheiro somável', async () => {
    const t = await csv('produtos.csv', linhas);
    const sem = Object.fromEntries(semanticProfile(t, profileTable(t)).map((s) => [s.name, s]));
    expect(sem.sku!.role).toBe('identifier');
    expect(sem.preco).toMatchObject({ role: 'measure', unit: 'currency', additive: true });
    expect(sem.estoque!.role).toBe('measure');
  });
  it('indicador soma o preço (285,5) e nenhum gráfico usa o sku', async () => {
    const t = await csv('produtos.csv', linhas);
    const p = profileTable(t);
    const total = kpis(t, p).find((k) => k.label.startsWith('Total de'))!;
    expect(total.label).toBe('Total de preco');
    expect(total.value).toBe('285,5');
    expect(suggestCharts(t, p, 3).filter((c) => c.x === 'sku' || c.y === 'sku')).toEqual([]);
  });
  it('média de preço por categoria: Papelaria 8,5667 e Informática 86,6', async () => {
    const t = await csv('produtos.csv', linhas);
    const por = porRotulo(chartData(t, spec({ x: 'categoria', y: 'preco', agg: 'mean' })));
    expect(por.Papelaria).toBeCloseTo((2.5 + 1.2 + 22) / 3, 6);
    expect(por['Informática']).toBeCloseTo((89.9 + 150 + 19.9) / 3, 6);
  });
});

describe('escolas: taxa (%) é média, e a relação aprovados ÷ matrículas é encontrada', () => {
  const linhas = ['escola;municipio;matriculas;aprovados;taxa_aprovacao', 'E1;Fortaleza;200;180;90%', 'E2;Fortaleza;100;70;70%', 'E3;Sobral;300;270;90%', 'E4;Sobral;50;40;80%'];
  it('taxa por município usa a média simples: Fortaleza 80, Sobral 85', async () => {
    const t = await csv('escolas.csv', linhas);
    const sem = Object.fromEntries(semanticProfile(t, profileTable(t)).map((s) => [s.name, s]));
    expect(sem.taxa_aprovacao).toMatchObject({ unit: 'percent', additive: false });
    expect(porRotulo(chartData(t, spec({ x: 'municipio', y: 'taxa_aprovacao', agg: 'mean' })))).toEqual({ Fortaleza: 80, Sobral: 85 });
  });
  it('o painel avisa que a taxa sai de aprovados ÷ matrículas × 100', async () => {
    const t = await csv('escolas.csv', linhas);
    const alertas = qualityAlerts(t, profileTable(t)).map((a) => a.text).join(' ');
    expect(alertas).toContain('taxa_aprovacao');
    expect(alertas).toMatch(/aprovados/);
  });
  it('limite conhecido: a média simples das taxas (82,5) difere da taxa geral ponderada (86,15); o primeiro indicador é o total de matrículas (650)', async () => {
    const t = await csv('escolas.csv', linhas);
    const p = profileTable(t);
    expect(p.find((c) => c.name === 'taxa_aprovacao')!.mean).toBeCloseTo(82.5, 6);
    expect((180 + 70 + 270 + 40) / (200 + 100 + 300 + 50)).toBeCloseTo(0.8615, 3);
    expect(kpis(t, p).find((x) => x.label.startsWith('Total de'))).toMatchObject({ label: 'Total de matriculas', value: '650' });
  });
});

describe('finanças: moedas e decimais regionais', () => {
  const linhas = ['data;tipo;descricao;valor;moeda', '05/01/2024;receita;Venda A;R$ 1.234,56;BRL', '12/01/2024;despesa;Aluguel;R$ 800,00;BRL', '20/01/2024;receita;Venda B;2.500,00;BRL', '03/02/2024;despesa;Software;99,90;BRL', '15/02/2024;receita;Venda C;R$ 3.000,10;BRL'];
  it('lê R$ 1.234,56, 2.500,00 e 99,90 do mesmo jeito; soma 7.634,56', async () => {
    const t = await csv('financas.csv', linhas);
    const p = profileTable(t).find((c) => c.name === 'valor')!;
    expect(p.type).toBe('number');
    expect(p.sum).toBeCloseTo(7634.56, 6);
    expect(kpis(t, profileTable(t)).find((k) => k.label === 'Total de valor')?.value).toBe('7.634,56');
  });
  it('receita e despesa: 6.734,66 e 899,90 por tipo', async () => {
    const t = await csv('financas.csv', linhas);
    const por = porRotulo(chartData(t, spec({ x: 'tipo', y: 'valor', agg: 'sum' })));
    expect(por.receita).toBeCloseTo(6734.66, 6);
    expect(por.despesa).toBeCloseTo(899.9, 6);
  });
  it('formatos sem ambiguidade valem nas duas regiões; “1.234” é ambíguo e segue o padrão escolhido', () => {
    expect(toNumber('1.234,56')).toBe(1234.56);
    expect(toNumber('1,234.56')).toBe(1234.56);
    expect(toNumber('R$ 1.234,56')).toBe(1234.56);
    locale.numbers = 'br';
    expect(toNumber('1.234')).toBe(1234);
    locale.numbers = 'us';
    expect(toNumber('1,234')).toBe(1234);
    locale.numbers = 'br';
  });
  it('o valor em dinheiro é reconhecido como moeda', async () => {
    const t = await csv('financas.csv', linhas);
    const s = semanticProfile(t, profileTable(t)).find((x) => x.name === 'valor')!;
    expect(s).toMatchObject({ unit: 'currency', additive: true });
  });
});

describe('logística origem/destino: coordenadas com sufixo não são medidas', () => {
  const linhas = ['origem;destino;lat_origem;lon_origem;lat_destino;lon_destino;peso;dias', 'Fortaleza;Sobral;-3.73;-38.52;-3.69;-40.35;1200;2', 'Fortaleza;Crato;-3.73;-38.52;-7.23;-39.41;800;3', 'Sobral;Crato;-3.69;-40.35;-7.23;-39.41;500;4', 'Fortaleza;Sobral;-3.73;-38.52;-3.69;-40.35;300;2', 'Crato;Fortaleza;-7.23;-39.41;-3.73;-38.52;700;3'];
  it('lat_/lon_ são geográficas: não viram total, gráfico nem dispersão', async () => {
    const t = await csv('logistica.csv', linhas);
    const p = profileTable(t);
    const sem = Object.fromEntries(semanticProfile(t, p).map((s) => [s.name, s]));
    for (const c of ['lat_origem', 'lon_origem', 'lat_destino', 'lon_destino']) expect(sem[c]!.role, c).toBe('geo');
    expect(kpis(t, p).map((x) => x.label).join('|')).not.toMatch(/lat_|lon_/);
    const usados = suggestCharts(t, p, 3).flatMap((c) => [c.x, c.y, ...(c.series ?? [])]);
    expect(usados.filter((c) => c && /^(lat|lon)_/.test(c))).toEqual([]);
  });
  it('peso por origem: Fortaleza 2.300, Sobral 500, Crato 700; o primeiro indicador é o peso', async () => {
    const t = await csv('logistica.csv', linhas);
    expect(porRotulo(chartData(t, spec({ x: 'origem', y: 'peso', agg: 'sum' })))).toEqual({ Fortaleza: 2300, Sobral: 500, Crato: 700 });
    expect(kpis(t, profileTable(t)).find((x) => x.label.startsWith('Total de'))?.label).toBe('Total de peso');
  });
  it('limite conhecido: dois pares de coordenadas (origem e destino) não geram mapa nem fluxo', async () => {
    const t = await csv('logistica.csv', linhas);
    expect(suggestCharts(t, profileTable(t), 3).some((c) => c.kind === 'map')).toBe(false);
  });
});

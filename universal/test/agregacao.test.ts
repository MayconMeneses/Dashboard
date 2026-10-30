// Fase 5: testes de agregação com resultados esperados calculados à mão (fixture sintética de vendas).
import { describe, expect, it } from 'vitest';
import { profileTable } from '../src/profile.js';
import { chartData, insightFor, kpis, rateData } from '../src/suggest.js';
import type { ChartSpec, Row, Table } from '../src/types.js';

const vendas = (): Table => ({
  name: 'vendas',
  columns: ['data', 'produto', 'valor', 'taxa'],
  rows: [
    { data: '2024-01-10', produto: 'A', valor: 100, taxa: '50%' },
    { data: '2024-01-20', produto: 'A', valor: 200, taxa: '70%' },
    // fevereiro não tem nenhum registro
    { data: '2024-03-05', produto: 'B', valor: 300, taxa: '90%' },
    { data: '2024-03-15', produto: 'B', valor: null, taxa: '50%' }, // valor ausente: não é zero
  ] as Row[],
});
const spec = (s: Partial<ChartSpec>): ChartSpec => ({ id: 's', kind: 'line', title: 't', description: 'd', score: 1, ...s });

describe('série mensal', () => {
  it('contagem: mês sem registro é zero (é uma contagem de registros)', () => {
    expect(chartData(vendas(), spec({ x: 'data', agg: 'count' })).values).toEqual([2, 0, 2]);
  });
  it('soma ignora a célula ausente (não vira zero que mude a conta)', () => {
    expect(chartData(vendas(), spec({ x: 'data', y: 'valor', agg: 'sum' })).values).toEqual([300, 0, 300]);
  });
  it('média: mês sem registro é lacuna (NaN), nunca 0%', () => {
    const d = chartData(vendas(), spec({ x: 'data', y: 'taxa', agg: 'mean' }));
    expect(d.labels).toEqual(['2024-01', '2024-02', '2024-03']);
    expect(d.values[0]).toBe(60);
    expect(Number.isNaN(d.values[1]!)).toBe(true);
    expect(d.values[2]).toBe(70);
  });
  it('média de valor em março usa só a linha preenchida (300), não 150', () => {
    expect(chartData(vendas(), spec({ x: 'data', y: 'valor', agg: 'mean' })).values[2]).toBe(300);
  });
  it('o destaque não inventa mínimo de 0 para o mês sem dado e avisa da lacuna', () => {
    const s = spec({ x: 'data', y: 'taxa', agg: 'mean' });
    const txt = insightFor(s, chartData(vendas(), s));
    expect(txt).not.toMatch(/mínimo: 0 /);
    expect(txt).toMatch(/1 ponto\(s\) sem dado/);
  });
});

describe('agregação por categoria', () => {
  it('média por produto (hbar): A=150, B=300', () => {
    const d = chartData(vendas(), spec({ kind: 'hbar', x: 'produto', y: 'valor', agg: 'mean' }));
    expect(Object.fromEntries(d.labels.map((l, i) => [l, d.values[i]]))).toEqual({ A: 150, B: 300 });
  });
  it('destaque de médias não fala em “% do total”', () => {
    const s = spec({ kind: 'hbar', x: 'produto', y: 'valor', agg: 'mean' });
    expect(insightFor(s, chartData(vendas(), s))).not.toMatch(/do total/);
  });
  it('destaque de somas continua falando em % do total', () => {
    const s = spec({ kind: 'hbar', x: 'produto', y: 'valor', agg: 'sum' });
    expect(insightFor(s, chartData(vendas(), s))).toMatch(/% do total/);
  });
  it('pivot: contagem, soma e média por produto', () => {
    const by = (agg: 'count' | 'sum' | 'mean') => {
      const d = chartData(vendas(), spec({ kind: 'pivot', x: 'produto', y: 'valor', agg }));
      return Object.fromEntries(d.labels.map((l, i) => [l, d.values[i]]));
    };
    expect(by('count')).toEqual({ A: 2, B: 2 });
    expect(by('sum')).toEqual({ A: 300, B: 300 });
    expect(by('mean')).toEqual({ A: 150, B: 300 });
  });
  it('pivot com série: combinação sem nenhum valor fica NaN (não zero)', () => {
    const d = chartData(vendas(), spec({ kind: 'pivot', x: 'produto', seriesBy: 'data', y: 'valor', agg: 'sum', keepOrder: true }));
    const a = d.datasets!.find((s) => s.label === '2024-01-10')!;
    expect(a.values[0]).toBe(100);
    expect(Number.isNaN(a.values[1]!)).toBe(true);
  });
});

describe('indicadores (KPIs)', () => {
  it('não soma coluna de código nem de percentual como se fosse total', () => {
    const t: Table = { name: 't', columns: ['cep', 'taxa'], rows: Array.from({ length: 10 }, (_, i) => ({ cep: String(10000000 + i * 7919), taxa: `${50 + i * 5}%` })) as Row[] };
    const k = kpis(t, profileTable(t));
    expect(k.find((x) => x.label.startsWith('Total de cep'))).toBeUndefined();
    expect(k.find((x) => x.label.startsWith('Total de taxa'))).toBeUndefined();
    const m = k.find((x) => x.label === 'Média de taxa')!;
    expect(m.value).toBe('72,5');
  });
  it('coluna somável continua com “Total de”', () => {
    const k = kpis(vendas(), profileTable(vendas()));
    expect(k.find((x) => x.label === 'Total de valor')?.value).toBe('600');
  });
});

describe('taxas', () => {
  const tidy = (den: number | null): { t: Table; s: ChartSpec } => {
    const t: Table = {
      name: 'x',
      columns: ['mes', 'situacao', 'Total'],
      tidy: { period: 'mes', entity: 'mes', label: 'situacao', value: 'Total', situation: 'situacao' },
      rows: [
        { mes: 'jan', situacao: 'Confirmados', Total: 5 },
        { mes: 'jan', situacao: 'Descartados', Total: den },
        { mes: 'fev', situacao: 'Confirmados', Total: 4 },
        { mes: 'fev', situacao: 'Descartados', Total: 4 },
      ] as Row[],
    };
    const s = spec({ kind: 'pivot', x: 'mes', rate: { options: [{ label: 'x', numerator: ['Confirmados'], denominator: ['Confirmados', 'Descartados'], explain: '' }] } });
    return { t, s };
  };
  it('denominador válido: 5 ÷ (5+5) = 50%; 4 ÷ 8 = 50%', () => {
    const { t, s } = tidy(5);
    expect(rateData(t, s, 0)!.values).toEqual([50, 50]);
  });
  it('célula do denominador ausente não vira zero que distorça a taxa', () => {
    const { t, s } = tidy(null);
    const r = rateData(t, s, 0)!;
    const por = Object.fromEntries(r.labels.map((l, i) => [l, r.values[i]]));
    expect(por).toEqual({ jan: 100, fev: 50 }); // jan: célula ausente não entra na soma (5 ÷ 5); nada vira Infinity
  });
  it('denominador zero: NaN', () => {
    const t: Table = {
      name: 'x',
      columns: ['mes', 'situacao', 'Total'],
      tidy: { period: 'mes', entity: 'mes', label: 'situacao', value: 'Total', situation: 'situacao' },
      rows: [{ mes: 'jan', situacao: 'Confirmados', Total: 0 }, { mes: 'jan', situacao: 'Descartados', Total: 0 }] as Row[],
    };
    const s = spec({ kind: 'pivot', x: 'mes', rate: { options: [{ label: 'x', numerator: ['Confirmados'], denominator: ['Confirmados', 'Descartados'], explain: '' }] } });
    expect(Number.isNaN(rateData(t, s, 0)!.values[0]!)).toBe(true);
  });
});

describe('métricas adicionais: mínimo, máximo e mediana', () => {
  const por = (kind: 'hbar' | 'pivot', agg: 'min' | 'max' | 'median') => {
    const d = chartData(vendas(), spec({ kind, x: 'produto', y: 'valor', agg }));
    return Object.fromEntries(d.labels.map((l, i) => [l, d.values[i]]));
  };
  it.each([
    ['min', { A: 100, B: 300 }],
    ['max', { A: 200, B: 300 }],
    ['median', { A: 150, B: 300 }],
  ] as const)('%s por produto (valor ausente de B não conta)', (agg, esperado) => {
    expect(por('hbar', agg)).toEqual(esperado);
    expect(por('pivot', agg)).toEqual(esperado);
  });
  it('mediana de quantidade ímpar é o valor do meio', () => {
    const t: Table = { name: 't', columns: ['g', 'v'], rows: [1, 9, 5, 100, 3].map((v) => ({ g: 'x', v })) as Row[] };
    expect(chartData(t, spec({ kind: 'pivot', x: 'g', y: 'v', agg: 'median' })).values).toEqual([5]);
  });
  it('série mensal: mediana por mês, mês sem registro é lacuna', () => {
    const d = chartData(vendas(), spec({ x: 'data', y: 'taxa', agg: 'median' }));
    expect(d.values[0]).toBe(60);
    expect(Number.isNaN(d.values[1]!)).toBe(true);
    expect(d.values[2]).toBe(70);
    const mx = chartData(vendas(), spec({ x: 'data', y: 'taxa', agg: 'max' }));
    expect(mx.values[0]).toBe(70);
    expect(Number.isNaN(mx.values[1]!)).toBe(true);
  });
  it('o destaque nomeia a métrica e não fala em “% do total”', () => {
    for (const [agg, palavra] of [['min', 'mínimo'], ['max', 'máximo'], ['median', 'mediana']] as const) {
      const s = spec({ kind: 'hbar', x: 'produto', y: 'valor', agg });
      const txt = insightFor(s, chartData(vendas(), s));
      expect(txt, agg).toContain(palavra);
      expect(txt, agg).not.toMatch(/do total/);
    }
  });
});

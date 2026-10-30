// Fase 5: exploração manual (regras de combinação) e registro de desenhos (dados 100% sintéticos).
import { describe, expect, it } from 'vitest';
import { defaultChoice, exploreSpec } from '../src/analytics/explore.js';
import { semanticProfile } from '../src/analytics/semantic.js';
import { chartData } from '../src/analytics/chartData.js';
import { createRegistry } from '../src/charts/registry.js';
import { profileTable } from '../src/profile.js';
import type { Row, Table } from '../src/types.js';

const UFS = ['SP', 'RJ', 'MG', 'BA'];
const tabela = (): Table => ({
  name: 't',
  columns: ['cep', 'uf', 'taxa', 'vendas', 'quando'],
  rows: Array.from({ length: 24 }, (_, i) => ({ cep: String(10000000 + i * 7919), uf: UFS[i % 4]!, taxa: `${50 + (i % 5) * 10}%`, vendas: 100 + i * 10, quando: `2024-0${1 + (i % 6)}-15` })) as Row[],
});
const sem = () => semanticProfile(tabela(), profileTable(tabela()));

describe('exploração manual', () => {
  it('escolha inicial: dimensão com medida somável usa soma; percentual usa média', () => {
    const d = defaultChoice(sem())!;
    expect(d.x).toBe('uf');
    expect(d.y).toBe('taxa'); // primeira medida da tabela é a taxa
    expect(d.agg).toBe('mean');
  });
  it('soma de percentual é recusada com explicação; média é aceita', () => {
    const r = exploreSpec({ x: 'uf', y: 'taxa', agg: 'sum' }, sem());
    expect(r.spec).toBeUndefined();
    expect(r.problem).toMatch(/somar não tem significado/);
    expect(exploreSpec({ x: 'uf', y: 'taxa', agg: 'mean' }, sem()).spec?.agg).toBe('mean');
  });
  it('código (CEP) não vira medida nem agrupamento', () => {
    expect(exploreSpec({ x: 'uf', y: 'cep', agg: 'sum' }, sem()).problem).toMatch(/é um código/);
    expect(exploreSpec({ x: 'cep', y: '', agg: 'count' }, sem()).problem).toMatch(/identificador/);
  });
  it('coluna de data vira série mensal; contagem não pede medida', () => {
    expect(exploreSpec({ x: 'quando', y: '', agg: 'count' }, sem()).spec?.kind).toBe('line');
  });
  it('o gráfico montado calcula o que o título diz (média de vendas por uf, à mão)', () => {
    const t = tabela();
    const spec = exploreSpec({ x: 'uf', y: 'vendas', agg: 'mean' }, sem()).spec!;
    const d = chartData(t, spec);
    // SP = linhas 0,4,8,12,16,20 → vendas 100,140,180,220,260,300 → média 200
    expect(d.values[d.labels.indexOf('SP')]).toBe(200);
    expect(spec.title).toBe('Média de vendas por uf');
    expect(spec.reasons?.length).toBeGreaterThan(0);
  });
  it('é determinístico', () => {
    const c = { x: 'uf', y: 'vendas', agg: 'median' as const };
    expect(JSON.stringify(exploreSpec(c, sem()))).toBe(JSON.stringify(exploreSpec(c, sem())));
  });
});

describe('registro de desenhos', () => {
  it('registra e encontra por tipo e por forma; nomes ordenados', () => {
    const r = createRegistry().kind('b', () => null).kind('a', () => null).shape('z', () => null);
    expect(r.names()).toEqual({ kinds: ['a', 'b'], shapes: ['z'] });
    expect(r.forKind('a')).toBeTypeOf('function');
    expect(r.forKind('nada')).toBeUndefined();
    expect(r.forShape('z')).toBeTypeOf('function');
  });
  it('recusa registro duplicado (não sobrescreve em silêncio)', () => {
    const r = createRegistry().kind('a', () => null);
    expect(() => r.kind('a', () => null)).toThrow(/já registrado/);
  });
  it('um desenho novo entra sem mexer no painel', () => {
    const el = { tag: 'novo' } as unknown as HTMLElement;
    const r = createRegistry().kind('waterfall', () => el);
    expect(r.forKind('waterfall')!({} as never)).toBe(el);
  });
});

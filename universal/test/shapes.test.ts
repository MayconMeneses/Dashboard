import { describe, expect, it } from 'vitest';
import { compatibleStyles, toHeatmap, toPareto, toPercent } from '../src/shapes.js';

const rec = (o: Parameters<typeof compatibleStyles>[0]) => compatibleStyles(o).find((s) => s.recommended)!.style;

describe('escolha do tipo de gráfico', () => {
  it('tempo com poucas séries = linha; muitas séries = gráficos pequenos', () => {
    expect(rec({ ordered: true, series: 3, labels: 8, positive: true })).toBe('line');
    expect(rec({ ordered: true, series: 8, labels: 8, positive: true })).toBe('small');
    expect(rec({ ordered: true, series: 0, labels: 12, positive: true })).toBe('line');
    expect(rec({ ordered: true, series: 0, labels: 3, positive: true })).toBe('bar');
  });
  it('categorias: ranking = barras; muitos itens = pareto; poucas partes = rosca; composição = empilhado', () => {
    expect(rec({ ordered: false, series: 0, labels: 8, positive: true })).toBe('hbar');
    expect(rec({ ordered: false, series: 0, labels: 40, positive: true })).toBe('pareto');
    expect(rec({ ordered: false, series: 0, labels: 3, positive: true })).toBe('donut');
    expect(rec({ ordered: false, series: 3, labels: 8, positive: true })).toBe('stacked');
  });
  it('não oferece proporções/áreas/radar quando há valores negativos', () => {
    const s = compatibleStyles({ ordered: true, series: 3, labels: 8, positive: false }).map((o) => o.style);
    expect(s).not.toContain('percent');
    expect(s).not.toContain('area');
    expect(compatibleStyles({ ordered: false, series: 3, labels: 5, positive: false }).map((o) => o.style)).not.toContain('radar');
  });
  it('toda opção tem motivo explicado e há exatamente uma recomendada', () => {
    for (const o of [{ ordered: true, series: 2, labels: 6, positive: true }, { ordered: false, series: 0, labels: 10, positive: true }, { ordered: false, series: 4, labels: 6, positive: true }]) {
      const l = compatibleStyles(o);
      expect(l.every((x) => x.why.length > 10)).toBe(true);
      expect(l.filter((x) => x.recommended)).toHaveLength(1);
    }
  });
});

describe('transformações', () => {
  const d = { labels: ['a', 'b', 'c'], values: [0, 0, 0], datasets: [{ label: 'x', values: [30, 10, Number.NaN] }, { label: 'y', values: [70, 10, Number.NaN] }] };
  it('100% empilhado: proporção por rótulo; sem dado continua sem dado', () => {
    const p = toPercent(d);
    expect(p.datasets![0]!.values[0]).toBeCloseTo(30);
    expect(p.datasets![1]!.values[1]).toBeCloseTo(50);
    expect(p.datasets![0]!.values[2]).toBeNaN();
  });
  it('mapa de calor guarda mínimo/máximo ignorando sem dado', () => {
    const h = toHeatmap(d);
    expect([h.min, h.max]).toEqual([10, 70]);
    expect(h.rows).toEqual(['x', 'y']);
  });
  it('pareto ordena e acumula até 100%', () => {
    const p = toPareto({ labels: ['a', 'b', 'c'], values: [10, 60, 30] });
    expect(p.labels).toEqual(['b', 'c', 'a']);
    expect(p.cumulative[0]).toBeCloseTo(60);
    expect(p.cumulative[2]).toBeCloseTo(100);
  });
});

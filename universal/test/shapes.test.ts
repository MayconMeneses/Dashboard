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

import { filterByDate, pageOf, sortRows } from '../src/tableview.js';

describe('tabela: ordenar, paginar e filtrar por período', () => {
  const rows = [{ n: 10, t: 'b', d: '2024-03-05' }, { n: 2, t: 'a', d: '2024-01-10' }, { n: null, t: 'c', d: '2024-02-01' }, { n: 33, t: 'B', d: null }];
  it('ordena número (2 < 10 < 33), vazios por último, nas duas direções', () => {
    expect(sortRows(rows, 'n', 'asc', 'integer').map((r) => r.n)).toEqual([2, 10, 33, null]);
    expect(sortRows(rows, 'n', 'desc', 'integer').map((r) => r.n)).toEqual([33, 10, 2, null]);
    expect(sortRows(rows, 't', 'asc', 'text').map((r) => r.t)).toEqual(['a', 'b', 'B', 'c']);
    expect(sortRows(rows, 'd', 'asc', 'date').map((r) => r.d)).toEqual(['2024-01-10', '2024-02-01', '2024-03-05', null]);
  });
  it('pagina e limita a página fora do intervalo', () => {
    const p = pageOf(Array.from({ length: 105 }, (_, i) => i), 3, 50);
    expect([p.page, p.pages, p.from, p.to, p.items.length]).toEqual([3, 3, 101, 105, 5]);
    expect(pageOf([1, 2], 9, 50).page).toBe(1);
    expect(pageOf([], 1, 50)).toMatchObject({ from: 0, to: 0, pages: 1 });
  });
  it('filtra por período com limites inclusivos e exclui linhas sem data', () => {
    expect(filterByDate(rows, 'd', '2024-02-01', '2024-03-05').map((r) => r.d)).toEqual(['2024-03-05', '2024-02-01']);
    expect(filterByDate(rows, 'd', undefined, undefined)).toHaveLength(4);
    expect(filterByDate(rows, 'd', '2024-03-01', undefined).map((r) => r.d)).toEqual(['2024-03-05']);
  });
});

import { describeState, formatBytes } from '../src/report.js';

describe('relatório: descrição do que o usuário ajustou', () => {
  it('lista filtros, período, junções, tipos e gráficos removidos, sempre com a interpretação regional', () => {
    const l = describeState({ filters: { Município: 'Croatá' }, dateRange: { col: 'data', from: '2024-01-01', to: '2024-03-31' }, merges: { cidade: { Croata: 'Croatá' } }, forced: { cod: 'text' }, removed: ['a', 'b'], locale: { dateOrder: 'dmy', numbers: 'br' } });
    expect(l).toEqual(expect.arrayContaining(['Filtro por clique: Município = Croatá', 'Período em “data”: de 01/01/2024 até 31/03/2024 (linhas sem data ficam fora)', 'Grafias unificadas em “cidade”: “Croata” → “Croatá”', 'Tipo da coluna “cod” definido manualmente: texto', '2 gráfico(s) removido(s) do painel pelo usuário']));
    expect(l[l.length - 1]).toMatch(/dia\/mês\/ano.*padrão brasileiro/);
    expect(describeState({ filters: {}, dateRange: {}, merges: {}, forced: {}, removed: [], locale: { dateOrder: 'mdy', numbers: 'us' } })).toHaveLength(1);
  });
  it('formata tamanho de arquivo', () => {
    expect(formatBytes(2 * 1048576)).toBe('2,0 MB');
    expect(formatBytes(100)).toBe('1 KB');
  });
});

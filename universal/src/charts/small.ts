import { Chart } from 'chart.js';
import { el } from '../app/dom.js';
import { PALETTE } from '../design/palette.js';
import type { SeriesData } from '../suggest.js';
import type { ChartHost } from './host.js';

export function drawSmall(card: HTMLElement, d: SeriesData, host: ChartHost): HTMLElement {
  const sets = d.datasets ?? [{ label: 'Valor', values: d.values }];
  const max = Math.max(1, ...sets.flatMap((s) => s.values).filter((v) => !Number.isNaN(v)));
  const grid = el('div', { className: 'small-grid' });
  sets.forEach((s, i) => {
    const total = s.values.filter((v) => !Number.isNaN(v)).reduce((a, b) => a + b, 0);
    const canvas = el('canvas');
    grid.append(el('div', { className: 'small-cell' }, el('div', { className: 'small-title' }, el('b', {}, s.label), ` · total ${new Intl.NumberFormat('pt-BR').format(total)}`), el('div', { className: 'small-box' }, canvas)));
    host.addChart(
      new Chart(canvas, {
        type: 'line',
        data: { labels: d.labels, datasets: [{ label: s.label, data: s.values.map((v) => (Number.isNaN(v) ? null : v)), borderColor: PALETTE[i % PALETTE.length], backgroundColor: PALETTE[i % PALETTE.length] + '33', fill: true, borderWidth: 2, pointRadius: 2, tension: 0.25, spanGaps: false }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 4, font: { size: 9 } } }, y: { min: 0, max, ticks: { maxTicksLimit: 3, font: { size: 9 } } } } },
      }),
    );
  });
  card.append(grid, el('p', { className: 'muted small-note' }, 'Todos os gráficos pequenos usam a mesma escala vertical, então podem ser comparados entre si.'));
  return card;
}

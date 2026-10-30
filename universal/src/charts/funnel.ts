import { Chart } from 'chart.js';
import { el } from '../app/dom.js';
import { PALETTE } from '../design/palette.js';
import { funnelData } from '../shapes.js';
import type { ChartSpec, Table } from '../types.js';
import { maxOf } from '../util.js';
import { dataAlt } from './dataAlt.js';
import type { ChartHost } from './host.js';

export function drawFunnel(card: HTMLElement, spec: ChartSpec, t: Table, host: ChartHost): HTMLElement {
  const f = funnelData(t, spec);
  if (!f || f.values.every((v) => v === 0)) {
    card.append(el('p', {}, 'Sem dados suficientes para este gráfico.'));
    return card;
  }
  card.append(el('p', { className: 'insight' }, el('b', {}, 'Destaque: '), `${f.labels[f.labels.length - 1]}.`));
  card.append(el('details', { className: 'howto' }, el('summary', {}, 'Por que este gráfico e como ler'), el('p', {}, el('b', {}, 'Por que: '), spec.why ?? ''), el('p', {}, el('b', {}, 'Como ler: '), spec.howTo ?? '')));
  const canvas = el('canvas', { role: 'img', ariaLabel: `${spec.title}. ${f.labels.join('; ')}` });
  card.append(el('div', { className: 'box short' }, canvas));
  card.append(dataAlt(f.labels, [{ label: 'Casos', values: f.values }]));
  const max = maxOf(f.values, 1);
  host.addChart(
    new Chart(canvas, {
      type: 'bar',
      data: { labels: f.labels, datasets: [{ label: 'Casos', data: f.values.map((v) => [-v / 2, v / 2]), backgroundColor: f.values.map((_, i) => PALETTE[i % PALETTE.length]), barThickness: 34 } as never] },
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${new Intl.NumberFormat('pt-BR').format(f.values[c.dataIndex]!)} casos` } } }, scales: { x: { min: -max / 2, max: max / 2, display: false }, y: { ticks: { font: { size: 12 } } } } },
    }),
  );
  return card;
}

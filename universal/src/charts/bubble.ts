import { Chart } from 'chart.js';
import { el } from '../app/dom.js';
import { PALETTE } from '../design/palette.js';
import { bubbleData } from '../shapes.js';
import type { ChartSpec, Table } from '../types.js';
import { maxOf } from '../util.js';
import { dataAlt } from './dataAlt.js';
import type { ChartHost } from './host.js';

export function drawBubble(card: HTMLElement, spec: ChartSpec, t: Table, host: ChartHost): HTMLElement {
  const pts = bubbleData(t, spec);
  if (!pts.length) {
    card.append(el('p', {}, 'Sem dados suficientes para este gráfico.'));
    return card;
  }
  const maxS = maxOf(pts.map((p) => p.size), 1);
  const top = [...pts].sort((a, b) => b.y - a.y)[0]!;
  card.append(el('p', { className: 'insight' }, el('b', {}, 'Destaque: '), `maior positividade em ${top.entity} (${top.y.toFixed(1).replace('.', ',')}%, ${new Intl.NumberFormat('pt-BR').format(top.x)} ${spec.bubble!.xLabel.toLowerCase()}).`));
  card.append(el('details', { className: 'howto' }, el('summary', {}, 'Por que este gráfico e como ler'), el('p', {}, el('b', {}, 'Por que: '), spec.why ?? ''), el('p', {}, el('b', {}, 'Como ler: '), spec.howTo ?? '')));
  const canvas = el('canvas', { role: 'img', ariaLabel: `${spec.title}. ${pts.map((p) => `${p.entity}: ${p.y.toFixed(1)}%`).join('; ')}` });
  card.append(el('div', { className: 'box' }, canvas));
  card.append(dataAlt(pts.map((p) => p.entity), [{ label: spec.bubble!.xLabel, values: pts.map((p) => p.x) }, { label: 'Positividade (%)', values: pts.map((p) => p.y) }, { label: spec.bubble!.sizeLabel, values: pts.map((p) => p.size) }]));
  host.addChart(
    new Chart(canvas, {
      type: 'bubble',
      data: { datasets: pts.map((p, i) => ({ label: p.entity, data: [{ x: p.x, y: p.y, r: 5 + (p.size / maxS) * 22 }], backgroundColor: PALETTE[i % PALETTE.length] + 'bb', borderColor: PALETTE[i % PALETTE.length] })) },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        onClick: (_e, els) => {
          const p = els[0] ? pts[els[0].datasetIndex] : undefined;
          if (p && t.tidy) host.toggleFilter(t.tidy.entity, p.entity);
        },
        plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (c) => { const p = pts[c.datasetIndex]!; return `${p.entity}: ${new Intl.NumberFormat('pt-BR').format(p.x)} ${spec.bubble!.xLabel.toLowerCase()} · ${p.y.toFixed(1).replace('.', ',')}% · ${spec.bubble!.sizeLabel}: ${new Intl.NumberFormat('pt-BR').format(p.size)}`; } } } },
        scales: { x: { beginAtZero: true, title: { display: true, text: spec.bubble!.xLabel } }, y: { min: 0, max: 100, title: { display: true, text: 'Positividade (%)' }, ticks: { callback: (v: string | number) => `${v}%` } } },
      },
    }),
  );
  return card;
}

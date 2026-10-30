import { Chart } from 'chart.js';
import { el } from '../app/dom.js';
import { PALETTE } from '../design/palette.js';
import { toNumber } from '../profile.js';
import type { ChartSpec, Table } from '../types.js';
import type { ChartHost } from './host.js';

/** Dispersão entre duas colunas numéricas; só entram as linhas em que as duas têm valor. */
export function drawScatter(card: HTMLElement, spec: ChartSpec, t: Table, host: ChartHost): HTMLElement {
    const pts = t.rows.map((r) => ({ x: toNumber(r[spec.x!] ?? null), y: toNumber(r[spec.y!] ?? null) })).filter((p): p is { x: number; y: number } => p.x != null && p.y != null);
    const canvas = el('canvas');
    card.append(el('div', { className: 'box' }, canvas));
    host.addChart(new Chart(canvas, { type: 'scatter', data: { datasets: [{ label: `${spec.x} × ${spec.y}`, data: pts, backgroundColor: PALETTE[0] + 'aa' }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { title: { display: true, text: spec.x } }, y: { title: { display: true, text: spec.y } } } } }));
    return card;
}

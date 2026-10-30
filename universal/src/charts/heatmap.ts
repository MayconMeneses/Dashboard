import { el } from '../app/dom.js';
import { toHeatmap } from '../shapes.js';
import type { SeriesData } from '../suggest.js';
import type { ChartSpec } from '../types.js';
import { heatCell } from '../util.js';
import type { ChartHost } from './host.js';

export function drawHeatmap(card: HTMLElement, spec: ChartSpec, d: SeriesData, host: ChartHost): HTMLElement {
  const h = toHeatmap(d);
  const th = (txt: string, onclick?: () => void) => {
    const c = el('th', {}, txt);
    if (onclick) {
      c.style.cursor = 'pointer';
      c.title = 'Clique (ou Enter) para filtrar';
      c.tabIndex = 0;
      c.setAttribute('role', 'button');
      c.onclick = onclick;
      c.onkeydown = (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onclick());
    }
    return c;
  };
  const fmt = new Intl.NumberFormat('pt-BR');
  const table = el(
    'table',
    { className: 'heat' },
    el('thead', {}, el('tr', {}, el('th', {}, ''), ...h.cols.map((c) => th(c, spec.x ? () => host.toggleFilter(spec.x!, c) : undefined)))),
    el('tbody', {}, ...h.rows.map((r, ri) => el('tr', {}, th(r, spec.seriesBy ? () => host.toggleFilter(spec.seriesBy!, r) : undefined), ...h.cells[ri]!.map((v, ci) => {
      const td = el('td', {}, Number.isNaN(v) ? '—' : fmt.format(v));
      if (Number.isNaN(v)) {
        td.className = 'nodata';
        td.title = `${r} · ${h.cols[ci]}: sem dado (não é zero)`;
      } else {
        const hc = heatCell(h.max > h.min ? (v - h.min) / (h.max - h.min) : 1);
        td.style.background = hc.bg;
        td.style.color = hc.fg;
        td.title = `${r} · ${h.cols[ci]}: ${fmt.format(v)}`;
      }
      return td;
    })))),
  );
  card.dataset.heat = JSON.stringify({ rows: h.rows, cols: h.cols, cells: h.cells.map((r) => r.map((v) => (Number.isNaN(v) ? null : v))), min: h.min, max: h.max });
  const fmtN = new Intl.NumberFormat('pt-BR');
  card.append(el('div', { className: 'heatwrap' }, table), el('div', { className: 'heat-legend' }, el('span', {}, fmtN.format(h.min)), el('span', { className: 'grad', ariaHidden: 'true' }), el('span', {}, fmtN.format(h.max)), el('span', { className: 'muted' }, ' · listrado = sem dado (não é zero)')));
  return card;
}

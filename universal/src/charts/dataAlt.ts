import { el } from '../app/dom.js';

/** Tabela com os mesmos números do gráfico, para leitor de tela e para conferir valores. */
export function dataAlt(labels: string[], series: { label: string; values: number[] }[]): HTMLElement {
  const fmt = new Intl.NumberFormat('pt-BR');
  const val = (v: number) => (Number.isNaN(v) ? 'sem dado' : fmt.format(v));
  return el(
    'details',
    { className: 'data-alt' },
    el('summary', {}, 'Ver os dados deste gráfico em tabela'),
    el('div', { className: 'tablewrap' }, el('table', {}, el('thead', {}, el('tr', {}, el('th', {}, ''), ...series.map((s) => el('th', {}, s.label)))), el('tbody', {}, ...labels.map((l, i) => el('tr', {}, el('th', {}, l), ...series.map((s) => el('td', {}, val(s.values[i] ?? Number.NaN)))))))),
  );
}

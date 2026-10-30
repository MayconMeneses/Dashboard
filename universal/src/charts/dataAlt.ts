import { el } from '../app/dom.js';

/**
 * Tabela com os mesmos números do gráfico, para leitor de tela e para conferir valores.
 * Com `onPick`, o rótulo de cada linha é um botão que filtra o painel por aquele valor — o equivalente por teclado do clique na barra ou fatia.
 */
export function dataAlt(labels: string[], series: { label: string; values: number[] }[], onPick?: (label: string) => void): HTMLElement {
  const fmt = new Intl.NumberFormat('pt-BR');
  const val = (v: number) => (Number.isNaN(v) ? 'sem dado' : fmt.format(v));
  const rotulo = (l: string) => {
    if (!onPick) return el('th', {}, l);
    const b = el('button', { type: 'button', className: 'pick', title: `Filtrar o painel por “${l}”` }, l);
    b.onclick = () => onPick(l);
    return el('th', {}, b);
  };
  return el(
    'details',
    { className: 'data-alt' },
    el('summary', {}, onPick ? 'Ver os dados deste gráfico em tabela (e filtrar por teclado)' : 'Ver os dados deste gráfico em tabela'),
    el('div', { className: 'tablewrap' }, el('table', {}, el('thead', {}, el('tr', {}, el('th', {}, ''), ...series.map((s) => el('th', {}, s.label)))), el('tbody', {}, ...labels.map((l, i) => el('tr', {}, rotulo(l), ...series.map((s) => el('td', {}, val(s.values[i] ?? Number.NaN)))))))),
  );
}

import type { ColProfile } from '../types.js';
import { periodoAtual, periodoRapido, PERIODOS } from './busca.js';
import type { PeriodoRapido } from './busca.js';
import { $, el } from './dom.js';
import type { PainelCtx } from './painelCtx.js';

const iso = (ms?: number) => (ms == null ? undefined : new Date(ms).toISOString().slice(0, 10));

/** Etiquetas dos recortes ativos (filtros por clique, busca e período), cada uma removível. */
export function renderChips(ctx: PainelCtx): void {
  const chips: HTMLElement[] = [];
  const chip = (texto: string, titulo: string, remover: () => void) => {
    const b = el('button', { type: 'button', className: 'chip', title: titulo }, `${texto}  ✕`);
    b.onclick = remover;
    chips.push(b);
  };
  for (const [k, v] of Object.entries(ctx.filters())) chip(`${k}: ${v}`, 'Remover este filtro', () => ctx.setFilter(k, null));
  if (ctx.search().trim()) chip(`Busca: ${ctx.search().trim()}`, 'Limpar a busca', () => ctx.setSearch(''));
  const r = ctx.dateRange();
  if (r.col && (r.from || r.to)) chip(`${r.col}: ${r.from ?? '…'} a ${r.to ?? '…'}`, 'Limpar o período', () => ctx.setDateRange({}));
  $('chips').replaceChildren(...chips);
  ($('chips') as HTMLElement).hidden = !chips.length;
}

/** Barra de período (coluna de data, de/até) e o seletor de período rápido do topo. */
export function renderPeriodo(prof: ColProfile[], ctx: PainelCtx): void {
  const bar = $('dateBar');
  const rapido = $('gPeriodo') as HTMLSelectElement;
  const dcols = prof.filter((p) => p.type === 'date');
  bar.hidden = !dcols.length;
  (rapido.closest('label') as HTMLElement).hidden = !dcols.length;
  if (!dcols.length) return;
  const dr = ctx.dateRange();
  const col = dr.col && dcols.some((d) => d.name === dr.col) ? dr.col : dcols[0]!.name;
  const cur = dcols.find((d) => d.name === col)!;
  const sel = el('select', { ariaLabel: 'Coluna de data do período' }, ...dcols.map((d) => el('option', { value: d.name, selected: d.name === col }, d.name)));
  const from = el('input', { type: 'date', value: dr.from ?? '', min: iso(cur.minDate), max: iso(cur.maxDate), ariaLabel: 'Período: de' });
  const to = el('input', { type: 'date', value: dr.to ?? '', min: iso(cur.minDate), max: iso(cur.maxDate), ariaLabel: 'Período: até' });
  const apply = () => setTimeout(() => ctx.setDateRange({ col: sel.value, from: from.value || undefined, to: to.value || undefined }), 0);
  sel.onchange = apply;
  from.onchange = apply;
  to.onchange = apply;
  const clear = el('button', { type: 'button', className: 'mini' }, 'Limpar período');
  clear.onclick = () => ctx.setDateRange({});
  bar.replaceChildren(el('b', {}, 'Período: '), sel, ' de ', from, ' até ', to, ' ', clear, el('span', { className: 'muted' }, ' Linhas sem data nessa coluna ficam fora quando o período está ativo.'));
  // seletor rápido do topo: mostra “personalizado” quando o intervalo não é um dos modelos
  const atual = periodoAtual(dr, cur.maxDate ?? 0);
  rapido.replaceChildren(...PERIODOS.map(([v, n]) => el('option', { value: v, selected: v === atual }, n)), ...(atual === 'custom' ? [el('option', { value: 'custom', selected: true, disabled: true }, 'Personalizado')] : []));
  rapido.onchange = () => ctx.setDateRange(rapido.value === 'tudo' ? {} : { col, ...periodoRapido(rapido.value as PeriodoRapido, cur.maxDate ?? 0) });
}

/** Liga a caixa de busca do topo (com pequena espera para não refazer o painel a cada tecla). */
export function initBusca(ctx: PainelCtx): void {
  const q = $('gSearch') as HTMLInputElement;
  let t: ReturnType<typeof setTimeout> | undefined;
  q.oninput = () => {
    clearTimeout(t);
    t = setTimeout(() => ctx.setSearch(q.value), 250);
  };
}

/** Mantém a caixa de busca igual ao estado (ao abrir projeto, limpar tudo…), sem tirar o foco de quem está digitando. */
export function syncBusca(ctx: PainelCtx): void {
  const q = $('gSearch') as HTMLInputElement;
  if (document.activeElement !== q && q.value !== ctx.search()) q.value = ctx.search();
}

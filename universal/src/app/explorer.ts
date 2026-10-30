import { AGG_NAMES, defaultChoice, exploreSpec } from '../analytics/explore.js';
import type { ExploreChoice } from '../analytics/explore.js';
import { semanticProfile } from '../analytics/semantic.js';
import type { ColProfile, ChartSpec, ColType, Table } from '../types.js';
import { el } from './dom.js';
import type { Agg } from '../analytics/chartData.js';

let choice: ExploreChoice | null = null;

/** Cartão “Explorar por conta própria”: o usuário escolhe agrupamento, medida e cálculo; o gráfico usa os mesmos dados e filtros do painel. */
export function explorerCard(full: Table, prof: ColProfile[], forced: Record<string, ColType>, draw: (spec: ChartSpec) => HTMLElement, rerender: () => void): HTMLElement | null {
  const sem = semanticProfile(full, prof, forced);
  const names = new Set(sem.map((s) => s.name));
  if (!choice || !names.has(choice.x) || (choice.y && !names.has(choice.y))) choice = defaultChoice(sem);
  if (!choice) return null;
  const cur = choice;
  const pick = (label: string, value: string, opts: [string, string][], set: (v: string) => void) => {
    const sel = el('select', { ariaLabel: label }, ...opts.map(([v, n]) => el('option', { value: v, selected: v === value }, n)));
    sel.onchange = () => {
      set(sel.value);
      rerender();
    };
    return el('label', { className: 'explore-pick' }, `${label}: `, sel);
  };
  const cols = (roles: string[]): [string, string][] => sem.filter((s) => roles.includes(s.role)).map((s) => [s.name, s.name]);
  const card = el('section', { className: 'card explore', id: 'secExplorar' }, el('header', {}, el('h3', {}, 'Explorar por conta própria')), el('p', {}, 'Escolha como agrupar e qual conta fazer; o gráfico respeita os filtros atuais.'));
  card.append(
    el(
      'p',
      { className: 'rate-pick' },
      pick('Agrupar por', cur.x, cols(['dimension', 'flag', 'time']), (v) => (choice = { ...cur, x: v })),
      ' ',
      pick('Medida', cur.y, [['', '— (só contar registros)'], ...cols(['measure'])], (v) => (choice = { ...cur, y: v, agg: v ? (cur.agg === 'count' ? 'sum' : cur.agg) : 'count' })),
      ' ',
      pick('Cálculo', cur.agg, (Object.keys(AGG_NAMES) as Agg[]).map((a) => [a, AGG_NAMES[a]]), (v) => (choice = { ...cur, agg: v as Agg })),
    ),
  );
  const r = exploreSpec(cur, sem);
  if (r.spec) {
    const g = draw(r.spec);
    g.querySelector('.x')?.remove(); // o gráfico muda pelas escolhas acima, não por “remover”
    card.append(g);
  } else card.append(el('p', { className: 'muted', role: 'alert' }, r.problem));
  return card;
}

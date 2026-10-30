import { el } from './dom.js';
import { filterEffects, lineageOf, semanticProfile } from '../analytics/semantic.js';
import type { LineageState } from '../analytics/semantic.js';
import type { ColProfile, Table } from '../types.js';

const ROLE_NAMES: Record<string, string> = { identifier: 'identificador', measure: 'medida', dimension: 'dimensão', time: 'tempo', geo: 'geográfica', flag: 'sim/não', text: 'texto' };

/** Papel e origem de cada coluna, para a tabela “Colunas reconhecidas”: o texto completo (regra + linhagem) fica na dica. */
export function columnInfo(t: Table, prof: ColProfile[], st: LineageState): Map<string, HTMLElement> {
  return new Map(
    semanticProfile(t, prof, st.forced).map((s) => {
      const origem = lineageOf(s.name, st);
      const cell = el('td', { title: [...s.reasons, ...origem].join('\n') }, `${ROLE_NAMES[s.role]} · ${origem.join(' ')}`);
      return [s.name, cell] as const;
    }),
  );
}

/** Aviso sob os filtros: o que o recorte mudou nas colunas (preenchidas e valores distintos) em relação à tabela inteira. */
export function filterNote(full: ColProfile[], view: ColProfile[]): HTMLElement | null {
  const ef = filterEffects(full, view);
  if (!ef.length) return null;
  const shown = ef.slice(0, 6).map((e) => `“${e.name}”: ${e.filledView} de ${e.filledFull} preenchidas, ${e.uniqueView} de ${e.uniqueFull} valores distintos`);
  return el('span', { className: 'muted filter-note' }, `Efeito do filtro — ${shown.join('; ')}${ef.length > shown.length ? `; e mais ${ef.length - shown.length} coluna(s)` : ''}.`);
}

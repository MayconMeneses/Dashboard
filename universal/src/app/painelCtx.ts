import type { ColProfile } from '../types.js';

export interface DateRange {
  col?: string;
  from?: string;
  to?: string;
}

/** O que os controles do topo e o painel de filtros precisam do painel (eles não conhecem o estado da tela). */
export interface PainelCtx {
  filters(): Record<string, string>;
  /** `valor` null remove o filtro da coluna */
  setFilter(col: string, valor: string | null): void;
  dateRange(): DateRange;
  setDateRange(r: DateRange): void;
  search(): string;
  setSearch(v: string): void;
  prof(): ColProfile[];
  limparTudo(): void;
}

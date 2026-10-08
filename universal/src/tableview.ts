import { toDate, toNumber } from './profile.js';
import type { ColType, Row } from './types.js';

export type SortDir = 'asc' | 'desc';

/** Ordena linhas por uma coluna (número, data ou texto em português); vazios sempre por último. */
export function sortRows(rows: Row[], col: string, dir: SortDir, type: ColType | undefined): Row[] {
  const num = type === 'number' || type === 'integer' || type === 'lat' || type === 'lon';
  const key = (r: Row): number | string | null => {
    const v = r[col];
    if (v == null) return null;
    if (num) return toNumber(v);
    if (type === 'date') return toDate(v);
    return String(v);
  };
  const keyed = rows.map((r, i) => ({ r, i, k: key(r) }));
  const m = dir === 'asc' ? 1 : -1;
  keyed.sort((a, b) => {
    if (a.k == null && b.k == null) return a.i - b.i;
    if (a.k == null) return 1;
    if (b.k == null) return -1;
    const c = typeof a.k === 'number' && typeof b.k === 'number' ? a.k - b.k : String(a.k).localeCompare(String(b.k), 'pt-BR', { numeric: true, sensitivity: 'base' });
    return c ? c * m : a.i - b.i;
  });
  return keyed.map((x) => x.r);
}

export function pageOf<T>(rows: T[], page: number, size: number): { items: T[]; page: number; pages: number; from: number; to: number } {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const p = Math.min(Math.max(1, page), pages);
  const from = rows.length ? (p - 1) * size + 1 : 0;
  const to = Math.min(rows.length, p * size);
  return { items: rows.slice((p - 1) * size, p * size), page: p, pages, from, to };
}

/** Mantém só as linhas cuja data da coluna está no intervalo (limites inclusivos, em AAAA-MM-DD). Sem data = fora. */
export function filterByDate(rows: Row[], col: string, from?: string, to?: string): Row[] {
  if (!from && !to) return rows;
  const lo = from ? Date.parse(from + 'T00:00:00Z') : -Infinity;
  const hi = to ? Date.parse(to + 'T23:59:59.999Z') : Infinity;
  return rows.filter((r) => {
    const d = toDate(r[col] ?? null);
    return d != null && d >= lo && d <= hi;
  });
}

import type { ColProfile, Row, Table } from './types.js';

export interface SimilarGroup {
  col: string;
  values: { value: string; count: number }[];
  /** grafia mais frequente, sugerida como definitiva */
  suggested: string;
}

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

function lev1(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : b.slice(i + 1) === a.slice(i);
}

/** Valores da mesma coluna que provavelmente são a mesma categoria (acento, caixa, espaços ou 1 letra de diferença). */
export function similarGroups(t: Table, prof: ColProfile[], maxUnique = 300): SimilarGroup[] {
  const out: SimilarGroup[] = [];
  for (const p of prof) {
    if (p.type !== 'category' && p.type !== 'text') continue;
    if (p.unique > maxUnique || p.unique < 2) continue;
    const counts = new Map<string, number>();
    for (const r of t.rows) {
      const v = r[p.name];
      if (typeof v === 'string' && v.trim() !== '') counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    const vals = [...counts.keys()];
    const parent = new Map(vals.map((v) => [v, v]));
    const find = (x: string): string => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x)!)), parent.get(x)!));
    const join = (a: string, b: string) => parent.set(find(a), find(b));
    const keys = vals.map((v) => [v, norm(v)] as const);
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const [va, ka] = keys[i]!;
        const [vb, kb] = keys[j]!;
        if (ka === kb || (ka.length >= 5 && kb.length >= 5 && lev1(ka, kb))) join(va, vb);
      }
    }
    const groups = new Map<string, string[]>();
    for (const v of vals) groups.set(find(v), [...(groups.get(find(v)) ?? []), v]);
    for (const g of groups.values()) {
      if (g.length < 2) continue;
      const vs = g.map((value) => ({ value, count: counts.get(value)! })).sort((a, b) => b.count - a.count);
      out.push({ col: p.name, values: vs, suggested: vs[0]!.value });
    }
  }
  return out;
}

/** Aplica "juntar grafias": troca cada valor listado pelo definitivo. */
export function applyMerges(t: Table, merges: Record<string, Record<string, string>>): Table {
  const cols = Object.keys(merges).filter((c) => t.columns.includes(c));
  if (!cols.length) return t;
  const rows: Row[] = t.rows.map((r) => {
    let o: Row | null = null;
    for (const c of cols) {
      const v = r[c];
      const to = typeof v === 'string' ? merges[c]![v] : undefined;
      if (to !== undefined && to !== v) (o ??= { ...r })[c] = to;
    }
    return o ?? r;
  });
  return { ...t, rows };
}

import { VALUE_COL } from '../grid.js';
import { toDate, toNumber } from '../profile.js';
import type { ChartSpec, Row, Table } from '../types.js';
import { maxOf, minOf } from '../util.js';
import { fmtNum } from './format.js';

export interface SeriesData {
  labels: string[];
  values: number[];
  /** para empilhado */
  datasets?: { label: string; values: number[]; line?: boolean }[];
}

export const monthKey = (ts: number) => new Date(ts).toISOString().slice(0, 7);

export type Agg = NonNullable<ChartSpec['agg']>;
/** Acumulador de um grupo: o suficiente para soma, média, mínimo, máximo e (guardando os valores) mediana. */
export interface Acc {
  n: number;
  s: number;
  min: number;
  max: number;
  vals?: number[];
}

/** Valor final de um grupo. O `switch` é exaustivo: uma métrica nova sem tratamento não compila. */
export function finish(how: Agg, a: Acc): number {
  switch (how) {
    case 'count':
    case 'sum':
      return a.s;
    case 'mean':
      return a.s / a.n;
    case 'min':
      return a.min;
    case 'max':
      return a.max;
    case 'median': {
      const v = [...a.vals!].sort((x, y) => x - y);
      const m = Math.floor(v.length / 2);
      return v.length % 2 ? v[m]! : (v[m - 1]! + v[m]!) / 2;
    }
    default: {
      const nunca: never = how;
      throw new Error(`métrica desconhecida: ${String(nunca)}`);
    }
  }
}

const add = (e: Acc | undefined, v: number, keep: boolean): Acc => {
  const a = e ?? { n: 0, s: 0, min: Infinity, max: -Infinity, ...(keep ? { vals: [] as number[] } : {}) };
  a.n++;
  a.s += v;
  if (v < a.min) a.min = v;
  if (v > a.max) a.max = v;
  a.vals?.push(v);
  return a;
};

export function agg(rows: Row[], key: (r: Row) => string | null, val: (r: Row) => number | null, how: Agg) {
  const m = new Map<string, Acc>();
  for (const r of rows) {
    const k = key(r);
    if (k == null) continue;
    const v = how === 'count' ? 1 : val(r);
    if (v == null) continue;
    m.set(k, add(m.get(k), v, how === 'median'));
  }
  return m;
}

/** Calcula os dados de um gráfico. Valores ausentes ficam de fora (nunca viram zero). */
export function chartData(t: Table, spec: ChartSpec): SeriesData {
  if (spec.kind === 'pivot') return pivotData(t, spec);
  const how = spec.agg ?? 'count';
  const get = (c: string) => (r: Row) => (r[c] == null ? null : String(r[c]));
  const num = (c?: string) => (r: Row) => (c ? toNumber(r[c] ?? null) : null);

  if (spec.kind === 'multi' && spec.x && spec.series) {
    const rows = t.rows.filter((r) => r[spec.x!] != null);
    const col = (c: string, line?: boolean) => ({ label: c, values: rows.map((r) => toNumber(r[c] ?? null) ?? Number.NaN), ...(line ? { line } : {}) });
    return { labels: rows.map((r) => String(r[spec.x!])), values: [], datasets: [...spec.series.map((c) => col(c)), ...(spec.lineSeries ?? []).map((c) => col(c, true))] };
  }
  if (spec.kind === 'part' && spec.x && spec.part?.all) {
    const rows = t.rows.filter((r) => r[spec.x!] != null);
    const w = rows.map((r) => toNumber(r[spec.part!.whole] ?? null));
    const pt = rows.map((r) => toNumber(r[spec.part!.part] ?? null));
    const ok = (i: number) => w[i] != null && pt[i] != null && pt[i]! <= w[i]!;
    return { labels: rows.map((r) => String(r[spec.x!])), values: [], datasets: [{ label: spec.part.part, values: rows.map((_, i) => (ok(i) ? pt[i]! : Number.NaN)) }, { label: `Restante de “${spec.part.whole}”`, values: rows.map((_, i) => (ok(i) ? w[i]! - pt[i]! : Number.NaN)) }] };
  }
  if (spec.kind === 'profile' && spec.x && spec.indicators) {
    const rows = t.rows.filter((r) => r[spec.x!] != null);
    const cols = spec.indicators;
    const mx = cols.map((c) => Math.max(0, ...rows.map((r) => toNumber(r[c] ?? null) ?? 0)));
    return { labels: cols, values: [], datasets: rows.map((r) => ({ label: String(r[spec.x!]), values: cols.map((c, i) => { const v = toNumber(r[c] ?? null); return v == null || !mx[i] ? Number.NaN : (v / mx[i]!) * 100; }) })) };
  }
  if (spec.kind === 'change' && spec.x && spec.indicators) {
    const rows = t.rows.filter((r) => r[spec.x!] != null);
    const f = rows[0];
    const l = rows[rows.length - 1];
    const items = spec.indicators
      .map((c) => ({ c, a: f ? toNumber(f[c] ?? null) : null, b: l ? toNumber(l[c] ?? null) : null }))
      .filter((x): x is { c: string; a: number; b: number } => x.a != null && x.b != null && x.a !== 0)
      .map((x) => ({ c: x.c, pct: ((x.b - x.a) / Math.abs(x.a)) * 100 }))
      .sort((p, q) => q.pct - p.pct);
    return { labels: items.map((x) => x.c), values: items.map((x) => x.pct) };
  }
  if (spec.kind === 'part' && spec.x && spec.part) {
    const rows = t.rows.filter((r) => r[spec.x!] != null);
    const r = rows[Math.min(rows.length - 1, Math.max(0, spec.row ?? rows.length - 1))];
    const w = r ? toNumber(r[spec.part.whole] ?? null) : null;
    const pt = r ? toNumber(r[spec.part.part] ?? null) : null;
    if (!r || w == null || pt == null || pt > w) return { labels: [], values: [] };
    return { labels: [spec.part.part, `Restante de “${spec.part.whole}”`], values: [pt, w - pt] };
  }
  if (spec.kind === 'line' && spec.x) {
    const m = agg(t.rows, (r) => { const d = toDate(r[spec.x!] ?? null); return d == null ? null : monthKey(d); }, num(spec.y), how);
    const keys = [...m.keys()].sort();
    if (!keys.length) return { labels: [], values: [] };
    const labels: string[] = [];
    const [y0, mo0] = keys[0]!.split('-').map(Number) as [number, number];
    const [y1, mo1] = keys[keys.length - 1]!.split('-').map(Number) as [number, number];
    for (let y = y0, mo = mo0; y < y1 || (y === y1 && mo <= mo1); mo === 12 ? (y++, (mo = 1)) : mo++) labels.push(`${y}-${String(mo).padStart(2, '0')}`);
    return { labels, values: labels.map((l) => (m.get(l) ? finish(how, m.get(l)!) : how === 'count' || how === 'sum' ? 0 : Number.NaN)) };
  }
  if (spec.kind === 'hist' && spec.x) {
    const v = t.rows.map((r) => toNumber(r[spec.x!] ?? null)).filter((x): x is number => x != null);
    if (!v.length) return { labels: [], values: [] };
    const lo = minOf(v);
    const hi = maxOf(v);
    const bins = Math.min(12, Math.max(4, Math.ceil(Math.sqrt(v.length))));
    const w = (hi - lo) / bins || 1;
    const counts = new Array<number>(bins).fill(0);
    for (const x of v) counts[Math.min(bins - 1, Math.floor((x - lo) / w))]!++;
    return { labels: counts.map((_, i) => `${fmtNum(lo + i * w)}–${fmtNum(lo + (i + 1) * w)}`), values: counts };
  }
  if (spec.kind === 'stacked' && spec.x && spec.stack) {
    const xs = new Map<string, number>();
    const ss = new Set<string>();
    for (const r of t.rows) {
      const a = r[spec.x];
      const b = r[spec.stack];
      if (a == null || b == null) continue;
      xs.set(String(a), (xs.get(String(a)) ?? 0) + 1);
      ss.add(String(b));
    }
    const labels = [...xs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map((e) => e[0]);
    const datasets = [...ss].map((s) => ({ label: s, values: labels.map((l) => t.rows.filter((r) => String(r[spec.x!]) === l && String(r[spec.stack!]) === s).length) }));
    return { labels, values: labels.map((l) => xs.get(l)!), datasets };
  }
  if (spec.x) {
    const m = agg(t.rows, get(spec.x), num(spec.y), how);
    let e = [...m.entries()].map(([k, a]) => [k, finish(how, a)] as const);
    if (!spec.keepOrder) e = e.sort((a, b) => b[1] - a[1]).slice(0, 15);
    return { labels: e.map((x) => x[0]), values: e.map((x) => x[1]) };
  }
  return { labels: [], values: [] };
}

/** valor especial em `where`: aceita linhas em que a coluna está vazia (ex.: indicador sem agravo informado) */
export const NONE = '∅';
export const sumBy = (t: Table, col: string) => {
  const m = new Map<string, number>();
  for (const r of t.rows) {
    const k = r[col];
    const v = toNumber(r[VALUE_COL] ?? null);
    if (k == null || v == null) continue;
    m.set(String(k), (m.get(String(k)) ?? 0) + v);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

/** Dados de um gráfico "pivot": soma de y por x, com uma série por valor de seriesBy; vazio ≠ zero. */
export function pivotData(t: Table, spec: ChartSpec): SeriesData {
  const x = spec.x!;
  const yCol = spec.y ?? VALUE_COL;
  const counting = spec.agg === 'count';
  const rows = t.rows.filter((r) => Object.entries(spec.where ?? {}).every(([c, vals]) => (r[c] == null ? vals.includes(NONE) : vals.includes(String(r[c])))));
  const xs: string[] = [];
  for (const r of rows) {
    const k = r[x];
    if (k != null && !xs.includes(String(k))) xs.push(String(k));
  }
  const seriesKeys: string[] = [];
  if (spec.seriesBy) for (const r of rows) {
    const k = r[spec.seriesBy];
    if (k != null && !seriesKeys.includes(String(k))) seriesKeys.push(String(k));
  }
  const how: Agg = spec.agg ?? 'sum';
  const sum = (pred: (r: Row) => boolean): number => {
    let acc: Acc | undefined;
    for (const r of rows) {
      if (!pred(r)) continue;
      const v = counting ? (r[x] == null ? null : 1) : toNumber(r[yCol] ?? null);
      if (v == null) continue;
      acc = add(acc, v, how === 'median');
    }
    return acc ? finish(how, acc) : Number.NaN;
  };
  if (!spec.seriesBy) {
    let e = xs.map((k) => [k, sum((r) => String(r[x]) === k)] as const);
    if (!spec.keepOrder) e = e.filter(([, v]) => !Number.isNaN(v)).sort((a, b) => b[1] - a[1]).slice(0, 25);
    return { labels: e.map((a) => a[0]), values: e.map((a) => a[1]) };
  }
  const order = spec.keepOrder ? xs : [...xs].sort((a, b) => (sum((r) => String(r[x]) === b) || 0) - (sum((r) => String(r[x]) === a) || 0));
  return {
    labels: order,
    values: order.map((k) => sum((r) => String(r[x]) === k)),
    datasets: seriesKeys.map((sk) => ({ label: sk, values: order.map((k) => sum((r) => String(r[x]) === k && String(r[spec.seriesBy!]) === sk)) })),
  };
}

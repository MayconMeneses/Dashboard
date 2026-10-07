import { toDate, toNumber } from './profile.js';
import type { ChartSpec, ColProfile, Kpi, Row, Table } from './types.js';

export const fmtNum = (n: number) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(n);

/** Sugere gráficos conforme os tipos de coluna; `level` 1 = enxuto … 3 = completo. */
export function suggestCharts(t: Table, prof: ColProfile[], level = 2): ChartSpec[] {
  const out: ChartSpec[] = [];
  const cats = prof.filter((p) => p.type === 'category' && p.unique >= 2).sort((a, b) => a.unique - b.unique);
  const nums = prof.filter((p) => p.type === 'number' || p.type === 'integer');
  const dates = prof.filter((p) => p.type === 'date');
  const bools = prof.filter((p) => p.type === 'boolean');
  const lat = prof.find((p) => p.type === 'lat');
  const lon = prof.find((p) => p.type === 'lon');
  let n = 0;
  const id = (k: string) => `${k}-${n++}`;

  if (lat && lon) out.push({ id: id('map'), kind: 'map', title: 'Mapa dos registros', description: `Cada ponto é um registro com coordenadas (${lat.filled} de ${t.rows.length}).`, score: 95 });

  for (const d of dates.slice(0, 2)) {
    out.push({ id: id('line'), kind: 'line', x: d.name, agg: 'count', title: `Registros por mês – ${d.name}`, description: 'Quantidade de registros em cada mês; meses sem registro aparecem como zero.', score: 90 });
    const m = nums[0];
    if (m && level >= 3) out.push({ id: id('line'), kind: 'line', x: d.name, y: m.name, agg: 'sum', title: `${m.name} por mês`, description: `Soma de “${m.name}” em cada mês.`, score: 60 });
  }
  cats.slice(0, level === 1 ? 2 : level === 2 ? 4 : 6).forEach((c, i) => {
    const small = c.unique <= 6;
    out.push({ id: id('cat'), kind: small ? 'donut' : 'hbar', x: c.name, agg: 'count', title: `Registros por ${c.name}`, description: small ? `Proporção de cada valor de “${c.name}”.` : `Os valores mais frequentes de “${c.name}” (até 15).`, score: 85 - i * 5 });
  });
  for (const b of bools.slice(0, 2)) out.push({ id: id('bool'), kind: 'donut', x: b.name, agg: 'count', title: `${b.name}`, description: 'Distribuição Sim/Não.', score: 70 });
  nums.slice(0, level === 1 ? 1 : level === 2 ? 3 : 5).forEach((m, i) => {
    out.push({ id: id('hist'), kind: 'hist', x: m.name, title: `Distribuição de ${m.name}`, description: `Quantos registros caem em cada faixa de “${m.name}”.`, score: 75 - i * 5 });
  });
  const c0 = cats.find((c) => c.unique <= 25);
  if (c0 && nums[0] && level >= 2) out.push({ id: id('catnum'), kind: 'hbar', x: c0.name, y: nums[0].name, agg: 'sum', title: `${nums[0].name} por ${c0.name}`, description: `Soma de “${nums[0].name}” para cada valor de “${c0.name}”.`, score: 80 });
  const c1 = cats.find((c) => c.name !== c0?.name && c.unique <= 8);
  if (c0 && c1 && c0.unique <= 15 && level >= 3) out.push({ id: id('stack'), kind: 'stacked', x: c0.name, stack: c1.name, agg: 'count', title: `${c0.name} × ${c1.name}`, description: `Cruzamento entre “${c0.name}” e “${c1.name}”.`, score: 55 });

  return out.sort((a, b) => b.score - a.score).slice(0, level === 1 ? 4 : level === 2 ? 8 : 14);
}

export function kpis(t: Table, prof: ColProfile[]): Kpi[] {
  const out: Kpi[] = [{ label: 'Registros', value: fmtNum(t.rows.length) }, { label: 'Colunas', value: String(t.columns.length) }];
  const m = prof.find((p) => p.type === 'number' || p.type === 'integer');
  if (m?.sum != null) out.push({ label: `Total de ${m.name}`, value: fmtNum(m.sum), hint: `média ${fmtNum(m.mean!)} · mediana ${fmtNum(m.median!)}` });
  const d = prof.find((p) => p.type === 'date');
  if (d?.minDate != null) out.push({ label: `Período (${d.name})`, value: `${new Date(d.minDate).toLocaleDateString('pt-BR', { timeZone: 'UTC' })} a ${new Date(d.maxDate!).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}` });
  const filled = prof.reduce((a, p) => a + p.filled, 0) / Math.max(1, t.rows.length * t.columns.length);
  out.push({ label: 'Preenchimento', value: `${(filled * 100).toFixed(0)}%`, hint: 'células com valor; vazio nunca é tratado como zero' });
  return out;
}

export interface SeriesData {
  labels: string[];
  values: number[];
  /** para empilhado */
  datasets?: { label: string; values: number[] }[];
}

const monthKey = (ts: number) => new Date(ts).toISOString().slice(0, 7);

function agg(rows: Row[], key: (r: Row) => string | null, val: (r: Row) => number | null, how: 'count' | 'sum' | 'mean') {
  const m = new Map<string, { n: number; s: number }>();
  for (const r of rows) {
    const k = key(r);
    if (k == null) continue;
    const v = how === 'count' ? 1 : val(r);
    if (v == null) continue;
    const e = m.get(k) ?? { n: 0, s: 0 };
    e.n++;
    e.s += v;
    m.set(k, e);
  }
  return m;
}

/** Calcula os dados de um gráfico. Valores ausentes ficam de fora (nunca viram zero). */
export function chartData(t: Table, spec: ChartSpec): SeriesData {
  const how = spec.agg ?? 'count';
  const get = (c: string) => (r: Row) => (r[c] == null ? null : String(r[c]));
  const num = (c?: string) => (r: Row) => (c ? toNumber(r[c] ?? null) : null);

  if (spec.kind === 'line' && spec.x) {
    const m = agg(t.rows, (r) => { const d = toDate(r[spec.x!] ?? null); return d == null ? null : monthKey(d); }, num(spec.y), how);
    const keys = [...m.keys()].sort();
    if (!keys.length) return { labels: [], values: [] };
    const labels: string[] = [];
    const [y0, mo0] = keys[0]!.split('-').map(Number) as [number, number];
    const [y1, mo1] = keys[keys.length - 1]!.split('-').map(Number) as [number, number];
    for (let y = y0, mo = mo0; y < y1 || (y === y1 && mo <= mo1); mo === 12 ? (y++, (mo = 1)) : mo++) labels.push(`${y}-${String(mo).padStart(2, '0')}`);
    return { labels, values: labels.map((l) => (how === 'mean' ? (m.get(l) ? m.get(l)!.s / m.get(l)!.n : 0) : m.get(l)?.s ?? 0)) };
  }
  if (spec.kind === 'hist' && spec.x) {
    const v = t.rows.map((r) => toNumber(r[spec.x!] ?? null)).filter((x): x is number => x != null);
    if (!v.length) return { labels: [], values: [] };
    const lo = Math.min(...v);
    const hi = Math.max(...v);
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
    const e = [...m.entries()].map(([k, a]) => [k, how === 'mean' ? a.s / a.n : a.s] as const).sort((a, b) => b[1] - a[1]).slice(0, 15);
    return { labels: e.map((x) => x[0]), values: e.map((x) => x[1]) };
  }
  return { labels: [], values: [] };
}

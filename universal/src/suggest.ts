import { VALUE_COL } from './grid.js';
import { toDate, toNumber } from './profile.js';
import { compatibleStyles } from './shapes.js';
import { similarGroups } from './similar.js';
import type { LocaleInfo } from './profile.js';
import type { Alert, ChartSpec, ColProfile, Kpi, Row, Table } from './types.js';
import { maxOf, minOf } from './util.js';

export const fmtNum = (n: number) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(n);

/** Sugere gráficos conforme os tipos de coluna; `level` 1 = enxuto … 3 = completo. */
export function suggestCharts(t: Table, prof: ColProfile[], level = 2): ChartSpec[] {
  if (t.noCharts) return [];
  if (t.tidy) return suggestTidy(t, level);
  const out: ChartSpec[] = [];
  const labelOk = (p: ColProfile) => (p.type === 'category' || p.type === 'text' || p.type === 'id') && p.filled === t.rows.length && p.unique === t.rows.length;
  const labelCol = t.rows.length >= 2 && t.rows.length <= 40 ? (prof.find((p) => p.period && labelOk(p)) ?? (t.rows.length >= 3 ? prof.find(labelOk) : undefined)) : undefined;
  const period = !!labelCol?.period;
  const cats = prof.filter((p) => p.type === 'category' && p.unique >= 2 && p.unique < p.filled).sort((a, b) => a.unique - b.unique);
  const nums = prof.filter((p) => (p.type === 'number' || p.type === 'integer') && p.unique > 1);
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
    out.push({ id: id('cat'), kind: 'pivot', style: 'hbar', x: c.name, agg: 'count', title: `Registros por ${c.name}`, description: `Quantos registros há para cada valor de “${c.name}” (até 25 valores mais frequentes).`, score: 85 - i * 5 });
  });
  for (const b of bools.slice(0, 2)) out.push({ id: id('bool'), kind: 'pivot', style: 'donut', x: b.name, agg: 'count', title: `${b.name}`, description: 'Distribuição Sim/Não.', score: 70 });
  if (labelCol) {
    nums.filter((m) => m.filled >= 2).slice(0, level === 1 ? 3 : level === 2 ? 6 : 10).forEach((m, i) => {
      out.push({ id: id('lab'), kind: 'bar', x: labelCol.name, y: m.name, agg: 'sum', keepOrder: true, ...(period ? { period } : {}), title: `${m.name} por ${labelCol.name}`, description: `Valor de “${m.name}” em cada linha de “${labelCol.name}”, na ordem do arquivo. Linha sem valor fica sem barra (não é zero).`, score: 88 - i });
    });
  }
  if (labelCol && period) periodCharts(t, prof, labelCol, nums, level, out, id);
  else if (labelCol) {
    // agrupa colunas de mesma ordem de grandeza para compará-las lado a lado
    const groups = new Map<number, ColProfile[]>();
    for (const m of nums.filter((x) => x.filled >= 2 && (x.max ?? 0) > 0)) {
      const k = Math.floor(Math.log10(m.max!));
      groups.set(k, [...(groups.get(k) ?? []), m]);
    }
    [...groups.values()].filter((g) => g.length >= 2).slice(0, level === 1 ? 1 : 3).forEach((g, i) => {
      const cols = g.slice(0, 4);
      out.push({ id: id('multi'), kind: 'multi', x: labelCol.name, series: cols.map((c) => c.name), keepOrder: true, title: `Comparativo: ${cols.map((c) => c.name).join(' × ')}`, description: `Colunas de ordem de grandeza parecida, lado a lado por “${labelCol.name}”. Linha sem valor fica sem barra (não é zero).`, score: 92 - i });
    });
  }
  if (t.rows.length >= 12) nums.slice(0, level === 1 ? 1 : level === 2 ? 3 : 5).forEach((m, i) => {
    out.push({ id: id('hist'), kind: 'hist', x: m.name, title: `Distribuição de ${m.name}`, description: `Quantos registros caem em cada faixa de “${m.name}”.`, score: 75 - i * 5 });
  });
  const c0 = cats.find((c) => c.unique <= 25);
  if (c0 && nums[0] && level >= 2) out.push({ id: id('catnum'), kind: 'hbar', x: c0.name, y: nums[0].name, agg: 'sum', title: `${nums[0].name} por ${c0.name}`, description: `Soma de “${nums[0].name}” para cada valor de “${c0.name}”.`, score: 80 });
  const c1 = cats.find((c) => c.name !== c0?.name && c.unique <= 8);
  if (c0 && c1 && c0.unique <= 15 && level >= 3) {
    out.push({ id: id('stack'), kind: 'pivot', style: 'stacked', x: c0.name, seriesBy: c1.name, agg: 'count', title: `${c0.name} × ${c1.name}`, description: `Quantos registros há em cada combinação de “${c0.name}” e “${c1.name}”.`, score: 55 });
    if (c0.unique >= 4 && c1.unique >= 3) out.push({ id: id('heat'), kind: 'pivot', style: 'heatmap', lockStyle: true, x: c0.name, seriesBy: c1.name, agg: 'count', title: `Mapa de calor: ${c0.name} × ${c1.name}`, description: `Mesma contagem, em cores: quanto mais escura a célula, mais registros.`, score: 50 });
  }

  if (level >= 2) {
    const pair = bestCorrelation(t, nums.filter((c) => c.unique > 2));
    if (pair) out.push({ id: id('sc'), kind: 'scatter', x: pair.a, y: pair.b, title: `${pair.a} × ${pair.b}`, description: `Cada ponto é um registro. Correlação de Pearson ${pair.r.toFixed(2).replace('.', ',')} (${Math.abs(pair.r) >= 0.7 ? 'forte' : 'moderada'}); correlação não prova causa.`, score: 65 });
  }

  const inMulti = new Set(out.filter((c) => c.kind === 'multi').flatMap((c) => [...(c.series ?? []), ...(c.lineSeries ?? [])]));
  const final = level >= 3 ? out : out.filter((c) => !(c.id.startsWith('lab') && c.y && inMulti.has(c.y)));
  const limit = period ? (level === 1 ? 6 : level === 2 ? 18 : 26) : level === 1 ? 4 : level === 2 ? 9 : 15;
  return final.sort((a, b) => b.score - a.score).slice(0, limit);
}

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) ** 2;
    syy += (ys[i]! - my) ** 2;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
}

/** Par de colunas numéricas com maior |correlação| (≥ 0,5), usando só linhas em que ambas têm valor. */
export function bestCorrelation(t: Table, nums: ColProfile[]): { a: string; b: string; r: number } | null {
  let best: { a: string; b: string; r: number } | null = null;
  const cols = nums.slice(0, 8);
  for (let i = 0; i < cols.length; i++) {
    for (let j = i + 1; j < cols.length; j++) {
      const xs: number[] = [];
      const ys: number[] = [];
      for (const r of t.rows) {
        const a = toNumber(r[cols[i]!.name] ?? null);
        const b = toNumber(r[cols[j]!.name] ?? null);
        if (a != null && b != null) {
          xs.push(a);
          ys.push(b);
        }
      }
      if (xs.length < 8) continue;
      const r = pearson(xs, ys);
      if (Math.abs(r) >= 0.5 && (!best || Math.abs(r) > Math.abs(best.r))) best = { a: cols[i]!.name, b: cols[j]!.name, r };
    }
  }
  return best;
}

/** Alertas de qualidade dos dados (ausentes, colunas constantes, duplicadas, valores extremos). */
export function qualityAlerts(t: Table, prof: ColProfile[], loc?: LocaleInfo): Alert[] {
  if (t.tidy) return tidyAlerts(t);
  const out: Alert[] = [];
  for (const p of prof) {
    if (p.invalidCount) out.push({ level: 'aviso', text: `“${p.name}” é numérica, mas ${p.invalidCount} valor(es) não são número e ficam fora das contas: ${p.invalid!.slice(0, 5).map((b) => `linha ${b.row}: “${b.value}”`).join('; ')}${p.invalidCount > 5 ? '…' : ''}.` });
    if (p.missingMarkers) out.push({ level: 'info', text: `“${p.name}” tem ${p.missingMarkers} marcador(es) de ausência (como n/d ou -); foram tratados como sem dado, não como zero.` });
  }
  for (const g of similarGroups(t, prof)) out.push({ level: 'aviso', text: `Em “${g.col}”, ${g.values.map((v) => `“${v.value}” (${v.count})`).join(', ')} parecem a mesma categoria escrita de formas diferentes; os gráficos os contam separados.`, merge: { col: g.col, values: g.values.map((v) => v.value), to: g.suggested } });
  if (loc?.dateAmbiguous) out.push({ level: 'aviso', text: `${loc.dateAmbiguousCount} data(s) com barra têm dia e mês ≤ 12 (ex.: 03/04/2024), então não dá para saber se é dia/mês ou mês/dia. Estou usando ${loc.dateOrder === 'dmy' ? 'dia/mês/ano' : 'mês/dia/ano'}; confirme na prévia.` });
  if (loc?.numberAmbiguous) out.push({ level: 'aviso', text: `${loc.numberAmbiguousCount} número(s) como “1.234” podem ser milhar (1234) ou decimal (1,234). Estou usando ${loc.numbers === 'br' ? 'o padrão brasileiro (ponto = milhar)' : 'o padrão americano (ponto = decimal)'}; confirme na prévia.` });
  const dup = t.rows.length - new Set(t.rows.map((r) => JSON.stringify(t.columns.map((c) => r[c])))).size;
  if (dup > 0) out.push({ level: 'aviso', text: `${dup} linha(s) idêntica(s) a outra (possíveis duplicatas).` });
  for (const p of prof) {
    if (p.filled === 0) out.push({ level: 'aviso', text: `“${p.name}” está totalmente vazia.` });
    else if (p.missing / t.rows.length >= 0.3) out.push({ level: 'aviso', text: `“${p.name}” tem ${Math.round((p.missing / t.rows.length) * 100)}% de células vazias; os gráficos usam só as preenchidas.` });
    if (p.filled > 1 && p.unique === 1) out.push({ level: 'info', text: `“${p.name}” tem um único valor em todas as linhas; não gera gráfico.` });
    if ((p.type === 'number' || p.type === 'integer') && p.filled >= 8) {
      const v = t.rows.map((r) => toNumber(r[p.name] ?? null)).filter((x): x is number => x != null).sort((a, b) => a - b);
      const q = (f: number) => v[Math.floor((v.length - 1) * f)]!;
      const iqr = q(0.75) - q(0.25);
      const out_ = iqr > 0 ? v.filter((x) => x < q(0.25) - 3 * iqr || x > q(0.75) + 3 * iqr).length : 0;
      if (out_) out.push({ level: 'info', text: `“${p.name}” tem ${out_} valor(es) muito distante(s) dos demais (confira se são erros de digitação).` });
    }
  }
  out.push(...relationAlerts(t, prof));
  for (const n of t.notes ?? []) out.push({ level: 'info', text: n });
  return out;
}

export function kpis(t: Table, prof: ColProfile[]): Kpi[] {
  if (t.tidy) return tidyKpis(t);
  const per = prof.find((p) => p.period && p.filled === t.rows.length && p.unique === t.rows.length);
  if (per && t.rows.length >= 2 && t.rows.length <= 40) return periodKpis(t, prof, per);
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
  datasets?: { label: string; values: number[]; line?: boolean }[];
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
    return { labels, values: labels.map((l) => (how === 'mean' ? (m.get(l) ? m.get(l)!.s / m.get(l)!.n : 0) : m.get(l)?.s ?? 0)) };
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
    let e = [...m.entries()].map(([k, a]) => [k, how === 'mean' ? a.s / a.n : a.s] as const);
    if (!spec.keepOrder) e = e.sort((a, b) => b[1] - a[1]).slice(0, 15);
    return { labels: e.map((x) => x[0]), values: e.map((x) => x[1]) };
  }
  return { labels: [], values: [] };
}

/** valor especial em `where`: aceita linhas em que a coluna está vazia (ex.: indicador sem agravo informado) */
export const NONE = '∅';
const sumBy = (t: Table, col: string) => {
  const m = new Map<string, number>();
  for (const r of t.rows) {
    const k = r[col];
    const v = toNumber(r[VALUE_COL] ?? null);
    if (k == null || v == null) continue;
    m.set(String(k), (m.get(String(k)) ?? 0) + v);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

/** Fatos principais de uma tabela organizada (situação e agravo dominantes). */
export function tidyFacts(t: Table) {
  const td = t.tidy!;
  const situ = td.situation ? sumBy(t, td.situation) : [];
  const mainSit = situ[0]?.[0];
  const rowsMain = mainSit ? t.rows.filter((r) => r[td.situation!] === mainSit) : t.rows;
  const agr = new Map<string, number>();
  if (td.agravo) for (const r of rowsMain) {
    const v = toNumber(r[VALUE_COL] ?? null);
    if (v != null && r[td.agravo] != null) agr.set(String(r[td.agravo]), (agr.get(String(r[td.agravo])) ?? 0) + v);
  }
  const agrList = [...agr.entries()].sort((a, b) => b[1] - a[1]);
  return { mainSit, mainAgr: agrList[0]?.[0], agrList, situ, periods: [...new Set(t.rows.map((r) => String(r[td.period])))], entities: [...new Set(t.rows.map((r) => String(r[td.entity])))] };
}

/** Opções de "positividade" quando há situações do tipo confirmados / descartados / notificados. */
function rateOptions(sitNames: string[]) {
  const find = (re: RegExp) => sitNames.filter((n) => re.test(n.toLowerCase()) && !/crit[eé]rio/.test(n.toLowerCase()));
  const conf = find(/confirmad/);
  const desc = find(/descartad/);
  const notif = find(/notificad/);
  const opts: { label: string; numerator: string[]; denominator: string[]; explain: string }[] = [];
  if (conf.length && desc.length) opts.push({ label: 'Confirmados ÷ concluídos', numerator: conf, denominator: [...conf, ...desc], explain: 'Positividade = confirmados ÷ (confirmados + descartados): entre os casos que já tiveram conclusão, quantos foram confirmados. Casos “em andamento” ficam fora.' });
  if (conf.length && notif.length) opts.push({ label: 'Confirmados ÷ notificados', numerator: conf, denominator: notif, explain: 'Taxa = confirmados ÷ notificados: do total notificado, quantos já estão confirmados. Cai quando há muitos casos ainda em andamento.' });
  return opts;
}

/** Taxa (%) por rótulo do eixo x, usando as mesmas linhas filtradas do gráfico. */
export function rateData(t: Table, spec: ChartSpec, optIdx: number): { labels: string[]; values: number[]; explain: string; name: string } | null {
  const td = t.tidy;
  const opt = spec.rate?.options[optIdx] ?? spec.rate?.options[0];
  if (!td?.situation || !opt || !spec.x) return null;
  const rows = t.rows.filter((r) => !td.agravo || !spec.rate?.agravo || (r[td.agravo] == null ? spec.rate.agravo.includes(NONE) : spec.rate.agravo.includes(String(r[td.agravo]))));
  const labels = pivotData(t, { ...spec, seriesBy: undefined }).labels;
  const sum = (k: string, names: string[]) => rows.reduce((a, r) => (String(r[spec.x!]) === k && names.includes(String(r[td.situation!])) ? a + (toNumber(r[VALUE_COL] ?? null) ?? 0) : a), 0);
  const has = (k: string, names: string[]) => rows.some((r) => String(r[spec.x!]) === k && names.includes(String(r[td.situation!])) && r[VALUE_COL] != null);
  const values = labels.map((k) => (has(k, opt.denominator) && sum(k, opt.denominator) > 0 ? (sum(k, opt.numerator) / sum(k, opt.denominator)) * 100 : Number.NaN));
  return { labels, values, explain: opt.explain, name: `Positividade (${opt.label})` };
}

/** Aplica as regras de escolha de desenho (shapes.ts) aos gráficos "pivot" que não têm desenho fixo. */
function applyEngine(t: Table, specs: ChartSpec[]) {
  for (const sp of specs) {
    if (sp.kind !== 'pivot' || sp.rate || sp.lockStyle) continue;
    const d = pivotData(t, sp);
    const rec = compatibleStyles({ ordered: !!sp.keepOrder, series: d.datasets?.length ?? 0, labels: d.labels.length, positive: [...d.values, ...(d.datasets ?? []).flatMap((x) => x.values)].every((v) => Number.isNaN(v) || v >= 0) }).find((o) => o.recommended);
    if (rec) {
      sp.style = rec.style;
      sp.why = rec.why;
    }
  }
}

function suggestTidy(t: Table, level: number): ChartSpec[] {
  const td = t.tidy!;
  const f = tidyFacts(t);
  const out: ChartSpec[] = [];
  const agrWhere: Record<string, string[]> = td.agravo && f.mainAgr ? { [td.agravo]: [f.mainAgr, NONE] } : {};
  const agrOnly: Record<string, string[]> = td.agravo && f.mainAgr ? { [td.agravo]: [f.mainAgr] } : {};
  const mainWhere: Record<string, string[]> = { ...agrOnly, ...(td.situation && f.mainSit ? { [td.situation]: [f.mainSit] } : {}) };
  const agrTxt = f.mainAgr ? ` de ${f.mainAgr}` : '';
  const sitNames = f.situ.map(([n]) => n);
  const rest = sitNames.filter((n) => n !== f.mainSit);
  const partWhere = (names: string[]) => ({ ...(td.situation ? { [td.situation]: names } : {}) });
  const mp = () => (f.periods.length > 1 ? `Soma dos ${f.entities.length} ${td.entity.toLowerCase()}s` : '');
  void mp;

  if (td.situation && rest.length >= 2) {
    const top = rest.slice(0, 3);
    out.push({
      id: 'tid-evol', kind: 'pivot', style: 'line', x: td.period, seriesBy: td.situation, agg: 'sum', y: td.value, keepOrder: true,
      where: { ...agrWhere, ...partWhere([f.mainSit!, ...top]) },
      title: `Evolução por ${td.period.toLowerCase()}: ${[f.mainSit, ...top].join(', ')}`,
      description: `Para cada ${td.period.toLowerCase()}, soma de todos os ${td.entity.toLowerCase()}s, de cada situação${f.mainAgr ? ` (${f.mainAgr}; indicadores sem agravo informado, como “Em Andamento”, entram como estão no arquivo)` : ''}. “${f.mainSit}” é a maior situação e serve de total de referência.`,
      howTo: 'Cada linha acompanha uma situação ao longo do tempo. Subida = mais casos naquele período; distância entre as linhas mostra quanto do total já foi concluído.', score: 96,
    });
  }
  if (f.mainSit) {
    out.push({
      id: 'tid-rank', kind: 'pivot', style: 'hbar', x: td.entity, agg: 'sum', y: td.value, where: mainWhere,
      title: `${f.mainSit}${agrTxt} por ${td.entity.toLowerCase()} (total do período)`,
      description: `Soma de todos os ${td.period.toLowerCase()}s, do maior para o menor. Valores em branco no arquivo ficam fora da soma (não são zero), então ${td.entity.toLowerCase()}s com meses sem dado aparecem subestimados.`,
      howTo: 'Barras mais longas = mais casos no período. Clique numa barra para filtrar todo o painel só por aquele item.', score: 94,
    });
    out.push({
      id: 'tid-mes-ent', kind: 'pivot', style: 'line', x: td.period, seriesBy: td.entity, agg: 'sum', y: td.value, keepOrder: true, where: mainWhere,
      title: `${f.mainSit}${agrTxt} por ${td.period.toLowerCase()} em cada ${td.entity.toLowerCase()}`,
      description: `Uma linha por ${td.entity.toLowerCase()}, mostrando como o número variou a cada ${td.period.toLowerCase()}. Lacunas na linha são períodos sem dado no arquivo.`,
      howTo: 'Compare a forma das linhas: picos mostram quando cada local teve mais casos. Clique na legenda para esconder/mostrar um item.', score: 90,
    });
  }
  const rateOpts = td.situation ? rateOptions(sitNames) : [];
  if (f.mainSit && rateOpts.length) {
    out.push({
      id: 'tid-pos', kind: 'pivot', style: 'bar', x: td.period, agg: 'sum', y: td.value, keepOrder: true, where: mainWhere,
      rate: { options: rateOpts, agravo: td.agravo && f.mainAgr ? [f.mainAgr, NONE] : undefined },
      title: `${f.mainSit}${agrTxt} por ${td.period.toLowerCase()} e positividade`,
      description: `As colunas comparam o mesmo resultado (${f.mainSit}${agrTxt}) em ${td.period.toLowerCase()}s diferentes. A linha laranja (eixo da direita, em %) é a positividade do mesmo ${td.period.toLowerCase()}. Troque a definição de positividade no seletor do gráfico.`,
      why: 'Dois tipos de informação sobre o mesmo período: quantidade (colunas, eixo da esquerda) e taxa em % (linha, eixo da direita). Juntos mostram se um mês tem muitos casos mas poucos positivos, ou o contrário.',
      howTo: 'Colunas = quantidade (eixo da esquerda). Linha = percentual (eixo da direita). Coluna alta com linha baixa = muitos casos, poucos positivos; coluna baixa com linha alta = poucos casos, mas a maioria positiva. Clique numa coluna para ver só aquele período.', score: 97,
    });
  }
  if (td.situation && rest.length >= 2) {
    out.push({
      id: 'tid-comp', kind: 'pivot', style: 'stacked', x: td.entity, seriesBy: td.situation, agg: 'sum', y: td.value, where: { ...agrWhere, ...partWhere(rest.slice(0, 3)) },
      title: `Situação dos casos por ${td.entity.toLowerCase()}: ${rest.slice(0, 3).join(', ')}`,
      description: `Para cada ${td.entity.toLowerCase()}, quanto foi ${rest.slice(0, 3).join(', ').replace(/, ([^,]*)$/, ' e $1')} no período (soma de todos os ${td.period.toLowerCase()}s).`,
      howTo: 'A barra inteira é o total concluído ou em investigação; as cores mostram a proporção de cada situação. Muita cor de “em andamento” indica fila de casos sem conclusão.', score: 88,
    });
  }
  if (td.agravo && f.agrList.filter(([, v]) => v > 0).length >= 2 && level >= 2) {
    out.push({
      id: 'tid-agr', kind: 'pivot', style: 'stacked', x: td.period, seriesBy: td.agravo, agg: 'sum', y: td.value, keepOrder: true, where: td.situation && f.mainSit ? { [td.situation]: [f.mainSit] } : {},
      rate: rateOpts.length ? { options: rateOpts, agravo: f.mainAgr ? [f.mainAgr, NONE] : undefined } : undefined,
      why: rateOpts.length ? 'Colunas empilhadas dividem cada período entre os agravos, e a linha de positividade mostra a taxa do mesmo período no eixo da direita.' : undefined,
      title: `${f.mainSit ?? 'Total'} por ${td.agravo.toLowerCase()} em cada ${td.period.toLowerCase()}`,
      description: `Soma de todos os ${td.entity.toLowerCase()}s, separada por ${td.agravo.toLowerCase()}. Mostra se um agravo domina e se o perfil muda ao longo do tempo.`,
      howTo: 'Cada barra é um período; as cores dividem o total entre os agravos. Um agravo muito pequeno quase não aparece (veja a tabela).', score: 80,
    });
  }
  if (level >= 3 && td.situation) {
    for (const sname of rest.slice(0, 2)) {
      out.push({
        id: `tid-s-${sname}`, kind: 'pivot', style: 'hbar', x: td.entity, agg: 'sum', y: td.value, where: { ...agrWhere, [td.situation]: [sname] },
        title: `${sname}${agrTxt} por ${td.entity.toLowerCase()}`,
        description: `Soma de todos os ${td.period.toLowerCase()}s da situação “${sname}”.`,
        howTo: 'Barras mais longas = maior número nesta situação.', score: 60,
      });
    }
  }
  // novos tipos de gráfico, escolhidos pelo formato dos dados
  const rec0 = rateOpts[0];
  if (td.situation && rec0 && f.mainSit && level >= 2) {
    const conf = rec0.numerator;
    const concl = rec0.denominator;
    out.push({
      id: 'tid-funil', kind: 'funnel', where: agrWhere, y: td.value, stages: [{ label: f.mainSit, situations: [f.mainSit] }, { label: 'Concluídos', situations: concl }, { label: [...conf].sort((a, b) => a.length - b.length)[0]!, situations: conf }],
      title: `Funil dos casos${agrTxt}: de ${f.mainSit} a ${[...conf].sort((a, b) => a.length - b.length)[0]}`,
      description: `Quantos casos chegam a cada etapa (soma de todos os ${td.period.toLowerCase()}s e ${td.entity.toLowerCase()}s) e que fração da etapa anterior isso representa. “Concluídos” = ${concl.join(' + ')}.`,
      why: 'As situações formam etapas em sequência (notificar, concluir, confirmar): o funil mostra onde os casos “saem” do processo.',
      howTo: 'Cada faixa é uma etapa; quanto mais larga, mais casos. O percentual ao lado do nome é a fração da etapa anterior. A diferença entre notificados e concluídos são os casos ainda em andamento.', score: 86,
    });
    const sizeNames = rest.filter((n) => !conf.includes(n) && !concl.includes(n)).slice(0, 1);
    if (f.entities.length >= 3 && sizeNames.length) out.push({
      id: 'tid-bolhas', kind: 'bubble', rate: { options: rateOpts, agravo: td.agravo && f.mainAgr ? [f.mainAgr, NONE] : undefined }, bubble: { x: [f.mainSit], size: sizeNames, xLabel: `${f.mainSit}${agrTxt}`, sizeLabel: sizeNames[0]! },
      title: `${td.entity}: volume × positividade (tamanho = ${sizeNames[0]})`,
      description: `Cada bolha é um ${td.entity.toLowerCase()}: posição horizontal = ${f.mainSit} no período; vertical = positividade (${rec0.label}); tamanho = ${sizeNames[0]}.`,
      why: `São duas medidas por ${td.entity.toLowerCase()} (volume e taxa) mais uma terceira (tamanho): o gráfico de bolhas é o desenho feito para cruzar três medidas.`,
      howTo: 'Bolhas à direita têm mais casos; bolhas no alto têm maior proporção de confirmados; bolha grande = mais casos ainda em andamento. Clique numa bolha para filtrar o painel.', score: 84,
    });
  }
  if (f.periods.length >= 4 && f.entities.length >= 4 && f.mainSit && level >= 3) out.push({
    id: 'tid-calor', kind: 'pivot', style: 'heatmap', lockStyle: true, x: td.period, seriesBy: td.entity, agg: 'sum', y: td.value, keepOrder: true, where: mainWhere,
    title: `Mapa de calor: ${f.mainSit}${agrTxt} por ${td.entity.toLowerCase()} e ${td.period.toLowerCase()}`,
    description: `Cruza ${td.entity.toLowerCase()} × ${td.period.toLowerCase()}; a cor é proporcional ao valor.`, score: 70,
  });
  applyEngine(t, out);
  return out.sort((a, b) => b.score - a.score).slice(0, level === 1 ? 3 : level === 2 ? 8 : 12);
}

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
  const sum = (pred: (r: Row) => boolean): number => {
    let s = 0;
    let n = 0;
    for (const r of rows) {
      if (!pred(r)) continue;
      const v = counting ? (r[x] == null ? null : 1) : toNumber(r[yCol] ?? null);
      if (v == null) continue;
      s += v;
      n++;
    }
    return n ? s : Number.NaN;
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

const br = (n: number) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(n);

/** Frase de destaque calculada a partir dos próprios dados do gráfico. */
export function insightFor(spec: ChartSpec, d: SeriesData): string {
  if (spec.kind === 'change' && d.values.length) {
    const hi = d.values[0]!;
    const lo = d.values[d.values.length - 1]!;
    return `Maior aumento: ${d.labels[0]} (${hi >= 0 ? '+' : ''}${br(hi)}%); maior queda: ${d.labels[d.labels.length - 1]} (${br(lo)}%).`;
  }
  if (spec.kind === 'profile' && d.datasets) return `Cada eixo é um indicador; 100% é o maior valor daquele indicador entre os períodos. Quem chega mais perto da borda teve o melhor (maior) resultado naquele indicador.`;
  if (spec.kind === 'part' && spec.part?.all && d.datasets) {
    const [a, r] = d.datasets;
    const share = d.labels.map((l, i) => ({ l, s: a!.values[i]! + r!.values[i]! > 0 ? (a!.values[i]! / (a!.values[i]! + r!.values[i]!)) * 100 : Number.NaN })).filter((x) => !Number.isNaN(x.s));
    return share.length ? `Parte de “${a!.label}” no total: ${share.map((x) => `${x.l} ${br(x.s)}%`).join(', ')}.` : 'Sem dados.';
  }
  if (spec.kind === 'part' && spec.part && d.values.length === 2) {
    const tot = d.values[0]! + d.values[1]!;
    return `${br(d.values[0]!)} de ${br(tot)} (${br(tot ? (d.values[0]! / tot) * 100 : 0)}%) são “${spec.part.part}”; o restante (${br(d.values[1]!)}) não.`;
  }
  const valid = (a: number[]) => a.map((v, i) => [v, i] as const).filter(([v]) => !Number.isNaN(v));
  const nanCount = d.datasets ? d.datasets.reduce((a, s) => a + s.values.filter((v) => Number.isNaN(v)).length, 0) : d.values.filter((v) => Number.isNaN(v)).length;
  const gap = nanCount ? ` Há ${nanCount} ponto(s) sem dado, que não foram tratados como zero.` : '';
  if (d.datasets && spec.period && d.labels.length >= 2) {
    const ch = d.datasets.map((s) => {
      const pts = valid(s.values);
      const f = pts[0];
      const l = pts[pts.length - 1];
      return f && l && f[1] !== l[1] ? { l: s.label, f: f[0], v: l[0], pct: f[0] ? ((l[0] - f[0]) / Math.abs(f[0])) * 100 : Number.NaN } : null;
    }).filter((x): x is NonNullable<typeof x> => x != null);
    const a = d.labels[0]!;
    const z = d.labels[d.labels.length - 1]!;
    if (ch.length) return `De ${a} a ${z}: ${ch.map((c) => `${c.l} ${br(c.f)} → ${br(c.v)}${Number.isNaN(c.pct) ? '' : ` (${c.pct >= 0 ? '+' : ''}${br(c.pct)}%)`}`).join('; ')}.${gap}`;
  }
  if (d.datasets) {
    const tot = d.datasets.map((s) => ({ l: s.label, v: s.values.filter((x) => !Number.isNaN(x)).reduce((a, b) => a + b, 0), peak: valid(s.values).sort((a, b) => b[0] - a[0])[0] }));
    tot.sort((a, b) => b.v - a.v);
    const all = tot.reduce((a, b) => a + b.v, 0) || 1;
    const lead = tot[0]!;
    const pk = lead.peak ? ` Maior valor: ${br(lead.peak[0])} em ${d.labels[lead.peak[1]]}.` : '';
    return `Maior total: ${lead.l} (${br(lead.v)}, ${br((lead.v / all) * 100)}% da soma das séries).${pk}${gap}`;
  }
  const v = valid(d.values);
  if (!v.length) return 'Sem valores para este gráfico.';
  const sorted = [...v].sort((a, b) => b[0] - a[0]);
  const total = v.reduce((a, [x]) => a + x, 0);
  const top = sorted[0]!;
  const low = sorted[sorted.length - 1]!;
  if (spec.kind === 'line' || (spec.keepOrder && spec.kind !== 'donut')) {
    const first = v[0]!;
    const last = v[v.length - 1]!;
    const delta = first[0] ? ` De ${d.labels[first[1]]} a ${d.labels[last[1]]}: ${last[0] >= first[0] ? '+' : ''}${br(((last[0] - first[0]) / first[0]) * 100)}%.` : '';
    return `Pico: ${br(top[0])} em ${d.labels[top[1]]}; mínimo: ${br(low[0])} em ${d.labels[low[1]]}.${delta}${gap}`;
  }
  return `Maior: ${d.labels[top[1]]} (${br(top[0])}, ${br((top[0] / (total || 1)) * 100)}% do total ${br(total)}); menor: ${d.labels[low[1]]} (${br(low[0])}).${gap}`;
}

export const HOWTO_SHAPE: Record<string, string> = {
  line: 'A linha liga os períodos em ordem; subida = aumento, descida = queda. Compare a forma das linhas.',
  bar: 'Cada coluna é um valor; quanto mais alta, maior o número.',
  hbar: 'Cada barra é um item, do maior para o menor; quanto mais longa, maior o número.',
  stacked: 'Cada coluna é um total dividido em cores; o tamanho de cada cor é a parte daquela série.',
  area: 'Área preenchida sob a linha; quando empilhada, a espessura de cada faixa é a parte daquela série.',
  percent: 'Todas as colunas têm a mesma altura (100%); cada cor mostra a proporção da série, não o volume.',
  heatmap: 'Cada célula é um valor; quanto mais escura, maior. Células listradas = sem dado (não é zero). Clique num título para filtrar.',
  radar: 'Cada eixo é um item; cada polígono é uma série. Quanto mais longe do centro, maior o valor.',
  small: 'Um gráfico pequeno por série, todos na mesma escala vertical: compare a forma e a altura entre eles.',
  pareto: 'Barras do maior para o menor e linha de % acumulado: mostra quantos itens somam a maior parte do total.',
  donut: 'Cada fatia é a parte do total; fatias maiores = mais registros.',
};

export const HOW_TO: Record<string, string> = {
  part: 'A rosca mostra um todo dividido em duas partes: a fatia colorida é a parte destacada e a outra é o que sobra do total. Troque o período no seletor.',
  bar: 'Cada barra é um valor; quanto mais alta, maior o número.',
  hbar: 'Cada barra é um item, do maior para o menor; quanto mais longa, maior o número.',
  donut: 'Cada fatia é a parte do total; fatias maiores = mais registros.',
  line: 'A linha liga os períodos em ordem; subida = aumento, descida = queda.',
  hist: 'Cada barra é uma faixa de valores; a altura é quantos registros caem nela.',
  stacked: 'Cada barra é dividida em cores; o tamanho de cada cor é a parte daquela categoria.',
  scatter: 'Cada ponto é um registro; pontos subindo da esquerda para a direita indicam que as duas colunas crescem juntas.',
  multi: 'Barras lado a lado comparam as colunas em cada linha do arquivo.',
  profile: 'Cada eixo é um indicador, normalizado pelo maior valor dele entre os períodos (100%). Cada período é um polígono: quanto maior a área, maiores os indicadores.',
  change: 'Cada barra é a variação percentual do primeiro ao último período; para a direita = aumento, para a esquerda = queda.',
  map: 'Cada ponto é um registro com coordenadas; aproxime para ver detalhes.',
  pivot: 'Veja a descrição acima.',
};

/** Alertas e KPIs específicos de tabelas organizadas. */
export function tidyKpis(t: Table): Kpi[] {
  const td = t.tidy!;
  const f = tidyFacts(t);
  const out: Kpi[] = [];
  const mainRows = t.rows.filter((r) => (!f.mainSit || r[td.situation!] === f.mainSit) && (!f.mainAgr || r[td.agravo!] === f.mainAgr));
  const total = mainRows.reduce((a, r) => a + (toNumber(r[VALUE_COL] ?? null) ?? 0), 0);
  out.push({ label: `${f.mainSit ?? 'Total'}${f.mainAgr ? ' ' + f.mainAgr : ''}`, value: fmtNum(total), hint: `soma de todos os ${td.entity.toLowerCase()}s e ${td.period.toLowerCase()}s` });
  const by = (col: string, rows: Row[]) => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const v = toNumber(r[VALUE_COL] ?? null);
      if (v != null) m.set(String(r[col]), (m.get(String(r[col])) ?? 0) + v);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const ent = by(td.entity, mainRows);
  if (ent[0]) out.push({ label: `Maior ${td.entity.toLowerCase()}`, value: ent[0][0], hint: `${fmtNum(ent[0][1])} no período` });
  const per = by(td.period, mainRows);
  if (per[0]) out.push({ label: `Pico (${td.period.toLowerCase()})`, value: per[0][0], hint: `${fmtNum(per[0][1])}` });
  if (td.situation && f.mainSit) {
    const scoped = t.rows.filter((r) => !td.agravo || r[td.agravo] == null || r[td.agravo] === f.mainAgr);
    const sums = by(td.situation, scoped).filter(([n]) => n !== f.mainSit);
    const base = by(td.situation, scoped).find(([n]) => n === f.mainSit)?.[1] || 1;
    for (const [n, v] of sums.slice(0, 3)) out.push({ label: n, value: fmtNum(v), hint: `${((v / base) * 100).toFixed(1).replace('.', ',')}% de ${f.mainSit}${f.mainAgr ? ' ' + f.mainAgr : ''}` });
  }
  out.push({ label: 'Períodos × itens', value: `${f.periods.length} × ${f.entities.length}`, hint: f.periods.join(', ') });
  return out;
}

export function tidyAlerts(t: Table): Alert[] {
  const td = t.tidy!;
  const out: Alert[] = [];
  const key = (r: Row) => `${r[td.entity]}\u0001${r[td.period]}`;
  const tot = new Map<string, { n: number; nulls: number }>();
  for (const r of t.rows) {
    const e = tot.get(key(r)) ?? { n: 0, nulls: 0 };
    e.n++;
    if (r[VALUE_COL] == null) e.nulls++;
    tot.set(key(r), e);
  }
  const full = new Map<string, string[]>();
  for (const [k, v] of tot) if (v.nulls === v.n) {
    const [ent, per] = k.split('\u0001') as [string, string];
    full.set(ent, [...(full.get(ent) ?? []), per]);
  }
  for (const [ent, pers] of full) out.push({ level: 'aviso', text: `${ent}: sem nenhum dado em ${pers.join(', ')}. Não é zero: os totais e comparações desse item estão subestimados nesses períodos.` });
  // valores em branco isolados
  const isolated = [...tot.entries()].filter(([, v]) => v.nulls > 0 && v.nulls < v.n);
  if (isolated.length) out.push({ level: 'info', text: `${isolated.length} combinação(ões) ${td.entity.toLowerCase()}/${td.period.toLowerCase()} têm só alguns indicadores em branco (ex.: ${isolated[0]![0].replace('\u0001', ' em ')}).` });
  // grafias parecidas
  if (td.agravo) {
    const names = [...new Set(t.rows.map((r) => r[td.agravo!]).filter((v): v is string => typeof v === 'string'))];
    for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
      const a = names[i]!.toLowerCase();
      const b = names[j]!.toLowerCase();
      if (a.length === b.length && a.length > 3 && [...a].filter((c, k) => c !== b[k]).length === 1) out.push({ level: 'aviso', text: `“${names[i]}” e “${names[j]}” parecem o mesmo agravo escrito de duas formas; os gráficos os tratam como diferentes.` });
    }
  }
  if (td.agravo) {
    const ag = [...new Set(t.rows.map((r) => r[td.agravo!]).filter((v): v is string => typeof v === 'string'))];
    const labels = [...new Set(t.rows.map((r) => String(r['Indicador'])))];
    for (const l of labels) {
      const w = l.split(/\s+/);
      const last = w[w.length - 1]!.toLowerCase();
      if (w.length < 2 || ag.some((a) => a.toLowerCase() === last)) continue;
      const near = ag.find((a) => a.length === last.length && [...a.toLowerCase()].filter((c, k) => c !== last[k]).length === 1);
      if (near) out.push({ level: 'aviso', text: `“${l}” parece usar outra grafia de “${near}” (${w.slice(0, -1).join(' ')} ${near}); por isso não foi agrupado com os demais indicadores de ${near}. Vale corrigir no arquivo.` });
    }
  }
  for (const n of t.notes ?? []) out.push({ level: 'info', text: n });
  return out;
}

export function rateInsight(r: { labels: string[]; values: number[]; name: string }): string {
  const v = r.values.map((x, i) => [x, i] as const).filter(([x]) => !Number.isNaN(x));
  if (!v.length) return '';
  const s = [...v].sort((a, b) => b[0] - a[0]);
  const f = (n: number) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(n);
  return `${r.name}: maior em ${r.labels[s[0]![1]]} (${f(s[0]![0])}%), menor em ${r.labels[s[s.length - 1]![1]]} (${f(s[s.length - 1]![0])}%).`;
}


/** Indicadores de um quadro por período: primeiro e último período dos indicadores que mais mudaram. */
function periodKpis(t: Table, prof: ColProfile[], per: ColProfile): Kpi[] {
  const first = t.rows[0]!;
  const last = t.rows[t.rows.length - 1]!;
  const a = String(first[per.name]);
  const z = String(last[per.name]);
  const out: Kpi[] = [{ label: 'Períodos', value: fmtNum(t.rows.length), hint: `${a} a ${z}` }];
  const cand = prof
    .filter((c) => (c.type === 'number' || c.type === 'integer') && c.unique > 1)
    .map((c) => ({ c, f: toNumber(first[c.name] ?? null), l: toNumber(last[c.name] ?? null) }))
    .filter((x): x is { c: ColProfile; f: number; l: number } => x.f != null && x.l != null && x.f !== 0)
    .map((x) => ({ ...x, pct: ((x.l - x.f) / Math.abs(x.f)) * 100 }))
    .sort((p, q) => Math.abs(q.pct) - Math.abs(p.pct))
    .slice(0, 4);
  for (const x of cand) out.push({ label: `${x.c.name} (${z})`, value: `${fmtNum(x.l)}${x.c.percent ? '%' : ''}`, hint: `${fmtNum(x.f)}${x.c.percent ? '%' : ''} em ${a} → ${fmtNum(x.l)}${x.c.percent ? '%' : ''} em ${z}: ${x.pct >= 0 ? '+' : ''}${fmtNum(x.pct)}%` });
  return out;
}


/** Relação encontrada: P = A ÷ B × 100 (A ≤ B) em todas (ou na maioria) das linhas. */
export interface Relation {
  p: string;
  a: string;
  b: string;
  n: number;
  bad: number[];
}

/**
 * Procura taxas e índices que saem de duas outras colunas (P = A ÷ B × 100). A mesma relação aparece em várias formas
 * (A = B÷C×100, C = B÷A×100…); fica a forma em que o resultado é a taxa (nome com índice/taxa/cobertura ou terminado em %).
 */
export function findRelations(t: Table, prof: ColProfile[]): Relation[] {
  const nums = prof.filter((p) => (p.type === 'number' || p.type === 'integer') && p.unique > 1).slice(0, 14);
  if (nums.length < 3 || t.rows.length < 3 || t.rows.length > 5000) return [];
  const vals = new Map(nums.map((c) => [c.name, t.rows.map((r) => toNumber(r[c.name] ?? null))]));
  const found: { key: string; rate: boolean; rel: Relation }[] = [];
  for (const P of nums) {
    const pv = vals.get(P.name)!;
    let best: Relation | null = null;
    for (const A of nums) {
      for (const B of nums) {
        if (A.name === B.name || A.name === P.name || B.name === P.name) continue;
        const av = vals.get(A.name)!;
        const bv = vals.get(B.name)!;
        let n = 0;
        const bad: number[] = [];
        for (let i = 0; i < pv.length; i++) {
          const a = av[i];
          const b = bv[i];
          const pp = pv[i];
          if (a == null || b == null || pp == null || b === 0) continue;
          n++;
          if (a > b || Math.abs((a / b) * 100 - pp) > Math.max(0.1, Math.abs(pp) * 0.005)) bad.push(i + 1);
        }
        if (n >= 3 && bad.length <= Math.floor(n / 3) && (!best || bad.length < best.bad.length)) best = { p: P.name, a: A.name, b: B.name, n, bad };
      }
    }
    if (best) found.push({ key: [P.name, best.a, best.b].sort().join('|'), rate: /índice|indice|taxa|cobertura|propor[cç][ãa]o|percentual|%/i.test(P.name) || !!P.percent, rel: best });
  }
  const byKey = new Map<string, (typeof found)[number]>();
  for (const f of found) {
    const cur = byKey.get(f.key);
    if (!cur || (f.rate && !cur.rate)) byKey.set(f.key, f);
  }
  return [...byKey.values()].map((f) => f.rel);
}

/** Avisa quando uma taxa confere (ou não) com as colunas de que sai. */
export function relationAlerts(t: Table, prof: ColProfile[]): Alert[] {
  return findRelations(t, prof).slice(0, 6).map((r) => {
    const calc = `“${r.a}” ÷ “${r.b}” × 100`;
    return { level: r.bad.length ? 'aviso' : 'info', text: r.bad.length ? `“${r.p}” bate com ${calc} em ${r.n - r.bad.length} de ${r.n} linhas; confira a(s) linha(s) ${r.bad.join(', ')}, que não bate(m).` : `“${r.p}” confere com ${calc} em todas as ${r.n} linhas (diferença dentro de arredondamento).` } as Alert;
  });
}


/**
 * Quadro com um período por linha (ex.: anos): colunas agrupadas por padrão, com linha de percentual por cima quando
 * há uma taxa que sai das colunas; roscas e colunas empilhadas para “parte do todo”; barras de variação; radar do perfil.
 */
function periodCharts(t: Table, prof: ColProfile[], label: ColProfile, nums: ColProfile[], level: number, out: ChartSpec[], id: (k: string) => string) {
  const x = label.name;
  const usable = nums.filter((c) => c.filled >= 2 && (c.max ?? 0) > 0);
  const rels = findRelations(t, prof).filter((r) => r.bad.length === 0);
  const nCombo = level === 1 ? 2 : level === 2 ? 4 : 6;
  const used = new Set<string>();
  rels.slice(0, nCombo).forEach((r, i) => {
    used.add(r.p);
    used.add(r.a);
    used.add(r.b);
    out.push({
      id: id('combo'), kind: 'multi', x, series: [r.b, r.a], lineSeries: [r.p], keepOrder: true, period: true,
      title: `${r.b} e ${r.a}, com ${r.p} (linha)`,
      description: `Colunas: valores de cada “${x}”. Linha (eixo da direita, %): “${r.p}”, que é “${r.a}” ÷ “${r.b}” × 100.`,
      score: 95 - i,
    });
  });
  rels.slice(0, level === 1 ? 1 : 3).forEach((r, i) => {
    out.push({ id: id('partall'), kind: 'part', x, part: { whole: r.b, part: r.a, all: true }, keepOrder: true, period: true, style: 'stacked', lockStyle: true, title: `${r.a} dentro de ${r.b}, por ${x}`, description: `Cada coluna é o total de “${r.b}” dividido entre “${r.a}” e o restante.`, score: 89 - i });
    if (level >= 2) out.push({ id: id('part'), kind: 'part', x, part: { whole: r.b, part: r.a }, title: `${r.a} em relação a ${r.b}`, description: `Rosca de um ${x} (escolha no seletor): a fatia colorida é “${r.a}”; a outra é o restante de “${r.b}”.`, score: 81 - i });
  });
  const rest = usable.filter((c) => !used.has(c.name));
  const groups = new Map<string, ColProfile[]>();
  for (const m of rest) {
    const k = m.percent ? 'pct' : String(Math.floor(Math.log10(m.max!)));
    groups.set(k, [...(groups.get(k) ?? []), m]);
  }
  const chunks = [...groups.entries()].flatMap(([k, g]) => g.reduce<ColProfile[][]>((acc, c, i) => (i % 4 ? acc[acc.length - 1]!.push(c) : acc.push([c]), acc), []).map((cols) => ({ k, cols })));
  chunks.slice(0, level === 1 ? 1 : level === 2 ? 6 : 10).forEach(({ k, cols }, i) => {
    out.push({
      id: id('multi'), kind: 'multi', x, series: cols.map((c) => c.name), keepOrder: true, period: true,
      title: `${cols.map((c) => c.name).join(' × ')}${k === 'pct' ? ' (%)' : ''}`,
      description: `Colunas por “${x}”${k === 'pct' ? ', todas em percentual' : ', de ordem de grandeza parecida para dividir o mesmo eixo'}. Ponto sem valor fica sem coluna (não é zero).`,
      score: 91 - i,
    });
  });
  const varying = usable.filter((c) => c.unique > 1);
  if (level >= 2 && varying.length >= 3 && t.rows.length >= 2) out.push({ id: id('change'), kind: 'change', x, indicators: varying.map((c) => c.name), title: `O que mais mudou do primeiro ao último ${x} (%)`, description: 'Variação percentual de cada indicador entre o primeiro e o último período.', score: 90 });
  const radarCols = varying.filter((c) => !c.percent).slice(0, 8);
  if (level >= 2 && radarCols.length >= 3 && t.rows.length >= 2 && t.rows.length <= 6) out.push({ id: id('profile'), kind: 'profile', x, indicators: radarCols.map((c) => c.name), title: `Perfil dos indicadores por ${x}`, description: 'Radar: cada eixo é um indicador, em % do maior valor dele entre os períodos.', score: 83 });
}

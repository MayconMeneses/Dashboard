import { evalRow } from './formula.js';
import { compileFormula } from './formula.js';
import { profileTable } from './profile.js';
import type { ColType, Row, Table } from './types.js';

export interface Metric {
  id: string;
  name: string;
  unit?: string;
  formula: string;
}

/** Tudo o que o usuário configurou e que pode ser salvo num projeto (sem os dados). */
export interface ProjectState {
  level?: string;
  tableIndex?: number;
  forced?: Record<string, ColType>;
  filters?: Record<string, string>;
  removed?: string[];
  styleChoice?: Record<string, string>;
  rateChoice?: Record<string, number>;
  merges?: Record<string, Record<string, string>>;
  locale?: { dateOrder: 'dmy' | 'mdy'; numbers: 'br' | 'us' };
  dateRange?: { col?: string; from?: string; to?: string };
  basemap?: 'esri' | 'none';
  pageSize?: number;
  renames?: Record<string, string>;
  units?: Record<string, string>;
  metrics?: Metric[];
}

/** Renomeia colunas (inclusive no mapeamento de tabelas organizadas e de coordenadas). */
export function applyRenames(t: Table, renames: Record<string, string>): Table {
  const map = Object.fromEntries(Object.entries(renames).filter(([a, b]) => b && b !== a && t.columns.includes(a)));
  if (!Object.keys(map).length) return t;
  const nm = (c: string) => map[c] ?? c;
  const columns = t.columns.map(nm);
  const rows: Row[] = t.rows.map((r) => {
    const o: Row = {};
    for (const c of t.columns) o[nm(c)] = r[c] ?? null;
    return o;
  });
  return {
    ...t,
    columns,
    rows,
    ...(t.geo ? { geo: { lat: nm(t.geo.lat), lon: nm(t.geo.lon) } } : {}),
    ...(t.tidy ? { tidy: { ...t.tidy, period: nm(t.tidy.period), entity: nm(t.tidy.entity), label: nm(t.tidy.label), value: nm(t.tidy.value), ...(t.tidy.situation ? { situation: nm(t.tidy.situation) } : {}), ...(t.tidy.agravo ? { agravo: nm(t.tidy.agravo) } : {}) } } : {}),
  };
}

/** Acrescenta as métricas "por linha" como colunas novas (as agregadas viram indicadores e não entram aqui). */
export function addMetricColumns(t: Table, metrics: Metric[]): Table {
  const cols = [...t.columns];
  let rows = t.rows;
  for (const m of metrics) {
    let c;
    try {
      c = compileFormula(m.formula, cols);
    } catch {
      continue;
    }
    if (c.aggregate) continue;
    const name = cols.includes(m.name) ? `${m.name} (métrica)` : m.name;
    cols.push(name);
    rows = rows.map((r) => ({ ...r, [name]: evalRow(c, r) }));
  }
  return cols.length === t.columns.length ? t : { ...t, columns: cols, rows };
}

/** Passa uma configuração de uma coluna para outra (usado ao renomear), mantendo filtros, tipos, junções etc. */
export function migrateColumn(s: ProjectState, from: string, to: string): ProjectState {
  const mv = <V>(o: Record<string, V> | undefined) => {
    if (!o || !(from in o)) return o;
    const { [from]: v, ...rest } = o;
    return { ...rest, [to]: v as V };
  };
  const out: ProjectState = { ...s, forced: mv(s.forced), filters: mv(s.filters), merges: mv(s.merges), units: mv(s.units) };
  if (s.dateRange?.col === from) out.dateRange = { ...s.dateRange, col: to };
  out.metrics = s.metrics?.map((m) => ({ ...m, formula: m.formula.split(`[${from}]`).join(`[${to}]`) }));
  return out;
}

/** Reaplica uma configuração a outra tabela: o que referencia colunas inexistentes é descartado e listado. */
export function reconcileState(s: ProjectState, columns: string[]): { state: ProjectState; dropped: string[] } {
  const dropped: string[] = [];
  const has = (c: string) => columns.includes(c);
  const keep = <V>(o: Record<string, V> | undefined, what: string) => {
    if (!o) return o;
    const out: Record<string, V> = {};
    for (const [k, v] of Object.entries(o)) (has(k) ? (out[k] = v) : dropped.push(`${what} da coluna “${k}”`));
    return out;
  };
  const state: ProjectState = { ...s, forced: keep(s.forced, 'tipo'), filters: keep(s.filters, 'filtro'), merges: keep(s.merges, 'junção de grafias') };
  if (s.dateRange?.col && !has(s.dateRange.col)) {
    dropped.push(`período da coluna “${s.dateRange.col}”`);
    state.dateRange = {};
  }
  const all = new Set(columns);
  state.metrics = s.metrics?.filter((m) => {
    try {
      const c = compileFormula(m.formula);
      const miss = c.columns.filter((x) => !all.has(x) && !(s.metrics ?? []).some((o) => o.name === x));
      if (miss.length) dropped.push(`métrica “${m.name}” (falta ${miss.map((x) => `[${x}]`).join(', ')})`);
      return !miss.length;
    } catch {
      dropped.push(`métrica “${m.name}” (fórmula inválida)`);
      return false;
    }
  });
  return { state, dropped };
}

export interface TableDiff {
  rows: { before: number; after: number };
  columnsAdded: string[];
  columnsRemoved: string[];
  sums: { col: string; before: number; after: number }[];
  newValues: { col: string; values: string[] }[];
  goneValues: { col: string; values: string[] }[];
}

/** Compara duas versões do mesmo arquivo: linhas, colunas, somas das numéricas e categorias que apareceram ou sumiram. */
export function compareTables(a: Table, b: Table): TableDiff {
  const common = a.columns.filter((c) => b.columns.includes(c));
  const pa = profileTable(a);
  const pb = profileTable(b);
  const typeOf = (c: string) => pb.find((p) => p.name === c)?.type;
  const sum = (t: Table, c: string) => t.rows.reduce((s, r) => s + (typeof r[c] === 'number' ? (r[c] as number) : Number(String(r[c] ?? '').replace(/\./g, '').replace(',', '.')) || 0), 0);
  const sums = common
    .filter((c) => ['number', 'integer'].includes(typeOf(c) ?? '') && ['number', 'integer'].includes(pa.find((p) => p.name === c)?.type ?? ''))
    .map((c) => ({ col: c, before: sum(a, c), after: sum(b, c) }))
    .filter((x) => x.before !== x.after)
    .sort((x, y) => Math.abs(y.after - y.before) - Math.abs(x.after - x.before))
    .slice(0, 6);
  const cats = common.filter((c) => typeOf(c) === 'category');
  const vals = (t: Table, c: string) => new Set(t.rows.map((r) => r[c]).filter((v): v is string => typeof v === 'string'));
  const newValues: TableDiff['newValues'] = [];
  const goneValues: TableDiff['goneValues'] = [];
  for (const c of cats.slice(0, 6)) {
    const va = vals(a, c);
    const vb = vals(b, c);
    const n = [...vb].filter((v) => !va.has(v)).slice(0, 5);
    const g = [...va].filter((v) => !vb.has(v)).slice(0, 5);
    if (n.length) newValues.push({ col: c, values: n });
    if (g.length) goneValues.push({ col: c, values: g });
  }
  return { rows: { before: a.rows.length, after: b.rows.length }, columnsAdded: b.columns.filter((c) => !a.columns.includes(c)), columnsRemoved: a.columns.filter((c) => !b.columns.includes(c)), sums, newValues, goneValues };
}

export const PROJECT_KIND = 'dashboard-universal-projeto';

export interface ProjectFile {
  tipo: typeof PROJECT_KIND;
  versao: number;
  salvoEm: string;
  painel: string;
  origem: { arquivo: string; sha256?: string; formato?: string; tabela?: string };
  leitura: { encoding?: string; delimiter?: string };
  estado: ProjectState;
}

export function serializeProject(p: Omit<ProjectFile, 'tipo' | 'versao'>): string {
  return JSON.stringify({ tipo: PROJECT_KIND, versao: 1, ...p }, null, 2);
}

/** Lê e valida um arquivo de projeto. Lança erro em português se não for um projeto válido. */
export function parseProject(text: string): ProjectFile {
  let j: Partial<ProjectFile>;
  try {
    j = JSON.parse(text) as Partial<ProjectFile>;
  } catch {
    throw new Error('Este arquivo não é um projeto do Dashboard Universal (JSON inválido).');
  }
  if (j.tipo !== PROJECT_KIND) throw new Error('Este arquivo não é um projeto do Dashboard Universal.');
  if (typeof j.versao !== 'number' || j.versao > 1) throw new Error('Este projeto foi salvo por uma versão mais nova do painel; atualize o painel para abri-lo.');
  if (!j.estado || typeof j.estado !== 'object') throw new Error('O projeto está sem as configurações (campo “estado”).');
  return { tipo: PROJECT_KIND, versao: 1, salvoEm: String(j.salvoEm ?? ''), painel: String(j.painel ?? ''), origem: { arquivo: String(j.origem?.arquivo ?? ''), ...(j.origem?.sha256 ? { sha256: String(j.origem.sha256) } : {}), ...(j.origem?.formato ? { formato: String(j.origem.formato) } : {}), ...(j.origem?.tabela ? { tabela: String(j.origem.tabela) } : {}) }, leitura: { ...(j.leitura?.encoding ? { encoding: String(j.leitura.encoding) } : {}), ...(j.leitura?.delimiter ? { delimiter: String(j.leitura.delimiter) } : {}) }, estado: j.estado as ProjectState };
}

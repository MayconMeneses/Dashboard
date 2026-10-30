import { profileTable } from '../profile.js';
import type { Dataset, JoinSpec, ParseInfo, Row, Table } from '../types.js';
import { countPointsIn } from './spatial.js';

export type { JoinSpec } from '../types.js';

export type Cardinality = '1:1' | 'N:1' | '1:N' | 'N:N';

export interface JoinAnalysis {
  cardinality: Cardinality;
  leftRows: number;
  rightRows: number;
  /** linhas da esquerda que encontraram par */
  matched: number;
  unmatchedLeft: number;
  /** linhas da direita cuja chave não existe na esquerda */
  unmatchedRight: number;
  nullLeft: number;
  nullRight: number;
  /** linhas do resultado se a junção for confirmada */
  resultRows: number;
  examplesLeft: string[];
  examplesRight: string[];
  /** chaves repetidas (até 5 de cada lado) */
  dupLeft: { key: string; count: number }[];
  dupRight: { key: string; count: number }[];
  /** riscos que o usuário precisa ler antes de confirmar */
  warnings: string[];
  /** sugestões; nada é corrigido sozinho */
  hints: string[];
  /** motivos para não permitir a junção */
  blockers: string[];
}

/** Nome pelo qual uma tabela é escolhida e guardada nas relações. */
export const tableId = (t: Table): string => t.title ?? t.name;

/** Chave comparada como texto sem espaços nas pontas (zeros à esquerda importam: CEP e código IBGE); vazio nunca casa. */
export function normKey(v: unknown): string | null {
  if (v == null) return null;
  const s = v instanceof Date ? v.toISOString() : String(v).trim();
  return s === '' ? null : s;
}

const EMPTY: Omit<JoinAnalysis, 'blockers'> = { cardinality: '1:1', leftRows: 0, rightRows: 0, matched: 0, unmatchedLeft: 0, unmatchedRight: 0, nullLeft: 0, nullRight: 0, resultRows: 0, examplesLeft: [], examplesRight: [], dupLeft: [], dupRight: [], warnings: [], hints: [] };

const count = (rows: Row[], col: string): Map<string, number> => {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = normKey(r[col]);
    if (k != null) m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
};
const dups = (m: Map<string, number>) => [...m].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([key, count]) => ({ key, count }));
const numericCols = (t: Table, skip: string): string[] => profileTable(t).filter((p) => (p.type === 'number' || p.type === 'integer') && p.name !== skip).map((p) => p.name);
const noZeros = (k: string) => k.replace(/^0+(?=.)/, '');

function structural(t: Table, label: string): string[] {
  const out: string[] = [];
  if (t.tidy) out.push(`A tabela “${tableId(t)}” é do tipo organizada (blocos por período) e não pode ser relacionada.`);
  if (t.noCharts) out.push(`A tabela “${tableId(t)}” é só de texto e não pode ser relacionada.`);
  void label;
  return out;
}

/** Examina a relação antes de ela existir: cardinalidade, quem não encontrou par, chaves repetidas e o risco de somar valores repetidos. */
export function analyzeJoin(left: Table, right: Table, spec: JoinSpec): JoinAnalysis {
  const a: JoinAnalysis = { ...EMPTY, leftRows: left.rows.length, rightRows: right.rows.length, blockers: [...structural(left, 'esquerda'), ...structural(right, 'direita')] };
  if (spec.kind === 'pontos') {
    if (!Object.values(left.shapes ?? {}).some((g) => g.type === 'Polygon' || g.type === 'MultiPolygon' || g.type === 'GeometryCollection')) a.blockers.push(`A tabela “${tableId(left)}” não tem polígonos para receber a contagem.`);
    if (!right.geo?.lat || !right.geo.lon) a.blockers.push(`A tabela “${tableId(right)}” não tem coordenadas (latitude e longitude).`);
    a.resultRows = left.rows.length;
    return a;
  }
  if (!left.columns.includes(spec.leftKey)) a.blockers.push(`A coluna “${spec.leftKey}” não existe na tabela “${tableId(left)}”.`);
  if (!right.columns.includes(spec.rightKey)) a.blockers.push(`A coluna “${spec.rightKey}” não existe na tabela “${tableId(right)}”.`);
  if (a.blockers.length) return a;

  const lc = count(left.rows, spec.leftKey);
  const rc = count(right.rows, spec.rightKey);
  a.nullLeft = left.rows.filter((r) => normKey(r[spec.leftKey]) == null).length;
  a.nullRight = right.rows.filter((r) => normKey(r[spec.rightKey]) == null).length;
  a.dupLeft = dups(lc);
  a.dupRight = dups(rc);
  let maxRightPerLeft = 1; // quantas vezes uma linha da esquerda se repete no resultado
  let maxLeftPerRight = 1; // quantas vezes uma linha da direita se repete
  let effLeftDup = false;
  let effRightDup = false;
  for (const [k, n] of lc) {
    const m = rc.get(k);
    if (!m) continue;
    maxRightPerLeft = Math.max(maxRightPerLeft, m);
    maxLeftPerRight = Math.max(maxLeftPerRight, n);
    if (n > 1) effLeftDup = true;
    if (m > 1) effRightDup = true;
  }
  const unL = new Set<string>();
  for (const r of left.rows) {
    const k = normKey(r[spec.leftKey]);
    if (k != null && rc.has(k)) a.matched++;
    else if (k != null) unL.add(k);
  }
  a.unmatchedLeft = a.leftRows - a.matched;
  const unR = new Set([...rc.keys()].filter((k) => !lc.has(k)));
  a.unmatchedRight = right.rows.filter((r) => {
    const k = normKey(r[spec.rightKey]);
    return k != null && !lc.has(k);
  }).length;
  a.examplesLeft = [...unL].slice(0, 5);
  a.examplesRight = [...unR].slice(0, 5);
  for (const r of left.rows) {
    const k = normKey(r[spec.leftKey]);
    const m = k == null ? 0 : (rc.get(k) ?? 0);
    a.resultRows += m > 0 ? m : spec.how === 'left' ? 1 : 0;
  }
  a.cardinality = effLeftDup && effRightDup ? 'N:N' : effLeftDup ? 'N:1' : effRightDup ? '1:N' : '1:1';

  if (a.cardinality === 'N:N') a.warnings.push(`Junção de muitos para muitos: as chaves se repetem nos dois lados e o resultado tem ${a.resultRows} linhas (${a.leftRows} e ${a.rightRows} nas tabelas de origem). Confira se a chave é a certa.`);
  if (maxLeftPerRight > 1) for (const c of numericCols(right, spec.rightKey)) a.warnings.push(`“${c}” se repete em até ${maxLeftPerRight} linhas (valor da tabela “${tableId(right)}”); somar essa coluna no resultado superestima o total.`);
  if (maxRightPerLeft > 1) for (const c of numericCols(left, spec.leftKey)) a.warnings.push(`“${c}” se repete em até ${maxRightPerLeft} linhas (valor da tabela “${tableId(left)}”); somar essa coluna no resultado superestima o total.`);
  if (a.matched === 0) a.warnings.push('Nenhuma chave casou entre as duas tabelas.');
  else if (a.unmatchedLeft / Math.max(1, a.leftRows) >= 0.3) a.warnings.push(`${a.unmatchedLeft} de ${a.leftRows} linhas da esquerda não encontraram par.`);
  // chaves que diferem só por zeros à esquerda: sugere, nunca corrige
  const rightRaw = [...rc.keys()];
  const stripped = new Map(rightRaw.map((k) => [noZeros(k), k]));
  const pair = [...unL, ...unR].map((k) => ({ k, o: stripped.get(noZeros(k)) })).find((x) => x.o && x.o !== x.k);
  if (pair) a.hints.push(`Algumas chaves diferem só por zeros à esquerda (ex.: “${pair.k}” e “${pair.o}”). Se for o mesmo código, confira se uma das colunas perdeu os zeros; nada foi corrigido automaticamente.`);
  if (left.shapes && a.resultRows > a.leftRows) a.blockers.push(`A junção multiplicaria as linhas de uma tabela com formas (${a.leftRows} → ${a.resultRows}); os polígonos seriam desenhados empilhados. Use outra chave ou resuma a tabela da direita por chave antes.`);
  return a;
}

/** Cria a tabela relacionada. Lança erro se a análise tiver impedimentos (a tela só chama depois de confirmar). */
export function joinTables(left: Table, right: Table, spec: JoinSpec): Table {
  const an = analyzeJoin(left, right, spec);
  if (an.blockers.length) throw new Error(an.blockers.join(' '));
  const name = `${tableId(left)} + ${tableId(right)}`;
  const keep = { ...(left.geo ? { geo: left.geo } : {}), ...(left.shapes ? { shapes: left.shapes } : {}) };
  if (spec.kind === 'pontos') {
    const r = countPointsIn(left, right);
    const col = `Pontos em ${tableId(right)}`;
    const idCol = left.geo?.id;
    const rows = left.rows.map((row) => ({ ...row, [col]: idCol && row[idCol] != null && String(row[idCol]) in r.counts ? r.counts[String(row[idCol])]! : null }));
    const notes = [`Contagem de pontos de “${tableId(right)}” dentro dos polígonos de “${tableId(left)}”: ${r.outside} ponto(s) fora de qualquer polígono e ${r.invalid} sem coordenada válida. Ponto em polígonos sobrepostos conta em todos; ponto em buraco não conta.`];
    return { name, columns: [...left.columns, col], rows, ...keep, joined: spec, notes };
  }
  const rcols = right.columns.filter((c) => c !== spec.rightKey);
  const used = new Set(left.columns);
  const rename = new Map<string, string>();
  for (const c of rcols) {
    let n = used.has(c) ? `${c} (${tableId(right)})` : c;
    for (let i = 2; used.has(n); i++) n = `${c} (${tableId(right)} ${i})`;
    used.add(n);
    rename.set(c, n);
  }
  const idx = new Map<string, Row[]>();
  for (const r of right.rows) {
    const k = normKey(r[spec.rightKey]);
    if (k != null) idx.set(k, [...(idx.get(k) ?? []), r]);
  }
  const rows: Row[] = [];
  for (const l of left.rows) {
    const k = normKey(l[spec.leftKey]);
    const ms = k == null ? [] : (idx.get(k) ?? []);
    if (!ms.length) {
      if (spec.how === 'left') rows.push({ ...l, ...Object.fromEntries(rcols.map((c) => [rename.get(c)!, null])) });
      continue;
    }
    for (const m of ms) rows.push({ ...l, ...Object.fromEntries(rcols.map((c) => [rename.get(c)!, m[c] ?? null])) });
  }
  const notes = [`Relação ${spec.how === 'left' ? 'à esquerda' : 'interna'} de “${tableId(left)}” com “${tableId(right)}” pela chave “${spec.leftKey}” = “${spec.rightKey}”: ${rows.length} linha(s), ${an.unmatchedLeft} da esquerda sem par.`, ...an.warnings, ...an.hints];
  return { name, columns: [...left.columns, ...rcols.map((c) => rename.get(c)!)], rows, ...keep, joined: spec, notes };
}

const baseName = (f: string) => f.replace(/\.[^.]+$/, '');

/** Reúne vários arquivos abertos juntos: nomes de tabela únicos (arquivo › aba) e uma fonte por arquivo (nome, tamanho, SHA-256). */
export function mergeDatasets(list: Dataset[]): Dataset {
  if (list.length === 1) return list[0]!;
  const used = new Set<string>();
  const unique = (n: string) => {
    let r = n;
    for (let i = 2; used.has(r); i++) r = `${n} (${i})`;
    used.add(r);
    return r;
  };
  const tables = list.flatMap((d) => d.tables.map((t) => ({ ...t, name: unique(d.tables.length === 1 ? baseName(d.fileName) : `${baseName(d.fileName)} › ${t.name}`) })));
  const sources: ParseInfo[] = list.map((d) => ({ ...d.info!, fileName: d.fileName }));
  const sum = (f: (i: ParseInfo) => number) => sources.reduce((s, i) => s + f(i), 0);
  const info: ParseInfo = {
    format: [...new Set(sources.map((s) => s.format))].join('+'),
    bytes: sum((i) => i.bytes),
    rowsRead: sum((i) => i.rowsRead),
    rowsDropped: sum((i) => i.rowsDropped),
    truncated: sum((i) => i.truncated),
    notes: sources.flatMap((s) => s.notes.map((n) => `${s.fileName}: ${n}`)),
    ...(sources[0]!.readAt ? { readAt: sources[0]!.readAt } : {}),
  };
  return { fileName: `${list[0]!.fileName} e mais ${list.length - 1} arquivo(s)`, tables, info, sources };
}

/** Refaz as relações salvas sobre as tabelas abertas. A que não puder ser refeita é descartada e o motivo volta em `dropped`. */
export function applyJoins(ds: Dataset, specs: JoinSpec[]): { ds: Dataset; dropped: string[] } {
  const tables = [...ds.tables];
  const dropped: string[] = [];
  for (const s of specs) {
    const find = (id: string) => tables.find((t) => tableId(t) === id);
    const l = find(s.left);
    const r = find(s.right);
    const lab = `${s.left} + ${s.right}`;
    const miss = !l ? s.left : !r ? s.right : '';
    if (miss) {
      dropped.push(`Relação “${lab}” descartada: a tabela “${miss}” não está entre os arquivos abertos.`);
      continue;
    }
    const an = analyzeJoin(l!, r!, s);
    if (an.blockers.length) {
      dropped.push(`Relação “${lab}” descartada: ${an.blockers.join(' ')}`);
      continue;
    }
    tables.push(joinTables(l!, r!, s));
  }
  return { ds: { ...ds, tables }, dropped };
}

/** Separa as tabelas de origem das criadas por relação (só as receitas são guardadas no projeto e no HTML compartilhado). */
export function stripJoined(ds: Dataset): { ds: Dataset; joins: JoinSpec[] } {
  return { ds: { ...ds, tables: ds.tables.filter((t) => !t.joined) }, joins: ds.tables.flatMap((t) => (t.joined ? [t.joined] : [])) };
}

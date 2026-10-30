import { isDelimited, isTextual } from '../formats.js';
import { mergeDatasets } from '../join/join.js';
import { diffBox } from './diffBox.js';
import { cellText, TYPE_NAMES } from './format.js';
import { $, el } from './dom.js';
import { delimiterName } from '../csv.js';
import type { DelimiterChoice, Encoding } from '../csv.js';
import { parseFile } from '../parse.js';
import type { ParseOptions } from '../parse.js';
import { inferLocale, locale, profileTable } from '../profile.js';
import type { LocaleInfo } from '../profile.js';
import { applyRenames, compareTables, reconcileState } from '../project.js';
import type { ProjectState } from '../project.js';
import { formatBytes } from '../report.js';
import { qualityAlerts } from '../suggest.js';
import type { ColType, Dataset, Table } from '../types.js';

/** O que o fluxo de importação pede ao painel (o módulo não conhece o estado da tela). */
export interface ImportHost {
  load(ds: Dataset, st: ProjectState): void;
  fail(msg: string): void;
  currentLoc(): LocaleInfo | undefined;
  /** configuração de um projeto aberto, aguardando o arquivo de dados; entrega e limpa */
  takeCarry(): { state: ProjectState; oldTable?: Table; label: string } | null;
  setLocInfo(li: LocaleInfo): void;
  parseDefaults: ParseOptions;
}
let host!: ImportHost;
export const initImport = (h: ImportHost) => {
  host = h;
};
export const clearPending = () => {
  pending = null;
};

// prévia: o usuário confere como o arquivo foi lido antes de gerar o painel
interface Pending {
  fileName: string;
  bytes: Uint8Array;
  opts: ParseOptions;
  ds: Dataset;
  tableIndex: number;
  forcedTmp: Record<string, ColType>;
  sha?: string;
  carry?: { state: ProjectState; oldTable?: Table; label: string } | null;
}
let pending: Pending | null = null;

async function sha256(bytes: Uint8Array): Promise<string | undefined> {
  try {
    const h = await crypto.subtle.digest('SHA-256', bytes.slice());
    return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return undefined;
  }
}

export async function startFile(fileName: string, bytes: Uint8Array, opts: ParseOptions = {}, keep?: Pending) {
  try {
    const ds = await parseFile(fileName, bytes, { ...host.parseDefaults, ...opts });
    const sha = keep?.sha ?? (await sha256(bytes));
    ds.info = { ...ds.info!, sha256: sha, readAt: keep?.ds.info?.readAt ?? new Date().toISOString() };
    if (!keep) {
      const li = inferLocale(ds.tables);
      host.setLocInfo(li);
      locale.dateOrder = li.dateOrder;
      locale.numbers = li.numbers;
    }
    const taken = host.takeCarry();
    const cr = keep ? keep.carry : taken;
    let tableIndex = keep?.tableIndex ?? 0;
    if (!keep && cr) {
      const want = cr.oldTable?.title ?? cr.oldTable?.name;
      const byName = want ? ds.tables.findIndex((x) => (x.title ?? x.name) === want) : -1;
      tableIndex = byName >= 0 ? byName : cr.state.tableIndex != null && cr.state.tableIndex < ds.tables.length ? cr.state.tableIndex : 0;
    }
    pending = { fileName, bytes, opts, ds, tableIndex, forcedTmp: keep?.forcedTmp ?? {}, sha, carry: cr };
    $('msg').textContent = '';
    renderPreview();
  } catch (e) {
    host.fail(e instanceof Error ? e.message : 'Não foi possível ler o arquivo.');
  }
}

export function renderPreview() {
  const p = pending;
  if (!p) return;
  const info = p.ds.info!;
  const t = p.ds.tables[p.tableIndex]!;
  const prof = profileTable(t, p.forcedTmp);
  const n = (x: number) => new Intl.NumberFormat('pt-BR').format(x);
  const box = $('preview');
  box.hidden = false;
  $('drop').hidden = true;
  $('app').hidden = true;
  $('actions').hidden = true;

  const dl = (rows: [string, string][]) => el('dl', {}, ...rows.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]));
  const rows: [string, string][] = [['Arquivo', p.fileName], ['Formato', `.${info.format}`], ['Tamanho', formatBytes(info.bytes)]];
  if (info.sha256) rows.push(['SHA-256', info.sha256]);
  if (info.encoding) rows.push(['Codificação do texto', info.encoding]);
  if (info.delimiter) rows.push(['Separador de colunas', `${delimiterName(info.delimiter)}${info.delimiterGuessed ? ' (detectado)' : ' (escolhido)'}`]);
  p.ds.sources?.forEach((s, i) => rows.push([`Fonte ${i + 1}`, `${s.fileName} · .${s.format} · ${formatBytes(s.bytes)}`], [`SHA-256 da fonte ${i + 1}`, s.sha256 ?? 'não calculado']));
  rows.push(['Tabelas encontradas', String(p.ds.tables.length)], ['Linhas lidas', n(info.rowsRead)], ['Linhas ignoradas (em branco ou título)', n(info.rowsDropped)], ['Linhas não lidas (acima do limite)', n(info.truncated)]);

  const sel = <V extends string>(label: string, value: V, options: [V, string][], onChange: (v: V) => void) => {
    const s = el('select', { ariaLabel: label }, ...options.map(([v, l]) => el('option', { value: v, selected: v === value }, l)));
    s.onchange = () => onChange(s.value as V);
    return el('label', {}, label + ' ', s);
  };
  const textual = !p.ds.sources && isTextual(info.format);
  const reparse = (o: ParseOptions) => void startFile(p.fileName, p.bytes, { ...p.opts, ...o }, p);
  const controls = el('fieldset', {}, el('legend', {}, 'Se algo estiver errado, ajuste aqui'));
  if (textual) controls.append(sel<Encoding>('Codificação', p.opts.encoding ?? 'auto', [['auto', 'Automática'], ['utf-8', 'UTF-8'], ['windows-1252', 'Windows-1252 (Excel BR)']], (v) => reparse({ encoding: v })));
  if (!p.ds.sources && isDelimited(info.format)) controls.append(sel<DelimiterChoice>('Separador', p.opts.delimiter ?? 'auto', [['auto', 'Automático'], [',', 'Vírgula'], [';', 'Ponto e vírgula'], ['\t', 'Tabulação'], ['|', 'Barra vertical']], (v) => reparse({ delimiter: v })));
  controls.append(
    sel<'dmy' | 'mdy'>('Datas com barra (03/04/2024)', locale.dateOrder, [['dmy', 'dia/mês/ano'], ['mdy', 'mês/dia/ano']], (v) => ((locale.dateOrder = v), renderPreview())),
    sel<'br' | 'us'>('Números', locale.numbers, [['br', '1.234,56 (padrão brasileiro)'], ['us', '1,234.56 (padrão americano)']], (v) => ((locale.numbers = v), renderPreview())),
  );
  if (p.ds.tables.length > 1) controls.append(sel<string>('Tabela / aba', String(p.tableIndex), p.ds.tables.map((tb, i) => [String(i), `${tb.title ?? tb.name} (${n(tb.rows.length)} linhas)`] as [string, string]), (v) => ((p.tableIndex = Number(v)), renderPreview())));

  const alerts = qualityAlerts(t, prof, host.currentLoc());
  const notes = [...info.notes.map((x) => ({ level: 'info', text: x })), ...alerts.map((a) => ({ level: a.level, text: a.text }))];
  const notesUl = el('ul', {}, ...notes.slice(0, 16).map((x) => el('li', { className: x.level }, x.text)));
  if (notes.length > 16) notesUl.append(el('li', { className: 'info' }, `…e mais ${notes.length - 16} aviso(s), que aparecem no painel.`));

  const colRows = prof.map((c) => {
    const s = el('select', { ariaLabel: `Tipo da coluna ${c.name}` }, ...Object.entries(TYPE_NAMES).map(([v, l]) => el('option', { value: v, selected: v === c.type }, l)));
    s.onchange = () => {
      p.forcedTmp = { ...p.forcedTmp, [c.name]: s.value as ColType };
      renderPreview();
    };
    return el('tr', {}, el('td', {}, c.name), el('td', {}, s), el('td', {}, String(c.filled)), el('td', {}, String(c.missing)), el('td', {}, c.invalidCount ? `${c.invalidCount} (linha ${c.invalid![0]!.row}: “${c.invalid![0]!.value}”)` : '—'));
  });
  const sample = t.rows.slice(0, 8);
  const go = el('button', { type: 'button', className: 'primary' }, 'Gerar painel');
  let carryBox: HTMLElement | null = null;
  let reconciled: ProjectState | null = null;
  if (p.carry) {
    const names = applyRenames(t, p.carry.state.renames ?? {}).columns;
    const rc = reconcileState(p.carry.state, [...names, ...t.columns]);
    reconciled = rc.state;
    carryBox = el('div', { className: 'notice' }, el('b', {}, 'Configuração reaplicada'), el('p', {}, `${p.carry.label}. Filtros, período, ajustes, nomes, unidades e métricas compatíveis serão reaplicados a esta tabela.`));
    if (rc.dropped.length) carryBox.append(el('p', {}, 'Descartado por não existir mais neste arquivo:'), el('ul', {}, ...rc.dropped.map((x) => el('li', { className: 'warn' }, x))));
    if (p.carry.oldTable) carryBox.append(el('p', {}, 'O que mudou em relação ao arquivo anterior:'), diffBox(compareTables(p.carry.oldTable, t)));
  }
  go.onclick = () => host.load(p.ds, { ...(reconciled ?? {}), tableIndex: reconciled?.tableIndex != null && reconciled.tableIndex >= p.ds.tables.length ? reconciled.tableIndex : p.tableIndex, forced: { ...(reconciled?.forced ?? {}), ...p.forcedTmp }, locale: { dateOrder: locale.dateOrder, numbers: locale.numbers } });
  const cancel = el('button', { type: 'button' }, 'Escolher outro arquivo');
  cancel.onclick = () => {
    pending = null;
    box.hidden = true;
    $('drop').hidden = false;
    ($('file') as HTMLInputElement).value = '';
  };
  box.replaceChildren(
    el('h2', {}, 'Prévia: confira como li o arquivo'),
    el('p', { className: 'muted' }, 'Nada foi aplicado ainda. Confira o que foi lido, corrija se preciso e só então gere o painel.'),
    ...(carryBox ? [carryBox] : []),
    dl(rows),
    controls,
    el('h3', {}, 'Avisos e decisões da leitura'),
    notes.length ? notesUl : el('p', { className: 'muted' }, 'Nenhum aviso.'),
    el('h3', {}, `Colunas da tabela “${t.title ?? t.name}” (${t.columns.length})`),
    el('div', { className: 'tablewrap' }, el('table', {}, el('thead', {}, el('tr', {}, ...['Coluna', 'Tipo (pode corrigir)', 'Preenchidas', 'Vazias', 'Valores inválidos'].map((h) => el('th', {}, h)))), el('tbody', {}, ...colRows))),
    el('h3', {}, `Primeiras ${sample.length} linhas`),
    el('div', { className: 'tablewrap' }, el('table', {}, el('thead', {}, el('tr', {}, ...t.columns.map((c) => el('th', {}, c)))), el('tbody', {}, ...sample.map((r) => el('tr', {}, ...t.columns.map((c) => el('td', {}, cellText(r[c])))))))),
    el('div', { className: 'btns' }, cancel, go),
  );
}

export async function handle(f: File) {
  await startFile(f.name, new Uint8Array(await f.arrayBuffer()));
}


/** Abre um ou vários arquivos. Com vários, as tabelas de todos entram no mesmo painel (nomes “arquivo › aba”) e podem ser relacionadas depois. */
export async function handleFiles(files: File[]) {
  if (files.length === 1) return handle(files[0]!);
  try {
    const list: Dataset[] = [];
    for (const f of files) {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const ds = await parseFile(f.name, bytes, { ...host.parseDefaults });
      list.push({ ...ds, info: { ...ds.info!, sha256: await sha256(bytes), readAt: new Date().toISOString() } });
    }
    const ds = mergeDatasets(list);
    const li = inferLocale(ds.tables);
    host.setLocInfo(li);
    locale.dateOrder = li.dateOrder;
    locale.numbers = li.numbers;
    pending = { fileName: ds.fileName, bytes: new Uint8Array(0), opts: {}, ds, tableIndex: 0, forcedTmp: {}, carry: host.takeCarry() };
    $('msg').textContent = '';
    renderPreview();
  } catch (e) {
    host.fail(e instanceof Error ? e.message : 'Não foi possível ler os arquivos.');
  }
}

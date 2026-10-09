import { XMLParser } from 'fast-xml-parser';
import { unzipSync, strFromU8 } from 'fflate';
import Papa from 'papaparse';
import readXlsx from 'read-excel-file/browser';
import { decodeText, delimiterName, detectDelimiter } from './csv.js';
import type { DelimiterChoice, Encoding } from './csv.js';
import { docxToMatrix } from './docx.js';
import { detectRepeatedBlocks } from './grid.js';
import { pdfToMatrix } from './pdf.js';
import { inferYearColumn, joinByYear } from './quadros.js';
import { toNumber } from './profile.js';
import type { Cell, Dataset, ParseInfo, Row, Table } from './types.js';
import { maxOf, sentenceCase } from './util.js';

const MAX_BYTES = 50 * 1024 * 1024;
const MAX_ROWS = 200_000;

const ext = (n: string) => n.toLowerCase().split('.').pop() ?? '';

function uniqueNames(names: string[], renamed?: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n, i) => {
    const raw = (n ?? '').toString().trim();
    const base = raw || `Coluna ${i + 1}`;
    const c = seen.get(base) ?? 0;
    seen.set(base, c + 1);
    const out = c ? `${base} (${c + 1})` : base;
    if (renamed && (c || !raw)) renamed.push(raw ? `“${raw}” → “${out}”` : `(sem nome) → “${out}”`);
    return out;
  });
}

function clean(v: unknown): Cell {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'object') return JSON.stringify(v);
  const s = String(v).trim();
  return s === '' ? null : s;
}

function toTableSimple(name: string, matrix: unknown[][]): Table {
  let rows2 = matrix.filter((r) => r.some((c) => c != null && String(c).trim() !== ''));
  const blank = matrix.length - rows2.length;
  if (!rows2.length) return { name, columns: [], rows: [] };
  // linhas de título (poucas células preenchidas) acima do cabeçalho real são descartadas
  const cnt = (r: unknown[]) => r.filter((c) => c != null && String(c).trim() !== '').length;
  const max = maxOf(rows2.map(cnt));
  const start = rows2.findIndex((r) => cnt(r) >= Math.ceil(max * 0.6));
  let title: string | undefined;
  if (start > 0 && rows2.length - start >= 2) {
    title = rows2.slice(0, start).flat().filter((c) => c != null && String(c).trim() !== '').map((c) => String(c).trim()).join(' ');
    rows2 = rows2.slice(start);
  }
  const renamed: string[] = [];
  let headerCells = (rows2[0] as unknown[]).map((c) => String(c ?? ''));
  let dataRows = rows2.slice(1);
  const sub = twoRowHeader(rows2);
  if (sub) {
    headerCells = sub;
    dataRows = rows2.slice(2);
  }
  const columns = uniqueNames(headerCells, renamed);
  const truncated = Math.max(0, dataRows.length - MAX_ROWS);
  const rows: Row[] = dataRows.slice(0, MAX_ROWS).map((r) => {
    const o: Row = {};
    columns.forEach((c, i) => (o[c] = clean(r[i])));
    return o;
  });
  const notes: string[] = [];
  if (truncated) notes.push(`O arquivo tem ${new Intl.NumberFormat('pt-BR').format(dataRows.length)} linhas de dados; só as primeiras ${new Intl.NumberFormat('pt-BR').format(MAX_ROWS)} foram lidas. As ${new Intl.NumberFormat('pt-BR').format(truncated)} restantes ficaram de fora dos números e gráficos.`);
  if (blank) notes.push(`${blank} linha(s) em branco foram ignoradas.`);
  if (title && start > 0) notes.push(`${start} linha(s) de título acima do cabeçalho foram usadas como título do painel e não entram nos dados.`);
  if (renamed.length) notes.push(`Colunas com nome repetido ou vazio foram renomeadas: ${renamed.join('; ')}.`);
  return { name, columns, rows, ...(title ? { title } : {}), ...(notes.length ? { notes } : {}), stats: { dropped: blank + (title ? start : 0), truncated } };
}

const looksNumeric = (c: unknown) => c != null && String(c).trim() !== '' && toNumber(c as Cell) != null;

/**
 * Cabeçalho em dois níveis (faixa de grupo + nome da coluna): se a 2ª linha só tem texto onde as linhas
 * abaixo têm números, ela também é cabeçalho. Devolve os nomes combinados (“Grupo — Coluna”) ou undefined.
 */
function twoRowHeader(rows: unknown[][]): string[] | undefined {
  if (rows.length < 4) return undefined;
  const h = rows[0]!;
  const s = rows[1]!;
  const width = Math.max(h.length, s.length);
  const text = (c: unknown) => (c == null ? '' : String(c).trim());
  if (s.some((c) => looksNumeric(c))) return undefined;
  let numericBelow = 0;
  let textBelow = 0;
  for (let i = 0; i < width; i++) {
    if (!text(s[i])) continue;
    textBelow++;
    const below = rows.slice(2).map((r) => r[i]).filter((c) => text(c) !== '');
    if (below.length && below.filter(looksNumeric).length >= below.length * 0.6) numericBelow++;
  }
  if (textBelow < 2 || numericBelow < Math.ceil(textBelow * 0.6)) return undefined;
  let carry = '';
  const out: string[] = [];
  for (let i = 0; i < width; i++) {
    const g = text(h[i]);
    if (g) carry = g;
    const sub = text(s[i]);
    const grp = g || (sub ? carry : '');
    out.push(grp && sub && grp.toLowerCase() !== sub.toLowerCase() ? `${sentenceCase(grp)} — ${sub}` : sub || g);
  }
  return out;
}

const filledCount = (r: unknown[]) => r.filter((c) => c != null && String(c).trim() !== '').length;

/**
 * Planilhas de formulário trazem títulos, blocos separados por linhas em branco e cabeçalhos soltos.
 * Separa em blocos, descarta linhas de título acima do cabeçalho real (primeira linha bem preenchida)
 * e devolve uma tabela por bloco. Se houver um único bloco, cai no comportamento simples.
 */
export function toTables(name: string, matrix: unknown[][]): Table[] {
  const repeated = detectRepeatedBlocks(name, matrix);
  if (repeated) return [repeated];
  const groups: unknown[][][] = [];
  let cur: unknown[][] = [];
  for (const r of matrix) {
    if (filledCount(r) === 0) {
      if (cur.length) groups.push(cur);
      cur = [];
    } else cur.push(r);
  }
  if (cur.length) groups.push(cur);
  const blocks: Table[] = [];
  const loose: string[] = [];
  const texts = (rows: unknown[][]) => rows.flat().filter((c) => c != null && String(c).trim() !== '').map((c) => String(c).trim());
  for (const g of groups) {
    const maxFilled = maxOf(g.map(filledCount));
    if (g.length < 3 || maxFilled < 3) {
      for (const x of texts(g)) loose.push(x);
      continue;
    }
    const start = g.findIndex((r) => filledCount(r) >= Math.ceil(maxFilled * 0.6));
    const body = g.slice(start);
    if (body.length < 3) {
      for (const x of texts(g)) loose.push(x);
      continue;
    }
    const used = new Set<number>();
    body.forEach((r) => r.forEach((c, i) => c != null && String(c).trim() !== '' && used.add(i)));
    const cols = [...used].sort((a, b) => a - b);
    const t = toTableSimple(`${name} · bloco ${blocks.length + 1}`, body.map((r) => cols.map((i) => r[i])));
    if (t.columns.length >= 3 && t.rows.length >= 3) {
      if (start > 0) {
        const above = texts(g.slice(0, start));
        const last = above[above.length - 1]!;
        // faixa em caixa alta logo acima do cabeçalho (ex.: “UNIDADES DOMICILIARES”) agrupa as colunas; o texto anterior é a legenda do quadro
        const letters = last.replace(/[^\p{L}]/gu, '');
        const upper = letters.replace(/[^\p{Lu}]/gu, '');
        const isGroup = above.length > 1 && last.length <= 80 && letters.length > 3 && upper.length >= letters.length * 0.8;
        if (isGroup) t.group = last;
        t.title = isGroup ? above[above.length - 2] : last;
        // cabeçalho institucional comprido (brasão, órgão…) não serve de título do quadro
        if (t.title && t.group && (t.title.length > 140 || /PREFEITURA|SECRETARIA/.test(t.title))) t.title = t.group;
      }
      blocks.push(t);
    } else for (const x of texts(g)) loose.push(x);
  }
  if (blocks.length >= 2 || (blocks.length === 1 && groups.length > 1)) {
    const context = [...new Set(loose)].join(' · ').slice(0, 300) || undefined;
    return blocks.map((b) => ({ ...b, ...(blocks.length === 1 ? { name } : {}), context }));
  }
  return [toTableSimple(name, matrix)];
}

export function objectsToTable(name: string, list: Record<string, unknown>[]): Table {
  const set = new Set<string>();
  for (const o of list.slice(0, 5000)) Object.keys(o).forEach((k) => set.add(k));
  const columns = [...set];
  const rows = list.slice(0, MAX_ROWS).map((o) => {
    const r: Row = {};
    for (const c of columns) r[c] = clean(o[c]);
    return r;
  });
  const truncated = Math.max(0, list.length - MAX_ROWS);
  return { name, columns, rows, ...(truncated ? { notes: [`O arquivo tem ${list.length} registros; só os primeiros ${MAX_ROWS} foram lidos.`] } : {}), stats: { dropped: 0, truncated } };
}

function parseCsv(name: string, text: string, delimiter: string): Table[] {
  const res = Papa.parse<unknown[]>(text, { skipEmptyLines: false, delimiter });
  return toTables(name, res.data as unknown[][]);
}

function parseJson(name: string, text: string): Table[] {
  const j = JSON.parse(text) as unknown;
  if (j && typeof j === 'object' && (j as { type?: string }).type === 'FeatureCollection') return [geojsonTable(name, j as GeoJson)];
  if (Array.isArray(j)) return [objectsToTable(name, j.map((x) => (x && typeof x === 'object' ? (x as Record<string, unknown>) : { valor: x })))];
  if (j && typeof j === 'object') {
    const arrays = Object.entries(j as Record<string, unknown>).filter(([, v]) => Array.isArray(v) && v.length && typeof v[0] === 'object');
    if (arrays.length) return arrays.map(([k, v]) => objectsToTable(k, v as Record<string, unknown>[]));
    return [objectsToTable(name, [j as Record<string, unknown>])];
  }
  throw new Error('JSON sem lista de registros.');
}

interface GeoJson {
  features: { properties?: Record<string, unknown> | null; geometry?: { type: string; coordinates: unknown } | null }[];
}

function centroid(g: { type: string; coordinates: unknown }): [number, number] | null {
  const pts: [number, number][] = [];
  const walk = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === 'number') pts.push([c[0] as number, c[1] as number]);
    else if (Array.isArray(c)) c.forEach(walk);
  };
  walk(g.coordinates);
  if (!pts.length) return null;
  return [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
}

function geojsonTable(name: string, g: GeoJson): Table {
  const list = g.features.map((f) => {
    const c = f.geometry ? centroid(f.geometry) : null;
    return { ...(f.properties ?? {}), latitude: c ? c[1] : null, longitude: c ? c[0] : null, geometria: f.geometry?.type ?? null };
  });
  const t = objectsToTable(name, list);
  t.geo = { lat: 'latitude', lon: 'longitude' };
  return t;
}

const arr = <T>(x: T | T[] | undefined): T[] => (x == null ? [] : Array.isArray(x) ? x : [x]);

function parseKmlText(name: string, xml: string): Table[] {
  if (/<!DOCTYPE/i.test(xml)) throw new Error('KML com DOCTYPE não é aceito por segurança.');
  const p = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', processEntities: true, textNodeName: '#text' });
  const doc = p.parse(xml) as Record<string, unknown>;
  const list: Record<string, unknown>[] = [];
  const walk = (node: unknown, folder: string): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as Record<string, unknown>;
    for (const pm of arr(n.Placemark as unknown)) {
      const o: Record<string, unknown> = { nome: (pm as Record<string, unknown>).name ?? null, pasta: folder || null };
      const m = pm as Record<string, unknown>;
      if (typeof m.description === 'string') o.descricao = m.description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const ed = m.ExtendedData as { Data?: unknown; SimpleData?: unknown } | undefined;
      for (const d of arr(ed?.Data as { '@_name'?: string; value?: unknown }[] | undefined)) if (d['@_name']) o[d['@_name']] = d.value ?? null;
      const coords = JSON.stringify(m).match(/"coordinates":"([^"]+)"/)?.[1] ?? '';
      const pts = coords.split(/\s+/).map((s) => s.split(',').map(Number)).filter((a) => a.length >= 2 && Number.isFinite(a[0]) && Number.isFinite(a[1]));
      if (pts.length) {
        o.longitude = pts.reduce((a, q) => a + q[0]!, 0) / pts.length;
        o.latitude = pts.reduce((a, q) => a + q[1]!, 0) / pts.length;
      }
      list.push(o);
    }
    for (const f of arr(n.Folder as unknown)) walk(f, [folder, String((f as Record<string, unknown>).name ?? '')].filter(Boolean).join(' / '));
    if (n.Document) walk(n.Document, folder);
    if (n.kml) walk(n.kml, folder);
  };
  walk(doc, '');
  const t = objectsToTable(name, list);
  t.geo = { lat: 'latitude', lon: 'longitude' };
  return [t];
}

async function parseKmz(name: string, bytes: Uint8Array): Promise<Table[]> {
  const files = unzipSync(bytes, { filter: (f) => f.name.toLowerCase().endsWith('.kml') && f.originalSize < MAX_BYTES });
  const kml = Object.keys(files).find((k) => k.toLowerCase().endsWith('.kml'));
  if (!kml) throw new Error('KMZ sem arquivo .kml.');
  return parseKmlText(name, strFromU8(files[kml]!));
}

/** Lê qualquer formato suportado e devolve as tabelas encontradas (uma por aba/lista). */
export interface ParseOptions {
  /** codificação do texto (CSV/JSON/KML); 'auto' = UTF-8 e, se inválido, Windows-1252 */
  encoding?: Encoding;
  /** separador do CSV; 'auto' detecta */
  delimiter?: DelimiterChoice;
  /** biblioteca pdf.js já configurada (no navegador, com o worker embutido) */
  pdfjs?: Parameters<typeof pdfToMatrix>[0];
}

export async function parseFile(fileName: string, bytes: Uint8Array, opts: ParseOptions = {}): Promise<Dataset> {
  if (bytes.byteLength > MAX_BYTES) throw new Error('Arquivo maior que 50 MB.');
  const base = fileName.replace(/\.[^.]+$/, '');
  const dec = () => decodeText(bytes, opts.encoding ?? 'auto');
  const info: ParseInfo = { format: ext(fileName), bytes: bytes.byteLength, rowsRead: 0, rowsDropped: 0, truncated: 0, notes: [] };
  let tables: Table[];
  const useText = () => {
    const d = dec();
    info.encoding = d.encoding;
    if (d.fellBack) info.notes.push('O arquivo não está em UTF-8; foi lido como Windows-1252 (Latin-1). Se aparecerem caracteres estranhos, escolha outra codificação na prévia.');
    return d.text;
  };
  switch (ext(fileName)) {
    case 'csv':
    case 'tsv':
    case 'txt':
      {
        const txt = useText();
        const chosen = opts.delimiter && opts.delimiter !== 'auto' ? opts.delimiter : detectDelimiter(txt);
        info.delimiter = chosen;
        info.delimiterGuessed = !opts.delimiter || opts.delimiter === 'auto';
        info.notes.push(`Separador de colunas ${info.delimiterGuessed ? 'detectado' : 'escolhido'}: ${delimiterName(chosen)}.`);
        tables = parseCsv(base, txt, chosen);
      }
      break;
    case 'json':
    case 'geojson':
      tables = parseJson(base, useText());
      break;
    case 'kml':
      tables = parseKmlText(base, useText());
      break;
    case 'kmz':
      tables = await parseKmz(base, bytes);
      break;
    case 'pdf': {
      if (!opts.pdfjs) throw new Error('Leitura de PDF indisponível neste ambiente.');
      const r = await pdfToMatrix(opts.pdfjs, bytes);
      if (!r.lines.length) throw new Error('Este PDF não tem texto selecionável (parece escaneado). Peça o arquivo original em Excel/CSV ou use um PDF gerado digitalmente.');
      tables = toTables(base, r.matrix);
      const hasStructure = tables.some((t) => t.tidy || (t.columns.length >= 3 && t.rows.length >= 3));
      if (r.textOnly || !hasStructure) {
        const t: Table = { name: base, noCharts: true, columns: ['Página', 'Linha', 'Texto'], rows: r.lines.map((l, i) => ({ 'Página': l.page, Linha: i + 1, Texto: l.text })), notes: ['Não encontrei uma tabela com colunas alinhadas neste PDF; mostrando o texto linha a linha. Para gráficos, use o arquivo original em Excel/CSV.'] };
        tables = [t];
      } else for (const t of tables) t.notes = [...(t.notes ?? []), `Tabela extraída de ${r.pages} página(s) de PDF pela posição do texto; confira os números com o documento original.`];
      break;
    }
    case 'docx': {
      const r = docxToMatrix(bytes);
      if (!r.matrix.length) throw new Error('O documento está vazio.');
      tables = r.tables ? toTables(base, r.matrix) : [];
      const ok = tables.filter((t) => t.tidy || (t.columns.length >= 3 && t.rows.length >= 3));
      if (!r.tables || !ok.length) {
        tables = [{ name: base, noCharts: true, columns: ['Parágrafo', 'Texto'], rows: r.paragraphs.map((x, i) => ({ 'Parágrafo': i + 1, Texto: x })), notes: [r.tables ? 'As tabelas do documento são pequenas demais para gráficos; mostrando o texto do documento.' : 'Este documento do Word não tem tabelas; mostrando o texto, parágrafo a parágrafo. Para gráficos, use tabelas no Word ou o arquivo em Excel/CSV.'] }];
      } else for (const t of ok) t.notes = [...(t.notes ?? []), `Tabela(s) lida(s) de um documento Word (${r.tables} tabela(s)); confira os números com o documento original.`];
      if (ok.length) tables = ok;
      tables = tables.map(inferYearColumn);
      const joined = joinByYear(tables, base);
      if (joined) tables = [joined, ...tables];
      break;
    }
    case 'doc':
      throw new Error('O formato antigo .doc (Word 97-2003) não é suportado. Abra no Word e use Salvar como → Documento do Word (.docx).');
    case 'xlsx': {
      const blob = new Blob([bytes as BlobPart]);
      const sheets = await readXlsx(blob);
      tables = sheets.flatMap((sh) => toTables(sh.sheet, sh.data as unknown as unknown[][]));
      break;
    }
    default:
      throw new Error(`Formato “.${ext(fileName)}” não suportado. Use CSV, XLSX, JSON, GeoJSON, KML ou KMZ.`);
  }
  tables = tables.filter((t) => t.columns.length && t.rows.length);
  if (!tables.length) throw new Error('Nenhum dado tabular encontrado no arquivo.');
  for (const t of tables) {
    info.rowsRead += t.rows.length;
    info.rowsDropped += t.stats?.dropped ?? 0;
    info.truncated += t.stats?.truncated ?? 0;
  }
  return { fileName, tables, info };
}

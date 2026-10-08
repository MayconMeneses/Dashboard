import { XMLParser } from 'fast-xml-parser';
import { unzipSync, strFromU8 } from 'fflate';
import Papa from 'papaparse';
import readXlsx from 'read-excel-file/browser';
import { detectRepeatedBlocks } from './grid.js';
import { pdfToMatrix } from './pdf.js';
import type { Cell, Dataset, Row, Table } from './types.js';

const MAX_BYTES = 50 * 1024 * 1024;
const MAX_ROWS = 200_000;

const ext = (n: string) => n.toLowerCase().split('.').pop() ?? '';

function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n, i) => {
    const base = (n ?? '').toString().trim() || `Coluna ${i + 1}`;
    const c = seen.get(base) ?? 0;
    seen.set(base, c + 1);
    return c ? `${base} (${c + 1})` : base;
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
  const rows2 = matrix.filter((r) => r.some((c) => c != null && String(c).trim() !== ''));
  if (!rows2.length) return { name, columns: [], rows: [] };
  const columns = uniqueNames((rows2[0] as unknown[]).map((c) => String(c ?? '')));
  const rows: Row[] = rows2.slice(1, MAX_ROWS + 1).map((r) => {
    const o: Row = {};
    columns.forEach((c, i) => (o[c] = clean(r[i])));
    return o;
  });
  return { name, columns, rows };
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
    const maxFilled = Math.max(...g.map(filledCount));
    if (g.length < 3 || maxFilled < 3) {
      loose.push(...texts(g));
      continue;
    }
    const start = g.findIndex((r) => filledCount(r) >= Math.ceil(maxFilled * 0.6));
    const body = g.slice(start);
    if (body.length < 3) {
      loose.push(...texts(g));
      continue;
    }
    const used = new Set<number>();
    body.forEach((r) => r.forEach((c, i) => c != null && String(c).trim() !== '' && used.add(i)));
    const cols = [...used].sort((a, b) => a - b);
    const t = toTableSimple(`${name} · bloco ${blocks.length + 1}`, body.map((r) => cols.map((i) => r[i])));
    if (t.columns.length >= 3 && t.rows.length >= 3) {
      if (start > 0) t.title = texts(g.slice(0, start))[0];
      blocks.push(t);
    } else loose.push(...texts(g));
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
  return { name, columns, rows };
}

function parseCsv(name: string, text: string): Table[] {
  const res = Papa.parse<unknown[]>(text.replace(/^﻿/, ''), { skipEmptyLines: false });
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
  const files = unzipSync(bytes, { filter: (f) => f.originalSize < MAX_BYTES });
  const kml = Object.keys(files).find((k) => k.toLowerCase().endsWith('.kml'));
  if (!kml) throw new Error('KMZ sem arquivo .kml.');
  return parseKmlText(name, strFromU8(files[kml]!));
}

/** Lê qualquer formato suportado e devolve as tabelas encontradas (uma por aba/lista). */
export interface ParseOptions {
  /** biblioteca pdf.js já configurada (no navegador, com o worker embutido) */
  pdfjs?: Parameters<typeof pdfToMatrix>[0];
}

export async function parseFile(fileName: string, bytes: Uint8Array, opts: ParseOptions = {}): Promise<Dataset> {
  if (bytes.byteLength > MAX_BYTES) throw new Error('Arquivo maior que 50 MB.');
  const base = fileName.replace(/\.[^.]+$/, '');
  const text = () => new TextDecoder('utf-8').decode(bytes);
  let tables: Table[];
  switch (ext(fileName)) {
    case 'csv':
    case 'tsv':
    case 'txt':
      tables = parseCsv(base, text());
      break;
    case 'json':
    case 'geojson':
      tables = parseJson(base, text());
      break;
    case 'kml':
      tables = parseKmlText(base, text());
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
  return { fileName, tables };
}

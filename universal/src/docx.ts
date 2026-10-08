import { strFromU8, unzipSync } from 'fflate';
import { XMLParser } from 'fast-xml-parser';

export interface DocxResult {
  /** parágrafos soltos viram linhas de 1 célula; cada tabela vira linhas de células; linha em branco após cada tabela */
  matrix: string[][];
  tables: number;
  paragraphs: string[];
}

type Node = Record<string, unknown>;

const MAX_XML = 60 * 1024 * 1024;

const children = (n: Node, tag: string): Node[] => {
  const v = n[tag];
  return Array.isArray(v) ? (v as Node[]) : [];
};

/** Junta o texto de um nó (runs, tabulações, quebras) na ordem do documento, sem entrar em tabelas aninhadas. */
function rawText(nodes: Node[]): string {
  let out = '';
  for (const n of nodes) {
    for (const [tag, val] of Object.entries(n)) {
      if (tag === ':@') continue;
      if (tag === '#text') out += String(val);
      else if (tag === 'w:t') out += rawText(val as Node[]);
      else if (tag === 'w:tab') out += ' ';
      else if (tag === 'w:br' || tag === 'w:cr') out += ' ';
      else if (tag === 'w:tbl') continue;
      else if (Array.isArray(val)) out += rawText(val as Node[]);
    }
  }
  return out;
}

const textOf = (nodes: Node[]) => rawText(nodes).replace(/\s+/g, ' ').trim();

function cellsOf(tr: Node[]): string[] {
  const row: string[] = [];
  for (const c of tr) {
    const tc = c['w:tc'] as Node[] | undefined;
    if (!tc) continue;
    const text = textOf(tc);
    row.push(text);
    const props = tc.find((x) => x['w:tcPr'])?.['w:tcPr'] as Node[] | undefined;
    const span = Number(((props?.find((x) => x['w:gridSpan']) as Node | undefined)?.[':@'] as Record<string, string> | undefined)?.['@_w:val'] ?? 1);
    for (let i = 1; i < span; i++) row.push('');
  }
  return row;
}

export function docxToMatrix(bytes: Uint8Array): DocxResult {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (f) => f.name === 'word/document.xml' && f.originalSize < MAX_XML });
  } catch {
    throw new Error('Arquivo .docx inválido ou corrompido.');
  }
  const doc = files['word/document.xml'];
  if (!doc) throw new Error('Este arquivo não parece um documento do Word (.docx).');
  const xml = strFromU8(doc);
  if (/<!DOCTYPE/i.test(xml)) throw new Error('Documento com DOCTYPE não é aceito por segurança.');
  const parsed = new XMLParser({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: '@_', processEntities: true, trimValues: false }).parse(xml) as Node[];
  const body = children(parsed.find((n) => n['w:document']) as Node, 'w:document').find((n) => n['w:body']) as Node | undefined;
  const items = body ? children(body, 'w:body') : [];
  const matrix: string[][] = [];
  const paragraphs: string[] = [];
  let tables = 0;
  for (const it of items) {
    if (it['w:p']) {
      const t = textOf(it['w:p'] as Node[]);
      if (t) {
        matrix.push([t]);
        paragraphs.push(t);
      }
    } else if (it['w:tbl']) {
      tables++;
      for (const tr of children(it, 'w:tbl')) {
        const cells = tr['w:tr'] ? cellsOf(tr['w:tr'] as Node[]) : null;
        if (cells && cells.some((c) => c !== '')) matrix.push(cells);
      }
      matrix.push([]);
    }
  }
  return { matrix, tables, paragraphs };
}

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
      else if (tag === 'w:tbl' || tag === 'w:drawing' || tag === 'w:pict' || tag === 'mc:AlternateContent' || tag === 'w:instrText') continue;
      else if (Array.isArray(val)) out += rawText(val as Node[]);
    }
  }
  return out;
}

const textOf = (nodes: Node[]) => rawText(nodes).replace(/\s+/g, ' ').trim();

interface Cell2 {
  text: string;
  /** 'restart' = início de mesclagem vertical, 'cont' = continuação */
  vm?: 'restart' | 'cont';
}

function cellsOf(tr: Node[]): Cell2[] {
  const row: Cell2[] = [];
  for (const c of tr) {
    const tc = c['w:tc'] as Node[] | undefined;
    if (!tc) continue;
    const text = textOf(tc);
    const props = tc.find((x) => x['w:tcPr'])?.['w:tcPr'] as Node[] | undefined;
    const attr = (tag: string) => (props?.find((x) => x[tag]) as Node | undefined)?.[':@'] as Record<string, string> | undefined;
    const span = Number(attr('w:gridSpan')?.['@_w:val'] ?? 1);
    const vmNode = props?.find((x) => x['w:vMerge']);
    const vm = vmNode ? (attr('w:vMerge')?.['@_w:val'] === 'restart' ? 'restart' : 'cont') : undefined;
    row.push({ text, vm });
    for (let i = 1; i < span; i++) row.push({ text: '' });
  }
  return row;
}

/**
 * Células mescladas na vertical: o texto fica só na primeira célula. Quando a célula do cabeçalho é um rótulo
 * que vale para as linhas abaixo (ex.: o nome do município), o texto é repetido em cada linha de dados
 * e a coluna ganha um nome; linhas vazias que só continuam a mesclagem não recebem nada.
 */
function fillMerged(rows: Cell2[][], labelName: string): string[][] {
  const out = rows.map((r) => r.map((c) => c.text));
  const width = Math.max(0, ...rows.map((r) => r.length));
  for (let col = 0; col < width; col++) {
    for (let i = 0; i < rows.length; i++) {
      const c = rows[i]![col];
      if (c?.vm !== 'restart' || !c.text) continue;
      let j = i + 1;
      while (rows[j]?.[col]?.vm === 'cont') j++;
      if (j - i < 3) continue;
      // só preenche abaixo de um cabeçalho cujas vizinhas também são texto (rótulo de coluna), e só em linhas com dados
      const neighbours = rows[i]!.filter((x, k) => k !== col && x.text);
      const isHeader = neighbours.length >= 2 && neighbours.every((x) => !/^[-+\d.,%\s]+$/.test(x.text));
      if (!isHeader) continue;
      const label = c.text;
      for (let k = i + 1; k < j; k++) {
        const hasData = rows[k]!.some((x, m) => m !== col && x.text && x.vm !== 'cont');
        if (hasData) out[k]![col] = label;
      }
      out[i]![col] = labelName;
    }
  }
  return out;
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
  const parsed = new XMLParser({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: '@_', processEntities: true, trimValues: false, parseTagValue: false, parseAttributeValue: false }).parse(xml) as Node[];
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
      const rows: Cell2[][] = [];
      for (const tr of children(it, 'w:tbl')) if (tr['w:tr']) rows.push(cellsOf(tr['w:tr'] as Node[]));
      const hasMunicipio = paragraphs.some((p) => /munic[ií]pio/i.test(p));
      for (const cells of fillMerged(rows, hasMunicipio ? 'Município' : 'Grupo')) if (cells.some((c) => c !== '')) matrix.push(cells);
      matrix.push([]);
    }
  }
  return { matrix, tables, paragraphs };
}

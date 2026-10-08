/** Extração de tabelas de PDF com texto (não faz OCR de PDFs escaneados). */

interface Item {
  str: string;
  transform: number[];
  width: number;
}
interface PdfLib {
  getDocument(src: { data: Uint8Array }): { promise: Promise<{ numPages: number; getPage(n: number): Promise<{ getTextContent(): Promise<{ items: unknown[] }> }> }> };
}

export interface PdfResult {
  /** matriz de células por linha, com uma linha em branco entre páginas */
  matrix: string[][];
  pages: number;
  /** true quando nenhuma página tem linhas com 3 ou mais colunas (texto corrido) */
  textOnly: boolean;
  lines: { page: number; text: string }[];
}

const Y_TOL = 3;

/** Agrupa os itens de texto de uma página em linhas (por posição vertical) e células (por espaços largos). */
function pageRows(items: Item[]): { cells: { x: number; end: number; text: string }[] }[] {
  const real = items.filter((i) => i.str.trim() !== '');
  real.sort((a, b) => b.transform[5]! - a.transform[5]! || a.transform[4]! - b.transform[4]!);
  const lines: Item[][] = [];
  for (const it of real) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last[0]!.transform[5]! - it.transform[5]!) <= Y_TOL) last.push(it);
    else lines.push([it]);
  }
  return lines.map((l) => {
    l.sort((a, b) => a.transform[4]! - b.transform[4]!);
    const cells: { x: number; end: number; text: string }[] = [];
    for (const it of l) {
      const x = it.transform[4]!;
      const size = Math.abs(it.transform[0]!) || 10;
      const prev = cells[cells.length - 1];
      if (prev && x - prev.end < size * 0.9) {
        prev.text += (x - prev.end > size * 0.15 ? ' ' : '') + it.str.trim();
        prev.end = x + it.width;
      } else cells.push({ x, end: x + it.width, text: it.str.trim() });
    }
    return { cells };
  });
}

/** Constrói colunas unindo intervalos horizontais sobrepostos de todas as linhas "de tabela" da página. */
function columnsOf(rows: { cells: { x: number; end: number }[] }[]): [number, number][] {
  const ivs = rows.filter((r) => r.cells.length >= 2).flatMap((r) => r.cells.map((c) => [c.x, c.end] as [number, number])).sort((a, b) => a[0] - b[0]);
  const cols: [number, number][] = [];
  for (const iv of ivs) {
    const last = cols[cols.length - 1];
    if (last && iv[0] <= last[1] - 1) last[1] = Math.max(last[1], iv[1]);
    else cols.push([iv[0], iv[1]]);
  }
  return cols;
}

export async function pdfToMatrix(pdfjs: PdfLib, bytes: Uint8Array): Promise<PdfResult> {
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  const matrix: string[][] = [];
  const lines: { page: number; text: string }[] = [];
  let tableLines = 0;
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const rows = pageRows(content.items.filter((i): i is Item => typeof (i as Item).str === 'string'));
    const cols = columnsOf(rows);
    for (const r of rows) {
      lines.push({ page: p, text: r.cells.map((c) => c.text).join(' ') });
      if (r.cells.length >= 3) tableLines++;
      const out = new Array<string>(cols.length).fill('');
      for (const c of r.cells) {
        const mid = (c.x + c.end) / 2;
        let k = cols.findIndex(([a, b]) => mid >= a - 1 && mid <= b + 1);
        if (k < 0) k = cols.reduce((best, [a, b], i) => (Math.abs((a + b) / 2 - mid) < Math.abs((cols[best]![0] + cols[best]![1]) / 2 - mid) ? i : best), 0);
        out[k] = out[k] ? `${out[k]} ${c.text}` : c.text;
      }
      matrix.push(out);
    }
    matrix.push([]);
  }
  return { matrix, pages: doc.numPages, textOnly: tableLines < 3, lines };
}

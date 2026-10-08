import type { Content, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces';
import type { ColType } from './types.js';

export interface StateForReport {
  filters: Record<string, string>;
  dateRange: { col?: string; from?: string; to?: string };
  merges: Record<string, Record<string, string>>;
  forced: Record<string, ColType>;
  removed: string[];
  renames?: Record<string, string>;
  units?: Record<string, string>;
  metrics?: { name: string; unit?: string; formula: string }[];
  locale: { dateOrder: 'dmy' | 'mdy'; numbers: 'br' | 'us' };
}

const TYPE_PT: Record<string, string> = { number: 'número', integer: 'inteiro', date: 'data', category: 'categoria', boolean: 'sim/não', text: 'texto', id: 'identificador', lat: 'latitude', lon: 'longitude' };

export function formatBytes(n: number): string {
  if (n >= 1048576) return `${(n / 1048576).toFixed(1).replace('.', ',')} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

/** Descreve em frases, para o relatório, tudo o que o usuário filtrou, corrigiu ou escolheu. */
export function describeState(s: StateForReport): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(s.filters)) out.push(`Filtro por clique: ${k} = ${v}`);
  if (s.dateRange.col && (s.dateRange.from || s.dateRange.to)) {
    const f = (d?: string) => (d ? d.split('-').reverse().join('/') : '…');
    out.push(`Período em “${s.dateRange.col}”: de ${f(s.dateRange.from)} até ${f(s.dateRange.to)} (linhas sem data ficam fora)`);
  }
  for (const [col, map] of Object.entries(s.merges)) out.push(`Grafias unificadas em “${col}”: ${Object.entries(map).map(([a, b]) => `“${a}” → “${b}”`).join(', ')}`);
  for (const [col, t] of Object.entries(s.forced)) out.push(`Tipo da coluna “${col}” definido manualmente: ${TYPE_PT[t] ?? t}`);
  for (const [a, b] of Object.entries(s.renames ?? {})) if (b && b !== a) out.push(`Campo renomeado: “${a}” → “${b}”`);
  for (const [c, u] of Object.entries(s.units ?? {})) if (u) out.push(`Unidade de “${c}”: ${u}`);
  for (const m of s.metrics ?? []) out.push(`Métrica própria “${m.name}${m.unit ? ` (${m.unit})` : ''}” = ${m.formula}`);
  if (s.removed.length) out.push(`${s.removed.length} gráfico(s) removido(s) do painel pelo usuário`);
  out.push(`Interpretação regional: datas com barra como ${s.locale.dateOrder === 'dmy' ? 'dia/mês/ano' : 'mês/dia/ano'}; números com ${s.locale.numbers === 'br' ? 'ponto de milhar e vírgula decimal (padrão brasileiro)' : 'vírgula de milhar e ponto decimal (padrão americano)'}`);
  return out;
}

// ---------------------------------------------------------------------------------------------
// PDF de verdade (texto selecionável, tabelas, páginas numeradas), gerado no próprio painel.
// ---------------------------------------------------------------------------------------------
export interface ReportChart {
  title: string;
  /** descrição, definição da taxa etc., na ordem em que devem aparecer */
  paragraphs: string[];
  insight?: string;
  why?: string;
  howTo?: string;
  /** imagens dos gráficos (um ou vários, como nos gráficos pequenos) */
  images: { title?: string; dataUrl: string }[];
  heat?: { rows: string[]; cols: string[]; cells: (number | null)[][]; min: number; max: number };
  note?: string;
}

export interface ReportModel {
  title: string;
  generatedAt: string;
  version: string;
  origin: [string, string][];
  records: [string, string][];
  adjustments: string[];
  kpis: [string, string][];
  charts: ReportChart[];
  criteria: string[];
  limits: string[];
  reproduce: string;
  sample?: { columns: string[]; rows: string[][] };
}

/** A fonte do PDF (Roboto) não tem setas, ✓ nem triângulos: troca por equivalentes simples. */
export const pdfText = (s: string) => s.replace(/→/g, '->').replace(/[▲▼]/g, '').replace(/✓/g, 'ok').replace(/ /g, ' ');

const COLORS = { ink: '#1f2937', muted: '#6b7280', line: '#e5e7eb', accent: '#2563eb', head: '#f3f4f6' };

function heatColor(v: number, min: number, max: number): { fill: string; text: string } {
  const f = max > min ? (v - min) / (max - min) : 1;
  // mistura branco -> azul (#2563eb), igual ao mapa de calor da tela
  const a = 0.08 + f * 0.82;
  const mix = (c: number) => Math.round(255 + (c - 255) * a);
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  return { fill: `#${hex(mix(0x25))}${hex(mix(0x63))}${hex(mix(0xeb))}`, text: f > 0.55 ? '#ffffff' : COLORS.ink };
}

const kv = (rows: [string, string][]): Content => ({
  table: { widths: [150, '*'], body: rows.map(([k, v]) => [{ text: pdfText(k), color: COLORS.muted }, { text: pdfText(v) }] as TableCell[]) },
  layout: 'lightHorizontalLines',
  margin: [0, 0, 0, 6],
});

const bullets = (items: string[]): Content => (items.length ? { ul: items.map((x) => pdfText(x)), margin: [0, 0, 0, 6] } : { text: 'Nenhum.', color: COLORS.muted, margin: [0, 0, 0, 6] });

function chartBlock(c: ReportChart): Content {
  const stack: Content[] = [{ text: pdfText(c.title), style: 'h3' }];
  for (const p of c.paragraphs) if (p) stack.push({ text: pdfText(p), color: COLORS.muted, margin: [0, 0, 0, 3] });
  if (c.insight) stack.push({ text: [{ text: 'Destaque: ', bold: true }, pdfText(c.insight)], margin: [0, 2, 0, 3] });
  if (c.why) stack.push({ text: [{ text: 'Por que este gráfico: ', bold: true }, pdfText(c.why)], fontSize: 8.5, color: COLORS.muted, margin: [0, 0, 0, 2] });
  if (c.howTo) stack.push({ text: [{ text: 'Como ler: ', bold: true }, pdfText(c.howTo)], fontSize: 8.5, color: COLORS.muted, margin: [0, 0, 0, 4] });
  if (c.heat) {
    const h = c.heat;
    const fs = h.cols.length > 12 ? 6.5 : 8;
    const head: TableCell[] = [{ text: '', fillColor: COLORS.head }, ...h.cols.map((x) => ({ text: pdfText(x), bold: true, fontSize: fs, alignment: 'center' as const, fillColor: COLORS.head }))];
    const body: TableCell[][] = h.rows.map((r, ri) => [
      { text: pdfText(r), bold: true, fontSize: fs, fillColor: COLORS.head },
      ...h.cells[ri]!.map((v): TableCell => {
        if (v == null || Number.isNaN(v)) return { text: '—', alignment: 'center', color: COLORS.muted, fontSize: fs };
        const col = heatColor(v, h.min, h.max);
        return { text: new Intl.NumberFormat('pt-BR').format(v), alignment: 'center', fontSize: fs, fillColor: col.fill, color: col.text };
      }),
    ]);
    stack.push({ table: { headerRows: 1, widths: ['auto', ...h.cols.map(() => '*')], body: [head, ...body] }, layout: { hLineColor: () => '#ffffff', vLineColor: () => '#ffffff' }, margin: [0, 2, 0, 2] });
    stack.push({ text: '— = sem dado (não é zero). Cor mais escura = valor maior.', fontSize: 8, color: COLORS.muted });
  } else if (c.images.length === 1) {
    stack.push({ image: c.images[0]!.dataUrl, fit: [515, 235], margin: [0, 2, 0, 2] });
  } else if (c.images.length > 1) {
    for (let i = 0; i < c.images.length; i += 3) {
      const row = c.images.slice(i, i + 3);
      stack.push({
        columns: row.map((im) => ({ stack: [{ text: pdfText(im.title ?? ''), fontSize: 8, bold: true }, { image: im.dataUrl, fit: [165, 105] }] })),
        columnGap: 8,
        margin: [0, 2, 0, 4],
      });
    }
  }
  if (c.note) stack.push({ text: pdfText(c.note), italics: true, color: COLORS.muted, fontSize: 8.5 });
  return { stack, unbreakable: c.images.length > 0 || !!c.heat, margin: [0, 0, 0, 10] };
}

/** Monta a definição do documento PDF (pdfmake) a partir do modelo do relatório. */
export function buildPdfDoc(m: ReportModel): TDocumentDefinitions {
  const content: Content[] = [
    { text: pdfText(m.title), style: 'h1' },
    { text: `Relatório gerado em ${m.generatedAt} · Dashboard Universal ${m.version}`, color: COLORS.muted, margin: [0, 0, 0, 10] },
    { text: '1. Origem dos dados', style: 'h2' },
    kv(m.origin),
    { text: '2. Registros analisados', style: 'h2' },
    kv(m.records),
    { text: '3. Filtros, período e ajustes aplicados', style: 'h2' },
    bullets(m.adjustments),
    { text: '4. Indicadores', style: 'h2' },
    kv(m.kpis),
    { text: '5. Gráficos', style: 'h2', pageBreak: 'before' },
    ...m.charts.map(chartBlock),
    { text: '6. Critérios de cálculo', style: 'h2' },
    bullets(m.criteria),
    { text: '7. Limitações e avisos', style: 'h2' },
    bullets(m.limits),
    { text: '8. Como reproduzir', style: 'h2' },
    { text: pdfText(m.reproduce), margin: [0, 0, 0, 6] },
  ];
  if (m.sample && m.sample.rows.length) {
    content.push({ text: 'Anexo A. Amostra dos dados analisados', style: 'h2' }, {
      text: `Primeiras ${m.sample.rows.length} linhas (após filtros e ajustes), em até ${m.sample.columns.length} colunas.`,
      color: COLORS.muted,
      margin: [0, 0, 0, 4],
    }, {
      table: { headerRows: 1, widths: m.sample.columns.map(() => '*'), body: [m.sample.columns.map((c) => ({ text: pdfText(c), bold: true, fillColor: COLORS.head, fontSize: 8 })), ...m.sample.rows.map((r) => r.map((c) => ({ text: pdfText(c), fontSize: 8 })))] },
      layout: 'lightHorizontalLines',
    });
  }
  return {
    info: { title: pdfText(m.title), author: 'Dashboard Universal', subject: 'Relatório de análise de dados', creator: `Dashboard Universal ${m.version}` },
    pageSize: 'A4',
    pageMargins: [40, 48, 40, 46],
    defaultStyle: { fontSize: 9.5, color: COLORS.ink, lineHeight: 1.15 },
    styles: {
      h1: { fontSize: 18, bold: true, margin: [0, 0, 0, 4] },
      h2: { fontSize: 12.5, bold: true, color: COLORS.accent, margin: [0, 12, 0, 5] },
      h3: { fontSize: 10.5, bold: true, margin: [0, 4, 0, 2] },
    },
    footer: (page: number, pages: number): Content => ({
      columns: [{ text: pdfText(`${m.title} · Dashboard Universal ${m.version}`), alignment: 'left' }, { text: `Página ${page} de ${pages}`, alignment: 'right' }],
      margin: [40, 14, 40, 0],
      fontSize: 8,
      color: COLORS.muted,
    }),
    content,
  };
}

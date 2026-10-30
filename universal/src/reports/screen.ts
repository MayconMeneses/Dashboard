import type { Chart } from 'chart.js';
import type L from 'leaflet';
import { $, el } from '../app/dom.js';
import { cellText } from '../app/format.js';
import { delimiterName } from '../csv.js';
import { snapshotPng } from '../design/chartTheme.js';
import { currentMode } from '../design/theme.js';
import type { LocaleInfo } from '../profile.js';
import { applyTemplate, buildPdfDoc, describeState, formatBytes } from '../report.js';
import type { ReportTemplate } from '../report.js';
import { buildTerritory } from './territory.js';
import { comEsqueleto } from '../app/esqueleto.js';
import type { ReportChart, ReportModel } from '../report.js';
import { kpis, qualityAlerts } from '../suggest.js';
import type { ChartSpec, ColProfile, Dataset, Table } from '../types.js';

/** Tudo o que o relatório lê da tela, passado explicitamente (o módulo não conhece o estado do painel). */
export interface ReportContext {
  dataset: Dataset;
  /** tabela em análise (com título) */
  table: Table;
  /** tabela com ajustes (grafias unificadas, renomes, métricas) e sem filtros */
  full: Table;
  /** linhas após filtros e período */
  view: Table;
  charts: Chart[];
  maps: L.Map[];
  specs: ChartSpec[];
  prof: ColProfile[];
  kpiProf: ColProfile[];
  loc: LocaleInfo | undefined;
  state: Parameters<typeof describeState>[0];
}

/** Texto de cada cartão de gráfico + imagens em alta resolução, lidos da tela para montar o PDF. */
export function collectChart(card: HTMLElement, charts: Chart[]): ReportChart {
  const text = (sel: string) => (card.querySelector(sel) as HTMLElement | null)?.innerText.trim() ?? '';
  const paragraphs: string[] = [];
  const desc = card.children[1] as HTMLElement | undefined;
  if (desc?.tagName === 'P') paragraphs.push(desc.innerText.trim());
  const rate = card.querySelector('.rate-pick .muted') as HTMLElement | null;
  if (rate) paragraphs.push(rate.innerText.trim());
  const howto = [...card.querySelectorAll('.howto p')].map((x) => (x.textContent ?? '').trim());
  const strip = (s: string | undefined, label: string) => (s ?? '').replace(new RegExp(`^${label}\\s*`), '');
  const chart: ReportChart = {
    title: text('h3'),
    paragraphs,
    insight: strip(text('.insight'), 'Destaque:') || undefined,
    why: strip(howto[0], 'Por que:') || undefined,
    howTo: strip(howto[1], 'Como ler:') || undefined,
    images: [],
  };
  if (card.dataset.heat) chart.heat = JSON.parse(card.dataset.heat) as ReportChart['heat'];
  else if (card.querySelector('.map')) chart.note = 'Mapa omitido do relatório (depende de imagens externas); veja o painel.';
  else {
    for (const cv of card.querySelectorAll('canvas')) {
      const inst = charts.find((c) => c.canvas === cv);
      let url = '';
      try {
        url = snapshotPng(charts, cv as HTMLCanvasElement, currentMode(), inst ? 2.5 : undefined);
      } catch {
        /* sem imagem */
      }
      if (url) chart.images.push({ title: cv.closest('.small-cell')?.querySelector('.small-title')?.textContent ?? undefined, dataUrl: url });
    }
  }
  return chart;
}

export function buildReportModel(ctx: ReportContext): ReportModel {
  const { dataset, table, full, view: t } = ctx;
  const info = dataset.info;
  const n = (x: number) => new Intl.NumberFormat('pt-BR').format(x);
  const origin: [string, string][] = [['Arquivo', dataset.fileName]];
  if (info) {
    origin.push(['Formato', `.${info.format}`], ['Tamanho', formatBytes(info.bytes)]);
    if (info.sha256) origin.push(['SHA-256 do arquivo original', info.sha256]);
    if (info.readAt) origin.push(['Lido em', new Date(info.readAt).toLocaleString('pt-BR')]);
    if (info.encoding) origin.push(['Codificação do texto', info.encoding]);
    if (info.delimiter) origin.push(['Separador de colunas', delimiterName(info.delimiter)]);
  }
  if (dataset.sources) dataset.sources.forEach((src, i) => origin.push([`Fonte ${i + 1}`, `${src.fileName ?? '?'} (.${src.format}, ${formatBytes(src.bytes)})`], [`SHA-256 da fonte ${i + 1}`, src.sha256 ?? 'não calculado']));
  if (table.joined) origin.push(['Relação entre tabelas', `${table.joined.kind === 'pontos' ? 'pontos dentro de polígonos' : `chave “${table.joined.leftKey}” = “${table.joined.rightKey}”`}: ${table.joined.left} + ${table.joined.right}`]);
  origin.push(['Tabela analisada', `${table.title ?? table.name} (${n(table.rows.length)} linhas, ${table.columns.length} colunas)`], ['Versão do painel', __APP_VERSION__]);
  const records: [string, string][] = [];
  if (info) records.push(['Linhas lidas (todas as tabelas)', n(info.rowsRead)], ['Linhas ignoradas (em branco ou título)', n(info.rowsDropped)], ['Linhas não lidas (acima do limite)', n(info.truncated)]);
  records.push(['Linhas da tabela analisada', n(table.rows.length)], ['Linhas após filtros e período', n(t.rows.length)]);
  const criteria: string[] = [];
  for (const sp of ctx.specs) {
    criteria.push(`${sp.title}: ${sp.description}`);
    for (const o of sp.rate?.options ?? []) criteria.push(`${o.label}: ${o.explain}`);
  }
  criteria.push('Células em branco ou com marcadores de ausência (n/d, -, s/i) são “sem dado” e nunca entram como zero.', 'Somas e médias usam só as células com valor; uma série sem nenhum valor num período aparece como lacuna.');
  const limits = [...qualityAlerts(full, ctx.prof, ctx.loc).map((a) => a.text), ...(info?.notes ?? [])];
  const cols = t.columns.slice(0, 8);
  const territory = buildTerritory(t, ctx.kpiProf);
  return {
    title: table.title ?? table.name,
    generatedAt: new Date().toLocaleString('pt-BR'),
    version: __APP_VERSION__,
    origin,
    records,
    adjustments: describeState(ctx.state),
    kpis: kpis(t, ctx.kpiProf).map((k) => [k.label, k.hint ? `${k.value} (${k.hint})` : k.value] as [string, string]),
    charts: ([...document.querySelectorAll('#charts .chart')] as HTMLElement[]).map((c) => collectChart(c, ctx.charts)),
    criteria,
    limits,
    reproduce: `Abra o mesmo arquivo no Dashboard Universal ${__APP_VERSION__} com as mesmas opções de leitura e os mesmos ajustes listados na seção 1, ou use o HTML compartilhado gerado a partir desta análise. Este relatório descreve o estado do painel no momento da geração.`,
    ...(territory ? { territory } : {}),
    sample: { columns: cols, rows: t.rows.slice(0, 40).map((r) => cols.map((c) => cellText(r[c]))) },
  };
}

/** Plano B: relatório pela impressão do navegador (usado se a geração direta do PDF falhar). */
export function openPrintReport(ctx: ReportContext) {
  const { dataset, table, full, view: t } = ctx;
  const info = dataset.info;
  const root = $('report');
  const dl = (rows: [string, string][]) => el('dl', {}, ...rows.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]));
  const list = (items: string[]) => (items.length ? el('ul', {}, ...items.map((x) => el('li', {}, x))) : el('p', { className: 'muted' }, 'Nenhum.'));

  const live = [...document.querySelectorAll('#charts .chart')] as HTMLElement[];
  const gallery = el('div', { className: 'charts' });
  for (const card of live) {
    const clone = card.cloneNode(true) as HTMLElement;
    const orig = card.querySelectorAll('canvas');
    clone.querySelectorAll('canvas').forEach((cv, i) => {
      const img = document.createElement('img');
      try {
        img.src = snapshotPng(ctx.charts, orig[i] as HTMLCanvasElement, currentMode());
      } catch {
        /* sem imagem */
      }
      cv.replaceWith(img);
    });
    clone.querySelectorAll('button, select').forEach((x) => x.remove());
    clone.querySelectorAll('.rate-pick').forEach((x) => !x.querySelector('.muted') && x.remove());
    clone.querySelectorAll('.map').forEach((x) => x.replaceWith(el('p', { className: 'muted' }, 'Mapa omitido do relatório (depende de imagens externas); veja o painel.')));
    clone.querySelectorAll('details').forEach((d) => d.setAttribute('open', ''));
    gallery.append(clone);
  }

  const criteria: string[] = [];
  for (const sp of ctx.specs) {
    criteria.push(`${sp.title}: ${sp.description}`);
    for (const o of sp.rate?.options ?? []) criteria.push(`${o.label}: ${o.explain}`);
  }
  criteria.push('Células em branco ou com marcadores de ausência (n/d, -, s/i) são “sem dado” e nunca entram como zero.', 'Somas e médias usam só as células com valor; uma série sem nenhum valor num período aparece como lacuna.');

  const alerts = qualityAlerts(full, ctx.prof, ctx.loc).map((a) => a.text);
  const limits = [...alerts, ...(info?.notes ?? [])];

  root.replaceChildren(
    el('h1', {}, table.title ?? table.name),
    el('p', { className: 'muted' }, `Arquivo: ${dataset.fileName} · Relatório gerado em ${new Date().toLocaleString('pt-BR')} · Dashboard Universal ${__APP_VERSION__}`),
    el('h2', {}, '1. Filtros, período e ajustes aplicados'),
    list(describeState(ctx.state)),
    el('h2', {}, '2. Indicadores'),
    dl(kpis(t, ctx.kpiProf).map((k) => [k.label, k.hint ? `${k.value} (${k.hint})` : k.value] as [string, string])),
    el('h2', {}, '3. Gráficos'),
    gallery,
    el('h2', {}, '4. Critérios de cálculo'),
    list(criteria),
    el('h2', {}, '5. Limitações e avisos'),
    list(limits),
    el('h2', {}, '6. Como reproduzir'),
    el('p', {}, `Abra o mesmo arquivo no Dashboard Universal ${__APP_VERSION__} com as mesmas opções de leitura e os mesmos ajustes listados na seção 1, ou use o HTML compartilhado gerado a partir desta análise. Este relatório descreve o estado do painel no momento da geração.`),
  );
  document.body.classList.add('report-mode');
  root.hidden = false;
  window.addEventListener(
    'afterprint',
    () => {
      document.body.classList.remove('report-mode');
      root.hidden = true;
      ctx.charts.forEach((c) => c.resize());
      ctx.maps.forEach((mp) => mp.invalidateSize());
    },
    { once: true },
  );
  window.print();
}

/** Relatório em PDF de verdade (texto selecionável, tabelas, páginas numeradas), gerado aqui mesmo e baixado direto. */
export async function openReport(ctx: ReportContext, fail: (m: string) => void) {
  const { dataset } = ctx;
  const btn = $('btnReport') as HTMLButtonElement;
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Gerando PDF…';
  try {
    await comEsqueleto('Gerando o PDF…', async () => {
      const tpl = (($('reportTpl') as HTMLSelectElement | null)?.value ?? 'completo') as ReportTemplate;
      const model = applyTemplate(buildReportModel(ctx), tpl);
      const [{ default: pdfMake }, vfs] = await Promise.all([import('pdfmake/build/pdfmake'), import('pdfmake/build/vfs_fonts')]);
      (pdfMake as unknown as { addVirtualFileSystem: (v: unknown) => void }).addVirtualFileSystem((vfs as { default?: unknown }).default ?? vfs);
      const base = dataset.fileName.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]+/g, '-');
      await (pdfMake as unknown as { createPdf: (d: unknown) => { download: (n: string) => Promise<void> } }).createPdf(buildPdfDoc(model)).download(`relatorio-${base}.pdf`);
    });
  } catch (e) {
    console.error(e);
    fail('Não consegui gerar o PDF direto; abrindo o relatório para impressão (use “Salvar como PDF”).');
    openPrintReport(ctx);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

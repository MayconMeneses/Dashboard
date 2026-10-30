import { Chart, registerables } from 'chart.js';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import PdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker&inline';
import { parseFile } from './parse.js';
import type { ParseOptions } from './parse.js';
import { inferLocale, locale, profileTable, toNumber } from './profile.js';
import type { LocaleInfo } from './profile.js';
import { csvField, delimiterName } from './csv.js';
import { printCharts, setChartMode } from './design/chartTheme.js';
import { PALETTE } from './design/palette.js';
import { $, download, el } from './app/dom.js';
import { columnInfo, filterNote } from './app/colsInfo.js';
import { explorerCard } from './app/explorer.js';
import { cellText } from './app/format.js';
import { initShell } from './app/shell.js';
import { diffBox } from './app/diffBox.js';
import { registry } from './charts/builtin.js';
import { dataAlt } from './charts/dataAlt.js';
import type { ChartHost } from './charts/host.js';
import { buildReportModel, openReport } from './reports/screen.js';
import type { ReportContext } from './reports/screen.js';
import { currentMode, initTheme, setPrinting } from './design/theme.js';
import type { DelimiterChoice, Encoding } from './csv.js';
import { formatBytes } from './report.js';
import { compileFormula, evalAggregate, evalRow, FormulaError } from './formula.js';
import { addMetricColumns, applyRenames, compareTables, migrateColumn, parseProject, reconcileState, serializeProject } from './project.js';
import type { Metric, ProjectState } from './project.js';
import { buildXlsx } from './xlsx.js';
import { applyMerges } from './similar.js';
import { filterByDate, pageOf, sortRows } from './tableview.js';
import type { SortDir } from './tableview.js';
import { compatibleStyles, toPercent, toPareto } from './shapes.js';
import { chartData, clickFilters, HOW_TO, HOWTO_SHAPE, insightFor, kpis, qualityAlerts, rateData, rateInsight, suggestCharts } from './suggest.js';
import type { ChartSpec, ColProfile, ColType, Dataset, Table } from './types.js';

Chart.register(...registerables);
pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();
const PDF = { pdfjs: pdfjs as unknown as NonNullable<Parameters<typeof parseFile>[2]>['pdfjs'] };

let dataset: Dataset | null = null;
let table: Table | null = null;
let charts: Chart[] = [];
let maps: L.Map[] = [];
let removed = new Set<string>();
const rateChoice: Record<string, number> = {};
const styleChoice: Record<string, string> = {};
let forced: Record<string, ColType> = {};
let filters: Record<string, string> = {};
let merges: Record<string, Record<string, string>> = {};
let dateRange: { col?: string; from?: string; to?: string } = {};
let sortState: { col: string; dir: SortDir } | null = null;
let page = 1;
let pageSize = 50;
let basemap: 'esri' | 'none' = 'esri';
let locInfo: LocaleInfo | null = null;
let lastProf: ColProfile[] = [];
let lastKpiProf: ColProfile[] = [];
let lastSpecs: ChartSpec[] = [];
let renames: Record<string, string> = {};
let units: Record<string, string> = {};
let metrics: Metric[] = [];
/** configuração a reaplicar ao próximo arquivo (projeto aberto ou "Atualizar dados") */
let carry: { state: ProjectState; oldTable?: Table; label: string } | null = null;

let mergedFor: Table | null = null;
let mergedKey = '';
let mergedVal: Table | null = null;
/** tabela com campos renomeados, grafias unificadas e métricas por linha; o original nunca é alterado */
function mergedTable(): Table {
  const key = JSON.stringify([merges, renames, metrics]);
  if (mergedVal && mergedFor === table && key === mergedKey) return mergedVal;
  mergedFor = table;
  mergedKey = key;
  mergedVal = addMetricColumns(applyMerges(applyRenames(table!, renames), merges), metrics);
  return mergedVal;
}

const currentLoc = (): LocaleInfo | undefined => {
  const li = locInfo as LocaleInfo | null;
  return li ? { ...li, dateOrder: locale.dateOrder, numbers: locale.numbers } : undefined;
};

/** linhas após os filtros (clique nos gráficos e período) */
function view(): Table {
  const base = mergedTable();
  const keys = Object.keys(filters);
  const dated = !!dateRange.col && !!(dateRange.from || dateRange.to);
  if (!keys.length && !dated) return base;
  let rows = base.rows;
  if (keys.length) rows = rows.filter((r) => keys.every((k) => String(r[k] ?? '') === filters[k]));
  if (dated) rows = filterByDate(rows, dateRange.col!, dateRange.from, dateRange.to);
  return { ...base, rows };
}

function toggleFilter(col: string, value: string) {
  if (filters[col] === value) delete filters[col];
  else filters = { ...filters, [col]: value };
  page = 1;
  render();
}
const TYPE_NAMES: Record<string, string> = { number: 'número', integer: 'inteiro', date: 'data', category: 'categoria', boolean: 'sim/não', text: 'texto', id: 'identificador', lat: 'latitude', lon: 'longitude' };

function fail(m: string) {
  $('msg').textContent = m;
}

function reset() {
  charts.forEach((c) => c.destroy());
  maps.forEach((m) => m.remove());
  charts = [];
  maps = [];
}

/** O que os desenhos de gráfico extraídos (src/charts/) usam da tela. */
const host: ChartHost = {
  addChart: (c) => charts.push(c),
  addMap: (m) => maps.push(m),
  toggleFilter: (col, value) => toggleFilter(col, value),
};

function drawChart(spec0: ChartSpec, t: Table): HTMLElement {
  let spec = spec0;
  const card = el('div', { className: 'chart' });
  const x = el('button', { className: 'x', type: 'button', title: 'Remover este gráfico', ariaLabel: 'Remover este gráfico' }, '✕');
  x.onclick = () => {
    removed.add(spec.id);
    render();
  };
  card.append(el('header', {}, el('h3', {}, spec.title), x), el('p', {}, spec.description));

  const rc = { card, spec, t, host, forced, basemap, onBasemap: (b: 'esri' | 'none') => ((basemap = b), render()) };
  const byKind = registry.forKind(spec.kind)?.(rc);
  if (byKind) return byKind;
  let periodPick: HTMLElement | null = null;
  if (spec.kind === 'part' && spec.part && !spec.part.all && spec.x) {
    // rosca de um período: o usuário escolhe qual
    const labs = t.rows.filter((r) => r[spec.x!] != null).map((r) => String(r[spec.x!]));
    const cur = Math.min(labs.length - 1, rateChoice[spec.id] ?? labs.length - 1);
    spec = { ...spec, row: cur };
    const sel = el('select', { ariaLabel: `Escolher ${spec.x}` }, ...labs.map((l, i) => el('option', { value: String(i), selected: i === cur }, l)));
    sel.onchange = () => {
      rateChoice[spec0.id] = Number(sel.value);
      render();
    };
    periodPick = el('p', { className: 'rate-pick' }, `${spec.x}: `, sel);
  }
  const d = chartData(t, spec);
  if (!d.labels.length) {
    card.append(el('p', {}, 'Sem dados suficientes para este gráfico.'));
    return card;
  }
  const rate = spec.rate ? rateData(t, spec, rateChoice[spec.id] ?? 0) : null;
  if (spec.rate && rate) {
    const sel = el('select', { ariaLabel: 'Definição de positividade' }, ...spec.rate.options.map((o, i) => el('option', { value: String(i), selected: i === (rateChoice[spec.id] ?? 0) }, o.label)));
    sel.onchange = () => {
      rateChoice[spec.id] = Number(sel.value);
      render();
    };
    card.append(el('p', { className: 'rate-pick' }, 'Positividade: ', sel, el('span', { className: 'muted' }, ' ' + rate.explain)));
  }
  // escolha do desenho: o sistema recomenda (regras em shapes.ts) e o usuário pode trocar por alternativas compatíveis
  let shape: string = spec.kind === 'pivot' ? (spec.style ?? 'bar') : spec.kind === 'part' && !spec.part?.all ? 'donut' : spec.kind === 'profile' ? 'radar' : spec.kind === 'change' ? 'hbar' : spec.kind;
  let why = spec.why ?? '';
  if ((spec.kind === 'pivot' || spec.period) && !spec.rate) {
    const opts = compatibleStyles({ ordered: !!spec.keepOrder || !!spec.period, preferBars: !!spec.period, series: d.datasets?.length ?? 0, labels: d.labels.length, positive: [...d.values, ...(d.datasets ?? []).flatMap((s) => s.values)].every((v) => Number.isNaN(v) || v >= 0) });
    const rec = opts.find((o) => o.recommended) ?? opts[0]!;
    const chosen = opts.find((o) => o.style === styleChoice[spec.id]) ?? (spec.style && spec.style !== rec.style && spec.lockStyle ? opts.find((o) => o.style === spec.style) : undefined) ?? rec;
    shape = chosen.style;
    why = `${chosen.recommended ? 'Recomendado pelo sistema: ' : ''}${chosen.why}`;
    if (opts.length > 1) {
      const sel = el('select', { ariaLabel: 'Tipo de gráfico' }, ...opts.map((o) => el('option', { value: o.style, selected: o.style === chosen.style }, o.label + (o.recommended ? ' · recomendado' : ''))));
      sel.onchange = () => {
        styleChoice[spec.id] = sel.value;
        render();
      };
      card.append(el('p', { className: 'rate-pick' }, 'Tipo de gráfico: ', sel));
    }
  }
  if (periodPick) card.append(periodPick);
  const insight = insightFor(spec, d) + (rate ? ' ' + rateInsight(rate) : '');
  card.append(el('p', { className: 'insight' }, el('b', {}, 'Destaque: '), insight));
  card.append(el('details', { className: 'howto' }, el('summary', {}, 'Por que este gráfico e como ler'), el('p', {}, el('b', {}, 'Por que: '), why || 'Escolhido pelo tipo dos dados.'), ...(spec.reasons?.length ? [el('ul', {}, ...spec.reasons.map((r) => el('li', {}, r)))] : []), el('p', {}, el('b', {}, 'Como ler: '), HOWTO_SHAPE[shape] ?? spec.howTo ?? HOW_TO[spec.kind] ?? '')));

  const byShape = registry.forShape(shape)?.({ ...rc, d });
  if (byShape) return byShape;

  const canvas = el('canvas', { role: 'img', ariaLabel: `${spec.title}. ${insight}` });
  card.append(el('div', { className: 'box' }, canvas));
  card.append(dataAlt(d.labels, d.datasets ?? [{ label: spec.y ?? 'Valor', values: d.values }]));
  const donut = shape === 'donut';
  const horizontal = shape === 'hbar';
  const percent = shape === 'percent';
  const stacked = shape === 'stacked' || percent || shape === 'area';
  const isLine = shape === 'line' || shape === 'area';
  const radar = shape === 'radar';
  const pareto = shape === 'pareto';
  const base = percent ? toPercent(d) : d;
  const overlay = d.datasets?.find((s) => s.line);
  let labels = base.labels;
  let datasets: object[];
  const colorOf = (i: number) => PALETTE[i % PALETTE.length]!;
  if (pareto) {
    const p = toPareto(d);
    labels = p.labels;
    datasets = [
      { type: 'bar', label: spec.y ?? 'Valor', data: p.values, backgroundColor: PALETTE[0], order: 1 },
      { type: 'line', label: '% acumulado', data: p.cumulative, yAxisID: 'y1', borderColor: '#D55E00', backgroundColor: '#D55E00', borderWidth: 3, pointRadius: 3, tension: 0.15, order: -1 },
    ];
  } else if (base.datasets) {
    const sets = radar ? [...base.datasets].sort((x, y) => y.values.reduce((a, v) => a + (Number.isNaN(v) ? 0 : v), 0) - x.values.reduce((a, v) => a + (Number.isNaN(v) ? 0 : v), 0)).slice(0, 6) : base.datasets;
    datasets = sets.map((s, i) => (s.line ? { type: 'line', label: s.label, data: s.values.map((v) => (Number.isNaN(v) ? null : v)), yAxisID: 'y1', borderColor: '#882255', backgroundColor: '#882255', borderWidth: 3, pointRadius: 5, tension: 0, spanGaps: false, order: -1 } : { label: s.label, data: s.values.map((v) => (Number.isNaN(v) ? null : v)), backgroundColor: radar || shape === 'area' ? colorOf(i) + '55' : colorOf(i), borderColor: colorOf(i), tension: labels.length <= 24 ? 0 : 0.25, pointRadius: isLine || radar ? 4 : 0, borderWidth: isLine || radar ? 2 : 0, fill: shape === 'area' || radar, spanGaps: false }));
  } else {
    datasets = [{ label: spec.y ?? 'Registros', data: base.values.map((v) => (Number.isNaN(v) ? null : v)), backgroundColor: donut ? labels.map((_, i) => colorOf(i)) : shape === 'area' ? PALETTE[0] + '55' : PALETTE[0], borderColor: donut ? '#ffffff' : PALETTE[0], tension: 0.25, fill: shape === 'area', barThickness: horizontal ? 14 : undefined, spanGaps: false }];
  }
  if (rate) datasets.push({ type: 'line', label: rate.name, data: rate.values.map((v) => (Number.isNaN(v) ? null : v)), yAxisID: 'y1', borderColor: '#D55E00', backgroundColor: '#D55E00', borderWidth: 3, pointRadius: 4, tension: 0.2, spanGaps: false, order: -1 });
  const type = radar ? 'radar' : isLine ? 'line' : donut ? 'doughnut' : 'bar';
  const fmt = (v: number, pct: boolean) => (pct ? `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(v)}%` : new Intl.NumberFormat('pt-BR').format(v));
  charts.push(
    new Chart(canvas, {
      type,
      data: { labels, datasets: datasets as never },
      options: {
        indexAxis: horizontal ? 'y' : 'x',
        responsive: true,
        maintainAspectRatio: false,
        onClick: (_e, els) => {
          const i = els[0]?.index;
          if (i == null || !spec.x || labels[i] == null || !clickFilters(spec)) return;
          const mm = spec.kind === 'line' ? /^(\d{4})-(\d{2})$/.exec(labels[i]!) : null;
          if (mm) {
            // gráfico de linha por mês: o clique vira filtro de período daquele mês
            const last = new Date(Date.UTC(Number(mm[1]), Number(mm[2]), 0)).getUTCDate();
            dateRange = dateRange.from === `${mm[1]}-${mm[2]}-01` ? {} : { col: spec.x, from: `${mm[1]}-${mm[2]}-01`, to: `${mm[1]}-${mm[2]}-${String(last).padStart(2, '0')}` };
            page = 1;
            render();
            return;
          }
          toggleFilter(spec.x, labels[i]!);
        },
        onHover: (e, els) => {
          const c = e.native?.target as HTMLElement | null;
          if (c) c.style.cursor = els.length && clickFilters(spec) ? 'pointer' : 'default';
        },
        plugins: {
          legend: { display: donut || radar || !!d.datasets || pareto, position: 'bottom' },
          tooltip: {
            callbacks: {
              label: (c) => {
                const v = (horizontal ? c.parsed.x : radar ? (c.parsed as { r: number }).r : c.parsed.y) as number | null;
                const pct = (c.dataset as { yAxisID?: string }).yAxisID === 'y1' || percent || spec.kind === 'change' || spec.kind === 'profile';
                return `${c.dataset.label ?? ''}: ${v == null ? 'sem dado' : fmt(v, pct)}`;
              },
              afterLabel: (c) => {
                if (!percent || !d.datasets) return '';
                const raw = d.datasets[c.datasetIndex]?.values[c.dataIndex];
                return raw == null || Number.isNaN(raw) ? '' : `(${new Intl.NumberFormat('pt-BR').format(raw)} no total)`;
              },
            },
          },
        },
        scales: donut || radar ? (radar ? { r: { beginAtZero: true } } : {}) : { x: { stacked, ...(horizontal ? { beginAtZero: true } : {}) }, y: { stacked, beginAtZero: true, ...(percent ? { max: 100, ticks: { callback: (v: string | number) => `${v}%` } } : {}) }, ...(rate || pareto || overlay ? { y1: { position: 'right', min: 0, ...(overlay ? {} : { max: 100 }), grid: { drawOnChartArea: false }, ticks: { callback: (v: string | number) => `${v}%` }, title: { display: true, text: pareto ? '% acumulado' : overlay ? overlay.label : 'Positividade (%)' } } } : {}) },
      },
    }),
  );
  return card;
}

function render() {
  if (!table) return;
  reset();
  const full = mergedTable();
  const t = view();
  const prof = profileTable(full, forced);
  lastProf = prof;
  $('ttl').textContent = full.title ?? full.name;
  $('ctx').textContent = full.context ?? '';
  const alerts = qualityAlerts(full, prof, currentLoc());
  $('chips').replaceChildren(
    ...Object.entries(filters).map(([k, v]) => {
      const b = el('button', { type: 'button', className: 'chip', title: 'Remover este filtro' }, `${k}: ${v}  ✕`);
      b.onclick = () => toggleFilter(k, v);
      return b;
    }),
  );
  ($('chips') as HTMLElement).hidden = !Object.keys(filters).length;
  const mergeNotes = Object.entries(merges).map(([col, map]) => {
    const li = el('li', { className: 'info' }, `Em “${col}”, grafias unificadas por você: ${Object.entries(map).map(([a, b]) => `“${a}” → “${b}”`).join(', ')}. `);
    const undo = el('button', { type: 'button', className: 'mini' }, 'Desfazer');
    undo.onclick = () => {
      const { [col]: _gone, ...rest } = merges;
      void _gone;
      merges = rest;
      render();
    };
    li.append(undo);
    return li;
  });
  $('alerts').replaceChildren(
    ...mergeNotes,
    ...alerts.map((a) => {
      const li = el('li', { className: a.level }, a.text);
      if (a.merge) {
        const mg = a.merge;
        const b = el('button', { type: 'button', className: 'mini' }, `Juntar como “${mg.to}”`);
        b.onclick = () => {
          merges = { ...merges, [mg.col]: { ...(merges[mg.col] ?? {}), ...Object.fromEntries(mg.values.filter((v) => v !== mg.to).map((v) => [v, mg.to])) } };
          render();
        };
        li.append(' ', b);
      }
      return li;
    }),
  );
  ($('alertsBox') as HTMLElement).hidden = !alerts.length && !mergeNotes.length;
  renderDateBar(prof);
  const metricKpis = metrics.flatMap((mt) => {
    try {
      const c = compileFormula(mt.formula, full.columns);
      return c.aggregate ? [{ label: mt.name, value: fmtMetric(evalAggregate(c, t.rows), mt.unit), hint: `Fórmula: ${mt.formula}` }] : [];
    } catch {
      return [];
    }
  });
  // tipos vêm da tabela inteira; soma, média e período acompanham as linhas filtradas
  lastKpiProf = t.rows.length === full.rows.length ? prof : profileTable(t, Object.fromEntries(prof.map((p) => [p.name, p.type])));
  const note = Object.keys(filters).length ? filterNote(prof, lastKpiProf) : null;
  $('chips').querySelector('.filter-note')?.remove();
  if (note) $('chips').append(note);
  $('kpis').replaceChildren(...[...kpis(t, lastKpiProf), ...metricKpis].map((k) => el('div', { className: 'kpi', title: k.hint ?? '' }, el('b', {}, k.value), el('span', {}, k.label))));
  renderMetrics(full, t);
  renderTools();
  const specs = suggestCharts(full, prof, Number(($('level') as HTMLSelectElement).value)).filter((s) => !removed.has(s.id));
  lastSpecs = specs;
  $('charts').replaceChildren(...(full.noCharts ? [el('div', { className: 'card' }, el('p', {}, 'Sem gráficos: este documento não tem tabelas com colunas alinhadas, só texto. O texto extraído está na tabela abaixo; para gráficos, use o arquivo original em Excel ou CSV.'))] : [...specs.map((s) => drawChart(s, t)), ...[explorerCard(full, prof, forced, (s) => drawChart(s, t), render)].filter((c): c is HTMLElement => c != null)]));
  renderTable();
  const th = ['Coluna (pode renomear)', 'Unidade', 'Tipo (pode corrigir)', 'Preenchidas', 'Vazias', 'Valores distintos', 'Valores inválidos', 'Papel e origem'];
  const info = columnInfo(full, prof, { renames, forced, units, merges, metrics });
  $('cols').replaceChildren(
    el('thead', {}, el('tr', {}, ...th.map((h) => el('th', {}, h)))),
    el(
      'tbody',
      {},
      ...prof.map((p) => {
        const sel = el('select', { ariaLabel: `Tipo da coluna ${p.name}` }, ...Object.entries(TYPE_NAMES).map(([v, n]) => el('option', { value: v, selected: v === p.type }, n)));
        sel.onchange = () => {
          forced = { ...forced, [p.name]: sel.value as ColType };
          removed = new Set();
          render();
        };
        const isMetric = metrics.some((mt) => mt.name === p.name || `${mt.name} (métrica)` === p.name);
        const nameIn = el('input', { type: 'text', value: p.name, ariaLabel: `Nome da coluna ${p.name}`, disabled: isMetric, className: 'cell-in' });
        // re-renderiza depois do evento: trocar o campo com foco dentro do próprio handler dispara blur no nó removido
        nameIn.onchange = () => setTimeout(() => renameColumn(p.name, nameIn.value), 0);
        const unitIn = el('input', { type: 'text', value: units[p.name] ?? '', placeholder: '—', ariaLabel: `Unidade da coluna ${p.name}`, className: 'cell-in short' });
        unitIn.onchange = () => {
          units = unitIn.value.trim() ? { ...units, [p.name]: unitIn.value.trim() } : Object.fromEntries(Object.entries(units).filter(([k]) => k !== p.name));
          setTimeout(render, 0);
        };
        return el('tr', {}, el('td', {}, nameIn), el('td', {}, unitIn), el('td', {}, sel), el('td', {}, String(p.filled)), el('td', {}, String(p.missing)), el('td', {}, String(p.unique)), el('td', {}, p.invalidCount ? `${p.invalidCount} (ex.: linha ${p.invalid![0]!.row}: “${p.invalid![0]!.value}”)` : '—'), info.get(p.name) ?? el('td', {}));
      }),
    ),
  );
}

const unitOf = (c: string) => units[c] ?? (lastProf.find((p) => p.name === c)?.percent ? '%' : undefined);
const withUnit = (c: string) => (unitOf(c) ? `${c} (${unitOf(c)})` : c);
const fmtMetric = (v: number | null, unit?: string) => (v == null ? 'sem dado' : `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(v)}${unit ? ' ' + unit : ''}`);

/** Renomeia um campo e leva junto filtros, tipos, junções, período e fórmulas que o citam. */
function renameColumn(cur: string, next: string) {
  const name = next.trim();
  if (!name || name === cur) return;
  const exists = mergedTable().columns.includes(name);
  if (exists) {
    fail(`Já existe uma coluna chamada “${name}”. Escolha outro nome.`);
    render();
    return;
  }
  const orig = Object.keys(renames).find((k) => renames[k] === cur) ?? cur;
  if (name === orig) delete renames[orig];
  else renames = { ...renames, [orig]: name };
  const s = migrateColumn({ forced, filters, merges, units, dateRange, metrics }, cur, name);
  forced = (s.forced ?? {}) as Record<string, ColType>;
  filters = s.filters ?? {};
  merges = s.merges ?? {};
  units = s.units ?? {};
  dateRange = s.dateRange ?? {};
  metrics = s.metrics ?? [];
  if (sortState?.col === cur) sortState = { ...sortState, col: name };
  $('msg').textContent = '';
  render();
}

function renderMetrics(full: Table, t: Table) {
  const box = $('metricsBox');
  const cols = full.columns;
  const list = el('div', {});
  for (const mt of metrics) {
    let res = '';
    try {
      const c = compileFormula(mt.formula, cols.filter((x) => !metrics.some((o) => o.name === x) || true));
      res = c.aggregate ? `Indicador: ${fmtMetric(evalAggregate(c, t.rows), mt.unit)}` : `Coluna criada em todas as linhas (ex.: ${fmtMetric(t.rows[0] ? evalRow(c, t.rows[0]) : null, mt.unit)})`;
    } catch (e) {
      res = `Fórmula com problema: ${e instanceof Error ? e.message : ''}`;
    }
    const rm = el('button', { type: 'button', className: 'mini' }, 'Remover');
    rm.onclick = () => ((metrics = metrics.filter((o) => o.id !== mt.id)), render());
    list.append(el('div', { className: 'metric-row' }, el('b', {}, mt.name + (mt.unit ? ` (${mt.unit})` : '')), el('code', {}, mt.formula), el('span', { className: 'muted' }, ' → ' + res), rm));
  }
  const name = el('input', { type: 'text', placeholder: 'Ex.: Taxa por 100 mil', ariaLabel: 'Nome da métrica', maxLength: 60 });
  const unit = el('input', { type: 'text', placeholder: 'unidade (opcional)', ariaLabel: 'Unidade da métrica', maxLength: 20, className: 'short' });
  const formula = el('input', { type: 'text', placeholder: 'Ex.: [Notificados] / [População] * 100000', ariaLabel: 'Fórmula da métrica', className: 'wide' });
  const msg = el('p', { className: 'muted', role: 'status' });
  const chips = el('div', { className: 'chips-cols' }, ...cols.slice(0, 24).map((c) => {
    const b = el('button', { type: 'button', className: 'mini' }, `[${c}]`);
    b.onclick = () => ((formula.value += `[${c}]`), formula.focus());
    return b;
  }));
  const test = el('button', { type: 'button' }, 'Testar');
  const add = el('button', { type: 'button', className: 'primary' }, 'Adicionar métrica');
  const check = (): { ok: boolean; text: string } => {
    try {
      const c = compileFormula(formula.value, cols);
      return { ok: true, text: c.aggregate ? `Vale ${fmtMetric(evalAggregate(c, t.rows), unit.value.trim())} com os filtros atuais (um indicador).` : `Vale ${fmtMetric(t.rows[0] ? evalRow(c, t.rows[0]) : null, unit.value.trim())} na primeira linha (cria uma coluna nova).` };
    } catch (e) {
      return { ok: false, text: e instanceof FormulaError ? e.message : 'Fórmula inválida.' };
    }
  };
  test.onclick = () => (msg.textContent = check().text);
  add.onclick = () => {
    if (!name.value.trim()) {
      msg.textContent = 'Dê um nome à métrica.';
      return;
    }
    const r = check();
    msg.textContent = r.text;
    if (!r.ok) return;
    metrics = [...metrics, { id: `m${Date.now().toString(36)}`, name: name.value.trim(), unit: unit.value.trim() || undefined, formula: formula.value.trim() }];
    render();
  };
  box.replaceChildren(
    el('h2', {}, 'Métricas próprias'),
    el('p', { className: 'muted' }, 'Crie contas com as colunas: números, [Coluna], + − × ÷, ( ), ABS, ROUND. Com SUM, AVG, MIN, MAX, COUNT, SUMIF([soma],[coluna],"valor") e COUNTIF([coluna],"valor") vira um indicador único (respeita os filtros); sem elas vira uma coluna nova. Vazio ou divisão por zero dá “sem dado”, nunca zero.'),
    list,
    el('div', { className: 'metric-form' }, name, unit, formula, test, add),
    el('p', { className: 'muted small' }, 'Clique para inserir uma coluna: '),
    chips,
    msg,
  );
}

function renderTools() {
  const restore = $('btnRestore') as HTMLButtonElement;
  restore.hidden = removed.size === 0;
  restore.textContent = `Restaurar ${removed.size} gráfico(s) removido(s)`;
}

function baseName() {
  return (dataset?.fileName ?? 'painel').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]+/g, '-');
}

function saveProject() {
  if (!dataset || !table) return;
  const info = dataset.info;
  const txt = serializeProject({
    salvoEm: new Date().toISOString(),
    painel: __APP_VERSION__,
    origem: { arquivo: dataset.fileName, sha256: info?.sha256, formato: info?.format, tabela: table.title ?? table.name },
    leitura: { encoding: info?.encoding, delimiter: info?.delimiter },
    estado: captureState(),
  });
  download(`${baseName()}.projeto.json`, 'application/json', txt);
}

async function openProject(f: File) {
  try {
    const p = parseProject(await f.text());
    carry = { state: p.estado, label: `Projeto “${p.origem.arquivo || f.name}” (salvo em ${p.salvoEm ? new Date(p.salvoEm).toLocaleString('pt-BR') : 'data desconhecida'}, painel ${p.painel || '?'})` };
    reset();
    pending = null;
    $('preview').hidden = true;
    $('app').hidden = true;
    $('actions').hidden = true;
    $('drop').hidden = false;
    $('note').textContent = `Projeto aberto: ${carry.label}. Agora escolha o arquivo de dados — pode ser o mesmo ou uma versão atualizada; os filtros e ajustes serão reaplicados.`;
    $('msg').textContent = '';
  } catch (e) {
    fail(e instanceof Error ? e.message : 'Não foi possível abrir o projeto.');
  }
}

function updateData() {
  if (!dataset || !table) return;
  carry = { state: captureState(), oldTable: table, label: `Arquivo anterior “${dataset.fileName}”` };
  ($('file') as HTMLInputElement).value = '';
  ($('file') as HTMLInputElement).click();
}

function downloadExcel() {
  if (!dataset || !table) return;
  const t = view();
  const types = Object.fromEntries(lastProf.map((p) => [p.name, p.type]));
  const isNum = (c: string) => types[c] === 'number' || types[c] === 'integer';
  const rows = t.rows.map((r) => t.columns.map((c) => (isNum(c) && r[c] != null ? (toNumber(r[c]) ?? String(r[c])) : r[c] instanceof Date ? r[c] : (r[c] as string | number | null))));
  const model = buildReportModel(reportContext()!);
  const info: [string, string][] = [...model.origin, ...model.records, ...model.adjustments.map((a, i) => [`Ajuste ${i + 1}`, a] as [string, string]), ...model.kpis.map(([k, v]) => [`Indicador: ${k}`, v] as [string, string]), ['Gerado em', model.generatedAt]];
  const bytes = buildXlsx([
    { name: 'Dados', columns: t.columns.map(withUnit), rows },
    { name: 'Origem e ajustes', columns: ['Campo', 'Valor'], rows: info },
  ]);
  download(`${baseName()}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bytes);
}

function renderDateBar(prof: ColProfile[]) {
  const bar = $('dateBar');
  const dcols = prof.filter((p) => p.type === 'date');
  bar.hidden = !dcols.length;
  if (!dcols.length) return;
  const col = dateRange.col && dcols.some((d) => d.name === dateRange.col) ? dateRange.col : dcols[0]!.name;
  const cur = dcols.find((d) => d.name === col)!;
  const iso = (ms?: number) => (ms == null ? undefined : new Date(ms).toISOString().slice(0, 10));
  const sel = el('select', { ariaLabel: 'Coluna de data do período' }, ...dcols.map((d) => el('option', { value: d.name, selected: d.name === col }, d.name)));
  const from = el('input', { type: 'date', value: dateRange.from ?? '', min: iso(cur.minDate), max: iso(cur.maxDate), ariaLabel: 'Período: de' });
  const to = el('input', { type: 'date', value: dateRange.to ?? '', min: iso(cur.minDate), max: iso(cur.maxDate), ariaLabel: 'Período: até' });
  const apply = () => {
    dateRange = { col: sel.value, from: from.value || undefined, to: to.value || undefined };
    page = 1;
    setTimeout(render, 0);
  };
  sel.onchange = apply;
  from.onchange = apply;
  to.onchange = apply;
  const clear = el('button', { type: 'button', className: 'mini' }, 'Limpar período');
  clear.onclick = () => {
    dateRange = {};
    page = 1;
    render();
  };
  bar.replaceChildren(el('b', {}, 'Período: '), sel, ' de ', from, ' até ', to, ' ', clear, el('span', { className: 'muted' }, ' Linhas sem data nessa coluna ficam fora quando o período está ativo.'));
}


function renderTable() {
  if (!table) return;
  const base = mergedTable();
  const tv = view();
  const needle = ($('q') as HTMLInputElement).value.trim().toLowerCase();
  let rows = needle ? tv.rows.filter((r) => base.columns.some((c) => String(r[c] ?? '').toLowerCase().includes(needle))) : tv.rows;
  const types = Object.fromEntries(lastProf.map((p) => [p.name, p.type]));
  if (sortState && base.columns.includes(sortState.col)) rows = sortRows(rows, sortState.col, sortState.dir, types[sortState.col] as ColType | undefined);
  const pg = pageOf(rows, page, pageSize);
  page = pg.page;
  const heads = base.columns.map((c) => {
    const th = el('th', {});
    const active = sortState?.col === c;
    th.setAttribute('aria-sort', active ? (sortState!.dir === 'asc' ? 'ascending' : 'descending') : 'none');
    const b = el('button', { type: 'button', className: 'sortbtn', title: 'Clique para ordenar' }, withUnit(c) + (active ? (sortState!.dir === 'asc' ? ' ▲' : ' ▼') : ''));
    b.onclick = () => {
      sortState = !active ? { col: c, dir: 'asc' } : sortState!.dir === 'asc' ? { col: c, dir: 'desc' } : null;
      renderTable();
    };
    th.append(b);
    return th;
  });
  $('tbl').replaceChildren(el('thead', {}, el('tr', {}, ...heads)), el('tbody', {}, ...pg.items.map((r) => el('tr', {}, ...base.columns.map((c) => el('td', {}, cellText(r[c])))))));
  $('tinfo').textContent = `Mostrando ${pg.from}–${pg.to} de ${rows.length} linha(s)${rows.length !== base.rows.length ? ` (filtradas de ${base.rows.length})` : ''}. “—” significa sem dado (não é zero).`;
  const prev = el('button', { type: 'button', disabled: pg.page <= 1 }, '‹ Anterior');
  const next = el('button', { type: 'button', disabled: pg.page >= pg.pages }, 'Próxima ›');
  prev.onclick = () => ((page = pg.page - 1), renderTable());
  next.onclick = () => ((page = pg.page + 1), renderTable());
  const sz = el('select', { ariaLabel: 'Linhas por página' }, ...[25, 50, 100, 500].map((n) => el('option', { value: String(n), selected: n === pageSize }, `${n} por página`)));
  sz.onchange = () => ((pageSize = Number(sz.value)), (page = 1), renderTable());
  $('pager').replaceChildren(prev, el('span', {}, ` Página ${pg.page} de ${pg.pages} `), next, ' ', sz);
}

type SharedState = ProjectState;

function load(ds: Dataset, st: SharedState = {}) {
  dataset = ds;
  pending = null;
  $('preview').hidden = true;
  removed = new Set(st.removed ?? []);
  forced = st.forced ?? {};
  filters = st.filters ?? {};
  merges = st.merges ?? {};
  dateRange = st.dateRange ?? {};
  basemap = st.basemap ?? 'esri';
  pageSize = st.pageSize ?? 50;
  renames = st.renames ?? {};
  units = st.units ?? {};
  metrics = st.metrics ?? [];
  sortState = null;
  page = 1;
  locInfo = inferLocale(ds.tables);
  if (st.locale) {
    locale.dateOrder = st.locale.dateOrder;
    locale.numbers = st.locale.numbers;
  }
  Object.assign(styleChoice, st.styleChoice ?? {});
  Object.assign(rateChoice, st.rateChoice ?? {});
  if (st.level) ($('level') as HTMLSelectElement).value = st.level;
  $('msg').textContent = '';
  const sel = $('tableSel') as HTMLSelectElement;
  sel.replaceChildren(...ds.tables.map((t, i) => el('option', { value: String(i) }, `${t.title ?? t.name} (${t.rows.length})`)));
  sel.hidden = ds.tables.length < 2;
  table = ds.tables[st.tableIndex ?? 0] ?? ds.tables[0]!;
  sel.value = String(ds.tables.indexOf(table));
  document.title = `Dashboard – ${ds.fileName}`;
  $('drop').hidden = true;
  $('app').hidden = false;
  $('actions').hidden = false;
  render();
}

// ---------- prévia: o usuário confere como o arquivo foi lido antes de gerar o painel ----------
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

async function startFile(fileName: string, bytes: Uint8Array, opts: ParseOptions = {}, keep?: Pending) {
  try {
    const ds = await parseFile(fileName, bytes, { ...PDF, ...opts });
    const sha = keep?.sha ?? (await sha256(bytes));
    ds.info = { ...ds.info!, sha256: sha, readAt: keep?.ds.info?.readAt ?? new Date().toISOString() };
    if (!keep) {
      const li = inferLocale(ds.tables);
      locInfo = li;
      locale.dateOrder = li.dateOrder;
      locale.numbers = li.numbers;
    }
    const cr = keep ? keep.carry : carry;
    carry = null;
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
    fail(e instanceof Error ? e.message : 'Não foi possível ler o arquivo.');
  }
}

function renderPreview() {
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
  rows.push(['Tabelas encontradas', String(p.ds.tables.length)], ['Linhas lidas', n(info.rowsRead)], ['Linhas ignoradas (em branco ou título)', n(info.rowsDropped)], ['Linhas não lidas (acima do limite)', n(info.truncated)]);

  const sel = <V extends string>(label: string, value: V, options: [V, string][], onChange: (v: V) => void) => {
    const s = el('select', { ariaLabel: label }, ...options.map(([v, l]) => el('option', { value: v, selected: v === value }, l)));
    s.onchange = () => onChange(s.value as V);
    return el('label', {}, label + ' ', s);
  };
  const textual = ['csv', 'tsv', 'txt', 'json', 'geojson', 'kml'].includes(info.format);
  const reparse = (o: ParseOptions) => void startFile(p.fileName, p.bytes, { ...p.opts, ...o }, p);
  const controls = el('fieldset', {}, el('legend', {}, 'Se algo estiver errado, ajuste aqui'));
  if (textual) controls.append(sel<Encoding>('Codificação', p.opts.encoding ?? 'auto', [['auto', 'Automática'], ['utf-8', 'UTF-8'], ['windows-1252', 'Windows-1252 (Excel BR)']], (v) => reparse({ encoding: v })));
  if (['csv', 'tsv', 'txt'].includes(info.format)) controls.append(sel<DelimiterChoice>('Separador', p.opts.delimiter ?? 'auto', [['auto', 'Automático'], [',', 'Vírgula'], [';', 'Ponto e vírgula'], ['\t', 'Tabulação'], ['|', 'Barra vertical']], (v) => reparse({ delimiter: v })));
  controls.append(
    sel<'dmy' | 'mdy'>('Datas com barra (03/04/2024)', locale.dateOrder, [['dmy', 'dia/mês/ano'], ['mdy', 'mês/dia/ano']], (v) => ((locale.dateOrder = v), renderPreview())),
    sel<'br' | 'us'>('Números', locale.numbers, [['br', '1.234,56 (padrão brasileiro)'], ['us', '1,234.56 (padrão americano)']], (v) => ((locale.numbers = v), renderPreview())),
  );
  if (p.ds.tables.length > 1) controls.append(sel<string>('Tabela / aba', String(p.tableIndex), p.ds.tables.map((tb, i) => [String(i), `${tb.title ?? tb.name} (${n(tb.rows.length)} linhas)`] as [string, string]), (v) => ((p.tableIndex = Number(v)), renderPreview())));

  const alerts = qualityAlerts(t, prof, currentLoc());
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
  go.onclick = () => load(p.ds, { ...(reconciled ?? {}), tableIndex: p.tableIndex, forced: { ...(reconciled?.forced ?? {}), ...p.forcedTmp }, locale: { dateOrder: locale.dateOrder, numbers: locale.numbers } });
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

async function handle(f: File) {
  await startFile(f.name, new Uint8Array(await f.arrayBuffer()));
}

const csvCell = (v: unknown) => csvField(v);

function captureState(): SharedState {
  return { level: ($('level') as HTMLSelectElement).value, tableIndex: dataset && table ? dataset.tables.indexOf(table) : 0, forced, filters, removed: [...removed], styleChoice: { ...styleChoice }, rateChoice: { ...rateChoice }, merges, locale: { dateOrder: locale.dateOrder, numbers: locale.numbers }, dateRange, basemap, pageSize, renames, units, metrics };
}

/** Gera um único .html com o painel e os dados embutidos, abrindo igual ao que está na tela. */
function exportHtml(opts: { title: string; fileName: string; readonly: boolean }) {
  if (!dataset) return;
  const payload = JSON.stringify({ dataset, state: captureState(), readonly: opts.readonly, title: opts.title }).replace(/</g, '\\u003c');
  const clone = document.documentElement.cloneNode(true) as HTMLElement;
  clone.querySelector('#snapshot')?.remove();
  // volta ao estado inicial: o painel recompõe tudo a partir dos dados embutidos
  for (const id of ['kpis', 'charts', 'chips', 'alerts', 'tbl', 'cols', 'ttl', 'ctx', 'tinfo', 'msg', 'metricsBox', 'note']) clone.querySelector('#' + id)?.replaceChildren();
  clone.querySelector('#app')?.setAttribute('hidden', '');
  clone.querySelector('#actions')?.setAttribute('hidden', '');
  clone.querySelector('#drop')?.removeAttribute('hidden');
  clone.querySelector('title')!.textContent = opts.title;
  clone.querySelector('body')?.classList.remove('shared');
  const s = el('script', { id: 'snapshot', type: 'application/json' });
  s.textContent = payload;
  clone.querySelector('body')!.append(s);
  const name = opts.fileName.replace(/[\\/:*?"<>|]+/g, '-').replace(/\.html?$/i, '') || 'painel';
  download(`${name}.html`, 'text/html', '<!doctype html>\n' + clone.outerHTML.replace(/<canvas[^>]*><\/canvas>/g, ''));
}

/** Estado atual do painel, entregue ao módulo de relatório. */
function reportContext(): ReportContext | null {
  if (!dataset || !table) return null;
  return {
    dataset,
    table,
    full: mergedTable(),
    view: view(),
    charts,
    maps,
    specs: lastSpecs,
    prof: lastProf,
    kpiProf: lastKpiProf,
    loc: currentLoc(),
    state: { filters, dateRange, merges, forced, removed: [...removed], renames, units, metrics, locale: { dateOrder: locale.dateOrder, numbers: locale.numbers } },
  };
}

function openShareDialog() {
  if (!dataset || !table) return;
  const dlg = $('shareDlg') as HTMLDialogElement;
  const title = $('shTitle') as HTMLInputElement;
  const file = $('shFile') as HTMLInputElement;
  title.value = table.title ?? dataset.fileName.replace(/\.[^.]+$/, '');
  file.value = `painel-${dataset.fileName.replace(/\.[^.]+$/, '')}`;
  dlg.showModal();
}

function init() {
  initTheme((m) => {
    setChartMode(m);
    if (table) render();
  });
  initShell();
  const drop = $('drop');
  const file = $<HTMLInputElement>('file');
  drop.onclick = () => file.click();
  drop.onkeydown = (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), file.click());
  file.onchange = () => file.files?.[0] && handle(file.files[0]);
  drop.ondragover = (e) => (e.preventDefault(), drop.classList.add('over'));
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    if (e.dataTransfer?.files[0]) void handle(e.dataTransfer.files[0]);
  };
  $('level').onchange = () => render();
  $('tableSel').onchange = () => {
    table = dataset!.tables[Number(($('tableSel') as HTMLSelectElement).value)]!;
    removed = new Set();
    forced = {};
    filters = {};
    merges = {};
    renames = {};
    units = {};
    metrics = [];
    dateRange = {};
    sortState = null;
    page = 1;
    render();
  };
  $('q').oninput = () => ((page = 1), renderTable());
  $('btnNew').onclick = () => {
    reset();
    pending = null;
    $('preview').hidden = true;
    file.value = '';
    $('drop').hidden = false;
    $('app').hidden = true;
    $('actions').hidden = true;
  };
  $('btnHtml').onclick = openShareDialog;
  $('shCancel').onclick = () => ($('shareDlg') as HTMLDialogElement).close();
  $('shGo').onclick = () => {
    exportHtml({ title: ($('shTitle') as HTMLInputElement).value.trim() || 'Painel', fileName: ($('shFile') as HTMLInputElement).value.trim(), readonly: ($('shRead') as HTMLInputElement).checked });
    ($('shareDlg') as HTMLDialogElement).close();
  };
  $('btnPrint').onclick = () => window.print();
  $('btnRestore').onclick = () => ((removed = new Set()), render());
  $('btnSaveProj').onclick = saveProject;
  const pf = $<HTMLInputElement>('projFile');
  const askProj = () => ((pf.value = ''), pf.click());
  $('btnOpenProj').onclick = askProj;
  $('btnOpenProj2').onclick = (e) => (e.stopPropagation(), askProj());
  pf.onclick = (e) => e.stopPropagation();
  pf.onchange = () => pf.files?.[0] && void openProject(pf.files[0]);
  $('btnUpdate').onclick = updateData;
  $('btnXlsx').onclick = downloadExcel;
  $('btnReport').onclick = () => {
    const ctx = reportContext();
    if (ctx) void openReport(ctx, fail);
  };
  window.addEventListener('beforeprint', () => {
    setPrinting(true);
    printCharts(charts, true, 'light');
    maps.forEach((mp) => mp.invalidateSize());
  });
  window.addEventListener('afterprint', () => {
    setPrinting(false);
    printCharts(charts, false, currentMode());
  });
  $('btnCsv').onclick = () => table && download(`${table.name}.csv`, 'text/csv;charset=utf-8', '﻿' + [table.columns.map(csvCell).join(';'), ...view().rows.map((r) => table!.columns.map((c) => csvCell(r[c])).join(';'))].join('\n'));

  const snap = document.getElementById('snapshot');
  if (snap?.textContent) {
    try {
      const raw = JSON.parse(snap.textContent) as { dataset?: Dataset; state?: SharedState; readonly?: boolean; title?: string } & Dataset;
      // formato novo: { dataset, state, readonly, title }; formato antigo: o próprio dataset
      const ds = raw.dataset ?? raw;
      if (raw.readonly) document.body.classList.add('shared');
      // datas voltam como texto ISO após a serialização; o perfil as reconhece
      load(ds, raw.state ?? {});
      if (raw.title) document.title = raw.title;
    } catch {
      fail('Os dados embutidos neste arquivo estão corrompidos.');
    }
  }
}
init();

// ponte usada pelo aplicativo de desktop (Electron) para abrir arquivos pelo menu ou pelo Windows
(window as unknown as { __abrirArquivo: (name: string, b64: string) => Promise<void> }).__abrirArquivo = async (name, b64) => {
  try {
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    await startFile(name, bytes);
  } catch (e) {
    fail(e instanceof Error ? e.message : 'Não foi possível ler o arquivo.');
  }
};

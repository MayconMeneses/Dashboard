import { Chart, registerables } from 'chart.js';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import PdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker&inline';
import { parseFile } from './parse.js';
import { profileTable, toNumber } from './profile.js';
import { bubbleData, compatibleStyles, funnelData, toHeatmap, toPercent, toPareto } from './shapes.js';
import { chartData, HOW_TO, HOWTO_SHAPE, insightFor, kpis, qualityAlerts, rateData, rateInsight, suggestCharts } from './suggest.js';
import type { SeriesData } from './suggest.js';
import type { ChartSpec, ColType, Dataset, Table } from './types.js';

Chart.register(...registerables);
pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();
const PDF = { pdfjs: pdfjs as unknown as NonNullable<Parameters<typeof parseFile>[2]>['pdfjs'] };
const PALETTE = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#475569', '#ea580c'];
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let dataset: Dataset | null = null;
let table: Table | null = null;
let charts: Chart[] = [];
let maps: L.Map[] = [];
let removed = new Set<string>();
const rateChoice: Record<string, number> = {};
const styleChoice: Record<string, string> = {};
let forced: Record<string, ColType> = {};
let filters: Record<string, string> = {};

function view(): Table {
  const t = table!;
  const keys = Object.keys(filters);
  if (!keys.length) return t;
  return { ...t, rows: t.rows.filter((r) => keys.every((k) => String(r[k] ?? '') === filters[k])) };
}

function toggleFilter(col: string, value: string) {
  if (filters[col] === value) delete filters[col];
  else filters = { ...filters, [col]: value };
  render();
}
const TYPE_NAMES: Record<string, string> = { number: 'número', integer: 'inteiro', date: 'data', category: 'categoria', boolean: 'sim/não', text: 'texto', id: 'identificador', lat: 'latitude', lon: 'longitude' };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
}

function fail(m: string) {
  $('msg').textContent = m;
}

function reset() {
  charts.forEach((c) => c.destroy());
  maps.forEach((m) => m.remove());
  charts = [];
  maps = [];
}

function drawChart(spec: ChartSpec, t: Table): HTMLElement {
  const card = el('div', { className: 'chart' });
  const x = el('button', { className: 'x', type: 'button', title: 'Remover este gráfico', ariaLabel: 'Remover este gráfico' }, '✕');
  x.onclick = () => {
    removed.add(spec.id);
    render();
  };
  card.append(el('header', {}, el('h3', {}, spec.title), x), el('p', {}, spec.description));

  if (spec.kind === 'map') {
    const prof = profileTable(t, forced);
    const lat = prof.find((p) => p.type === 'lat')!.name;
    const lon = prof.find((p) => p.type === 'lon')!.name;
    const div = el('div', { className: 'map' });
    card.append(div);
    queueMicrotask(() => {
      const map = L.map(div);
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 18, attribution: 'Tiles © Esri' }).addTo(map);
      const pts: L.LatLngTuple[] = [];
      for (const r of t.rows.slice(0, 5000)) {
        const a = toNumber(r[lat] ?? null);
        const b = toNumber(r[lon] ?? null);
        if (a == null || b == null || Math.abs(a) > 90 || Math.abs(b) > 180) continue;
        pts.push([a, b]);
        const first = t.columns.find((c) => c !== lat && c !== lon && r[c] != null);
        L.circleMarker([a, b], { radius: 5, color: '#fff', weight: 1, fillColor: PALETTE[0], fillOpacity: 0.85 }).bindTooltip(first ? String(r[first]) : '').addTo(map);
      }
      if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.1));
      else map.setView([-14, -52], 4);
      maps.push(map);
    });
    return card;
  }

  if (spec.kind === 'scatter' && spec.x && spec.y) {
    const pts = t.rows.map((r) => ({ x: toNumber(r[spec.x!] ?? null), y: toNumber(r[spec.y!] ?? null) })).filter((p): p is { x: number; y: number } => p.x != null && p.y != null);
    const canvas = el('canvas');
    card.append(el('div', { className: 'box' }, canvas));
    charts.push(new Chart(canvas, { type: 'scatter', data: { datasets: [{ label: `${spec.x} × ${spec.y}`, data: pts, backgroundColor: PALETTE[0] + 'aa' }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { title: { display: true, text: spec.x } }, y: { title: { display: true, text: spec.y } } } } }));
    return card;
  }
  if (spec.kind === 'funnel') return drawFunnel(card, spec, t);
  if (spec.kind === 'bubble') return drawBubble(card, spec, t);
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
  let shape: string = spec.kind === 'pivot' ? (spec.style ?? 'bar') : spec.kind;
  let why = spec.why ?? '';
  if (spec.kind === 'pivot' && !spec.rate) {
    const opts = compatibleStyles({ ordered: !!spec.keepOrder, series: d.datasets?.length ?? 0, labels: d.labels.length, positive: [...d.values, ...(d.datasets ?? []).flatMap((s) => s.values)].every((v) => Number.isNaN(v) || v >= 0) });
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
  const insight = insightFor(spec, d) + (rate ? ' ' + rateInsight(rate) : '');
  card.append(el('p', { className: 'insight' }, el('b', {}, 'Destaque: '), insight));
  card.append(el('details', { className: 'howto' }, el('summary', {}, 'Por que este gráfico e como ler'), el('p', {}, el('b', {}, 'Por que: '), why || 'Escolhido pelo tipo dos dados.'), el('p', {}, el('b', {}, 'Como ler: '), HOWTO_SHAPE[shape] ?? spec.howTo ?? HOW_TO[spec.kind] ?? '')));

  if (shape === 'heatmap') return drawHeatmap(card, spec, d);
  if (shape === 'small') return drawSmall(card, d);

  const canvas = el('canvas');
  card.append(el('div', { className: 'box' }, canvas));
  const donut = shape === 'donut';
  const horizontal = shape === 'hbar';
  const percent = shape === 'percent';
  const stacked = shape === 'stacked' || percent || shape === 'area';
  const isLine = shape === 'line' || shape === 'area';
  const radar = shape === 'radar';
  const pareto = shape === 'pareto';
  const base = percent ? toPercent(d) : d;
  let labels = base.labels;
  let datasets: object[];
  const colorOf = (i: number) => PALETTE[i % PALETTE.length]!;
  if (pareto) {
    const p = toPareto(d);
    labels = p.labels;
    datasets = [
      { type: 'bar', label: spec.y ?? 'Valor', data: p.values, backgroundColor: PALETTE[0], order: 1 },
      { type: 'line', label: '% acumulado', data: p.cumulative, yAxisID: 'y1', borderColor: '#ea580c', backgroundColor: '#ea580c', borderWidth: 3, pointRadius: 3, tension: 0.15, order: -1 },
    ];
  } else if (base.datasets) {
    const sets = radar ? [...base.datasets].sort((x, y) => y.values.reduce((a, v) => a + (Number.isNaN(v) ? 0 : v), 0) - x.values.reduce((a, v) => a + (Number.isNaN(v) ? 0 : v), 0)).slice(0, 6) : base.datasets;
    datasets = sets.map((s, i) => ({ label: s.label, data: s.values.map((v) => (Number.isNaN(v) ? null : v)), backgroundColor: radar || shape === 'area' ? colorOf(i) + '55' : colorOf(i), borderColor: colorOf(i), tension: 0.25, pointRadius: isLine || radar ? 3 : 0, borderWidth: isLine || radar ? 2 : 0, fill: shape === 'area' || radar, spanGaps: false }));
  } else {
    datasets = [{ label: spec.y ?? 'Registros', data: base.values.map((v) => (Number.isNaN(v) ? null : v)), backgroundColor: donut ? labels.map((_, i) => colorOf(i)) : shape === 'area' ? PALETTE[0] + '55' : PALETTE[0], borderColor: PALETTE[0], tension: 0.25, fill: shape === 'area', barThickness: horizontal ? 14 : undefined, spanGaps: false }];
  }
  if (rate) datasets.push({ type: 'line', label: rate.name, data: rate.values.map((v) => (Number.isNaN(v) ? null : v)), yAxisID: 'y1', borderColor: '#ea580c', backgroundColor: '#ea580c', borderWidth: 3, pointRadius: 4, tension: 0.2, spanGaps: false, order: -1 });
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
          if (i != null && spec.x && labels[i] != null) toggleFilter(spec.x, labels[i]!);
        },
        onHover: (e, els) => {
          const c = e.native?.target as HTMLElement | null;
          if (c) c.style.cursor = els.length ? 'pointer' : 'default';
        },
        plugins: {
          legend: { display: donut || radar || !!d.datasets || pareto, position: 'bottom' },
          tooltip: {
            callbacks: {
              label: (c) => {
                const v = (horizontal ? c.parsed.x : radar ? (c.parsed as { r: number }).r : c.parsed.y) as number | null;
                const pct = (c.dataset as { yAxisID?: string }).yAxisID === 'y1' || percent;
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
        scales: donut || radar ? (radar ? { r: { beginAtZero: true } } : {}) : { x: { stacked, ...(horizontal ? { beginAtZero: true } : {}) }, y: { stacked, beginAtZero: true, ...(percent ? { max: 100, ticks: { callback: (v: string | number) => `${v}%` } } : {}) }, ...(rate || pareto ? { y1: { position: 'right', min: 0, max: 100, grid: { drawOnChartArea: false }, ticks: { callback: (v: string | number) => `${v}%` }, title: { display: true, text: pareto ? '% acumulado' : 'Positividade (%)' } } } : {}) },
      },
    }),
  );
  return card;
}

function heat(v: number, min: number, max: number): string {
  const f = max > min ? (v - min) / (max - min) : 1;
  return `rgba(37, 99, 235, ${(0.08 + f * 0.82).toFixed(2)})`;
}

function drawHeatmap(card: HTMLElement, spec: ChartSpec, d: SeriesData): HTMLElement {
  const h = toHeatmap(d);
  const th = (txt: string, onclick?: () => void) => {
    const c = el('th', {}, txt);
    if (onclick) {
      c.style.cursor = 'pointer';
      c.title = 'Clique para filtrar';
      c.onclick = onclick;
    }
    return c;
  };
  const fmt = new Intl.NumberFormat('pt-BR');
  const table = el(
    'table',
    { className: 'heat' },
    el('thead', {}, el('tr', {}, el('th', {}, ''), ...h.cols.map((c) => th(c, spec.x ? () => toggleFilter(spec.x!, c) : undefined)))),
    el('tbody', {}, ...h.rows.map((r, ri) => el('tr', {}, th(r, spec.seriesBy ? () => toggleFilter(spec.seriesBy!, r) : undefined), ...h.cells[ri]!.map((v, ci) => {
      const td = el('td', {}, Number.isNaN(v) ? '—' : fmt.format(v));
      if (Number.isNaN(v)) {
        td.className = 'nodata';
        td.title = `${r} · ${h.cols[ci]}: sem dado (não é zero)`;
      } else {
        td.style.background = heat(v, h.min, h.max);
        td.style.color = (v - h.min) / ((h.max - h.min) || 1) > 0.55 ? '#fff' : 'inherit';
        td.title = `${r} · ${h.cols[ci]}: ${fmt.format(v)}`;
      }
      return td;
    })))),
  );
  card.append(el('div', { className: 'heatwrap' }, table));
  return card;
}

function drawSmall(card: HTMLElement, d: SeriesData): HTMLElement {
  const sets = d.datasets ?? [{ label: 'Valor', values: d.values }];
  const max = Math.max(1, ...sets.flatMap((s) => s.values).filter((v) => !Number.isNaN(v)));
  const grid = el('div', { className: 'small-grid' });
  sets.forEach((s, i) => {
    const total = s.values.filter((v) => !Number.isNaN(v)).reduce((a, b) => a + b, 0);
    const canvas = el('canvas');
    grid.append(el('div', { className: 'small-cell' }, el('div', { className: 'small-title' }, el('b', {}, s.label), ` · total ${new Intl.NumberFormat('pt-BR').format(total)}`), el('div', { className: 'small-box' }, canvas)));
    charts.push(
      new Chart(canvas, {
        type: 'line',
        data: { labels: d.labels, datasets: [{ label: s.label, data: s.values.map((v) => (Number.isNaN(v) ? null : v)), borderColor: PALETTE[i % PALETTE.length], backgroundColor: PALETTE[i % PALETTE.length] + '33', fill: true, borderWidth: 2, pointRadius: 2, tension: 0.25, spanGaps: false }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 4, font: { size: 9 } } }, y: { min: 0, max, ticks: { maxTicksLimit: 3, font: { size: 9 } } } } },
      }),
    );
  });
  card.append(grid, el('p', { className: 'muted small-note' }, 'Todos os gráficos pequenos usam a mesma escala vertical, então podem ser comparados entre si.'));
  return card;
}

function drawFunnel(card: HTMLElement, spec: ChartSpec, t: Table): HTMLElement {
  const f = funnelData(t, spec);
  if (!f || f.values.every((v) => v === 0)) {
    card.append(el('p', {}, 'Sem dados suficientes para este gráfico.'));
    return card;
  }
  card.append(el('p', { className: 'insight' }, el('b', {}, 'Destaque: '), `${f.labels[f.labels.length - 1]}.`));
  card.append(el('details', { className: 'howto' }, el('summary', {}, 'Por que este gráfico e como ler'), el('p', {}, el('b', {}, 'Por que: '), spec.why ?? ''), el('p', {}, el('b', {}, 'Como ler: '), spec.howTo ?? '')));
  const canvas = el('canvas');
  card.append(el('div', { className: 'box short' }, canvas));
  const max = Math.max(...f.values, 1);
  charts.push(
    new Chart(canvas, {
      type: 'bar',
      data: { labels: f.labels, datasets: [{ label: 'Casos', data: f.values.map((v) => [-v / 2, v / 2]), backgroundColor: f.values.map((_, i) => PALETTE[i % PALETTE.length]), barThickness: 34 } as never] },
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${new Intl.NumberFormat('pt-BR').format(f.values[c.dataIndex]!)} casos` } } }, scales: { x: { min: -max / 2, max: max / 2, display: false }, y: { ticks: { font: { size: 12 } } } } },
    }),
  );
  return card;
}

function drawBubble(card: HTMLElement, spec: ChartSpec, t: Table): HTMLElement {
  const pts = bubbleData(t, spec);
  if (!pts.length) {
    card.append(el('p', {}, 'Sem dados suficientes para este gráfico.'));
    return card;
  }
  const maxS = Math.max(...pts.map((p) => p.size), 1);
  const top = [...pts].sort((a, b) => b.y - a.y)[0]!;
  card.append(el('p', { className: 'insight' }, el('b', {}, 'Destaque: '), `maior positividade em ${top.entity} (${top.y.toFixed(1).replace('.', ',')}%, ${new Intl.NumberFormat('pt-BR').format(top.x)} ${spec.bubble!.xLabel.toLowerCase()}).`));
  card.append(el('details', { className: 'howto' }, el('summary', {}, 'Por que este gráfico e como ler'), el('p', {}, el('b', {}, 'Por que: '), spec.why ?? ''), el('p', {}, el('b', {}, 'Como ler: '), spec.howTo ?? '')));
  const canvas = el('canvas');
  card.append(el('div', { className: 'box' }, canvas));
  charts.push(
    new Chart(canvas, {
      type: 'bubble',
      data: { datasets: pts.map((p, i) => ({ label: p.entity, data: [{ x: p.x, y: p.y, r: 5 + (p.size / maxS) * 22 }], backgroundColor: PALETTE[i % PALETTE.length] + 'bb', borderColor: PALETTE[i % PALETTE.length] })) },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        onClick: (_e, els) => {
          const p = els[0] ? pts[els[0].datasetIndex] : undefined;
          if (p && t.tidy) toggleFilter(t.tidy.entity, p.entity);
        },
        plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (c) => { const p = pts[c.datasetIndex]!; return `${p.entity}: ${new Intl.NumberFormat('pt-BR').format(p.x)} ${spec.bubble!.xLabel.toLowerCase()} · ${p.y.toFixed(1).replace('.', ',')}% · ${spec.bubble!.sizeLabel}: ${new Intl.NumberFormat('pt-BR').format(p.size)}`; } } } },
        scales: { x: { beginAtZero: true, title: { display: true, text: spec.bubble!.xLabel } }, y: { min: 0, max: 100, title: { display: true, text: 'Positividade (%)' }, ticks: { callback: (v: string | number) => `${v}%` } } },
      },
    }),
  );
  return card;
}

function render() {
  if (!table) return;
  reset();
  const full = table;
  const t = view();
  const prof = profileTable(full, forced);
  $('ttl').textContent = full.title ?? full.name;
  $('ctx').textContent = full.context ?? '';
  const alerts = qualityAlerts(full, prof);
  $('chips').replaceChildren(
    ...Object.entries(filters).map(([k, v]) => {
      const b = el('button', { type: 'button', className: 'chip', title: 'Remover este filtro' }, `${k}: ${v}  ✕`);
      b.onclick = () => toggleFilter(k, v);
      return b;
    }),
  );
  ($('chips') as HTMLElement).hidden = !Object.keys(filters).length;
  $('alerts').replaceChildren(...alerts.map((a) => el('li', { className: a.level }, a.text)));
  ($('alertsBox') as HTMLElement).hidden = !alerts.length;
  $('kpis').replaceChildren(...kpis(t, prof).map((k) => el('div', { className: 'kpi', title: k.hint ?? '' }, el('b', {}, k.value), el('span', {}, k.label))));
  const specs = suggestCharts(full, prof, Number(($('level') as HTMLSelectElement).value)).filter((s) => !removed.has(s.id));
  $('charts').replaceChildren(...(full.noCharts ? [el('div', { className: 'card' }, el('p', {}, 'Sem gráficos: este documento não tem tabelas com colunas alinhadas, só texto. O texto extraído está na tabela abaixo; para gráficos, use o arquivo original em Excel ou CSV.'))] : specs.map((s) => drawChart(s, t))));
  renderTable(($('q') as HTMLInputElement).value);
  const th = ['Coluna', 'Tipo (pode corrigir)', 'Preenchidas', 'Vazias', 'Valores distintos'];
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
        return el('tr', {}, el('td', {}, p.name), el('td', {}, sel), el('td', {}, String(p.filled)), el('td', {}, String(p.missing)), el('td', {}, String(p.unique)));
      }),
    ),
  );
}

function renderTable(q: string) {
  if (!table) return;
  const tv = view();
  const needle = q.trim().toLowerCase();
  const rows = needle ? tv.rows.filter((r) => table!.columns.some((c) => String(r[c] ?? '').toLowerCase().includes(needle))) : tv.rows;
  const shown = rows.slice(0, 500);
  $('tbl').replaceChildren(
    el('thead', {}, el('tr', {}, ...table.columns.map((c) => el('th', {}, c)))),
    el('tbody', {}, ...shown.map((r) => el('tr', {}, ...table!.columns.map((c) => el('td', {}, r[c] instanceof Date ? (r[c] as Date).toLocaleDateString('pt-BR') : r[c] == null ? '—' : String(r[c])))))),
  );
  $('tinfo').textContent = `Mostrando ${shown.length} de ${rows.length} linha(s). “—” significa sem dado (não é zero).`;
}

interface SharedState {
  level?: string;
  tableIndex?: number;
  forced?: Record<string, ColType>;
  filters?: Record<string, string>;
  removed?: string[];
  styleChoice?: Record<string, string>;
  rateChoice?: Record<string, number>;
}

function load(ds: Dataset, st: SharedState = {}) {
  dataset = ds;
  removed = new Set(st.removed ?? []);
  forced = st.forced ?? {};
  filters = st.filters ?? {};
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

async function handle(f: File) {
  try {
    load(await parseFile(f.name, new Uint8Array(await f.arrayBuffer()), PDF));
  } catch (e) {
    fail(e instanceof Error ? e.message : 'Não foi possível ler o arquivo.');
  }
}

function download(name: string, mime: string, content: string) {
  const a = el('a', { href: URL.createObjectURL(new Blob([content], { type: mime })), download: name });
  a.click();
  URL.revokeObjectURL(a.href);
}

const csvCell = (v: unknown) => {
  const s = v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function captureState(): SharedState {
  return { level: ($('level') as HTMLSelectElement).value, tableIndex: dataset && table ? dataset.tables.indexOf(table) : 0, forced, filters, removed: [...removed], styleChoice: { ...styleChoice }, rateChoice: { ...rateChoice } };
}

/** Gera um único .html com o painel e os dados embutidos, abrindo igual ao que está na tela. */
function exportHtml(opts: { title: string; fileName: string; readonly: boolean }) {
  if (!dataset) return;
  const payload = JSON.stringify({ dataset, state: captureState(), readonly: opts.readonly, title: opts.title }).replace(/</g, '\\u003c');
  const clone = document.documentElement.cloneNode(true) as HTMLElement;
  clone.querySelector('#snapshot')?.remove();
  // volta ao estado inicial: o painel recompõe tudo a partir dos dados embutidos
  for (const id of ['kpis', 'charts', 'chips', 'alerts', 'tbl', 'cols', 'ttl', 'ctx', 'tinfo', 'msg']) clone.querySelector('#' + id)?.replaceChildren();
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
    render();
  };
  $('q').oninput = () => renderTable(($('q') as HTMLInputElement).value);
  $('btnNew').onclick = () => {
    reset();
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
  window.addEventListener('beforeprint', () => {
    charts.forEach((c) => c.resize());
    maps.forEach((mp) => mp.invalidateSize());
  });
  $('btnCsv').onclick = () => table && download(`${table.name}.csv`, 'text/csv;charset=utf-8', '﻿' + [table.columns.map(csvCell).join(';'), ...table.rows.map((r) => table!.columns.map((c) => csvCell(r[c])).join(';'))].join('\n'));

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
    load(await parseFile(name, bytes, PDF));
  } catch (e) {
    fail(e instanceof Error ? e.message : 'Não foi possível ler o arquivo.');
  }
};

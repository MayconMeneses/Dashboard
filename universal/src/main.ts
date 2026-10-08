import { Chart, registerables } from 'chart.js';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { parseFile } from './parse.js';
import { profileTable, toNumber } from './profile.js';
import { chartData, kpis, qualityAlerts, suggestCharts } from './suggest.js';
import type { ChartSpec, ColType, Dataset, Table } from './types.js';

Chart.register(...registerables);
const PALETTE = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#475569', '#ea580c'];
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let dataset: Dataset | null = null;
let table: Table | null = null;
let charts: Chart[] = [];
let maps: L.Map[] = [];
let removed = new Set<string>();
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
  const d = chartData(t, spec);
  if (!d.labels.length) {
    card.append(el('p', {}, 'Sem dados suficientes para este gráfico.'));
    return card;
  }
  const canvas = el('canvas');
  card.append(el('div', { className: 'box' }, canvas));
  const donut = spec.kind === 'donut';
  const horizontal = spec.kind === 'hbar';
  const type = spec.kind === 'line' ? 'line' : donut ? 'doughnut' : 'bar';
  const datasets = d.datasets
    ? d.datasets.map((s, i) => ({ label: s.label, data: s.values.map((v) => (Number.isNaN(v) ? null : v)), backgroundColor: PALETTE[i % PALETTE.length] }))
    : [{ label: spec.y ?? 'Registros', data: d.values, backgroundColor: donut ? d.labels.map((_, i) => PALETTE[i % PALETTE.length]) : PALETTE[0], borderColor: PALETTE[0], tension: 0.25, barThickness: horizontal ? 14 : undefined }];
  charts.push(
    new Chart(canvas, {
      type,
      data: { labels: d.labels, datasets },
      options: {
        indexAxis: horizontal ? 'y' : 'x',
        responsive: true,
        maintainAspectRatio: false,
        onClick: (_e, els) => {
          const i = els[0]?.index;
          if (i != null && spec.x && d.labels[i] != null) toggleFilter(spec.x, d.labels[i]!);
        },
        onHover: (e, els) => {
          const c = e.native?.target as HTMLElement | null;
          if (c) c.style.cursor = els.length ? 'pointer' : 'default';
        },
        plugins: { legend: { display: donut || !!d.datasets, position: 'bottom' } },
        scales: donut ? {} : { x: { stacked: spec.kind === 'stacked' }, y: { stacked: spec.kind === 'stacked', beginAtZero: true } },
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
  const specs = suggestCharts(t, prof, Number(($('level') as HTMLSelectElement).value)).filter((s) => !removed.has(s.id));
  $('charts').replaceChildren(...specs.map((s) => drawChart(s, t)));
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

function load(ds: Dataset) {
  dataset = ds;
  removed = new Set();
  forced = {};
  filters = {};
  $('msg').textContent = '';
  const sel = $('tableSel') as HTMLSelectElement;
  sel.replaceChildren(...ds.tables.map((t, i) => el('option', { value: String(i) }, `${t.title ?? t.name} (${t.rows.length})`)));
  sel.hidden = ds.tables.length < 2;
  table = ds.tables[0]!;
  document.title = `Dashboard – ${ds.fileName}`;
  $('drop').hidden = true;
  $('app').hidden = false;
  $('actions').hidden = false;
  render();
}

async function handle(f: File) {
  try {
    load(await parseFile(f.name, new Uint8Array(await f.arrayBuffer())));
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

function exportHtml() {
  if (!dataset) return;
  const data = JSON.stringify(dataset, (_k, v) => v).replace(/</g, '\\u003c');
  const clone = document.documentElement.cloneNode(true) as HTMLElement;
  clone.querySelector('#snapshot')?.remove();
  const s = el('script', { id: 'snapshot', type: 'application/json' });
  s.textContent = data;
  clone.querySelector('body')!.append(s);
  download(`dashboard-${dataset.fileName.replace(/\.[^.]+$/, '')}.html`, 'text/html', '<!doctype html>\n' + clone.outerHTML.replace(/<canvas[^>]*><\/canvas>/g, ''));
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
  $('btnHtml').onclick = exportHtml;
  $('btnPrint').onclick = () => window.print();
  window.addEventListener('beforeprint', () => {
    charts.forEach((c) => c.resize());
    maps.forEach((mp) => mp.invalidateSize());
  });
  $('btnCsv').onclick = () => table && download(`${table.name}.csv`, 'text/csv;charset=utf-8', '﻿' + [table.columns.map(csvCell).join(';'), ...table.rows.map((r) => table!.columns.map((c) => csvCell(r[c])).join(';'))].join('\n'));

  const snap = document.getElementById('snapshot');
  if (snap?.textContent) {
    try {
      const ds = JSON.parse(snap.textContent) as Dataset;
      // datas voltam como texto ISO após a serialização; o perfil as reconhece
      load(ds);
    } catch {
      fail('Os dados embutidos neste arquivo estão corrompidos.');
    }
  }
}
init();

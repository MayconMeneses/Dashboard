import L from 'leaflet';
import { bbox, parts, validateGeometry } from '../geo/geometry.js';
import type { Geometry } from '../geo/geometry.js';
import { centroidOf } from '../geo/geometry.js';
import { classBreaks, classOf, gridBins, NO_DATA, RAMP } from '../geo/thematic.js';
import { PALETTE } from '../design/palette.js';
import { toNumber } from '../profile.js';
import type { Row, Table } from '../types.js';
import { tooltipText } from './tooltip.js';

export { NO_DATA, RAMP };
export const MAP_CAP = 5000;

export interface MapChoice {
  /** coluna numérica que colore as formas (vazio = cor única) */
  measure: string;
  /** mostra a grade de densidade no lugar dos pontos */
  heat: boolean;
}

export interface LegendItem {
  label: string;
  color: string;
  n: number;
}

export interface LayerResult {
  groups: Record<string, L.LayerGroup>;
  bounds: L.LatLngBounds | null;
  legend: LegendItem[];
  /** uma linha por feição desenhada (nome, tipo de geometria, valor da medida): a versão em tabela do mapa */
  table: { nome: string; tipo: string; valor: number | null }[];
  /** o que o desenho fez com as linhas recebidas */
  stats: { rows: number; drawn: number; noGeometry: number; invalid: number; capped: number };
}

const fmt = (n: number) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(n);

/** Tamanho de célula “redondo” (1, 2 ou 5 × 10ⁿ graus) para uma grade de ~20 células na maior dimensão. */
export function niceCell(span: number): number {
  const raw = Math.max(span, 1e-6) / 20;
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

function legendFor(values: (number | null)[], breaks: number[], ramp: string[]): LegendItem[] {
  const v = values.filter((x): x is number => x != null);
  if (!v.length) return [];
  const edges = [Math.min(...v), ...breaks, Math.max(...v)];
  const items: LegendItem[] = [];
  for (let i = 0; i <= breaks.length; i++) items.push({ label: `${fmt(edges[i]!)} a ${fmt(edges[i + 1]!)}`, color: ramp[Math.min(i, ramp.length - 1)]!, n: v.filter((x) => classOf(x, breaks) === i).length });
  const missing = values.length - v.length;
  if (missing) items.push({ label: 'sem dado', color: NO_DATA, n: missing });
  return items;
}

/** Monta as camadas do mapa a partir das linhas (já filtradas): polígonos, linhas e pontos reais, coloridos por uma medida ou em grade de densidade. */
export function buildLayers(t: Table, rows: Row[], choice: MapChoice, cap = MAP_CAP): LayerResult {
  const groups: Record<string, L.LayerGroup> = { Polígonos: L.layerGroup(), Linhas: L.layerGroup(), Pontos: L.layerGroup() };
  const stats = { rows: rows.length, drawn: 0, noGeometry: 0, invalid: 0, capped: Math.max(0, rows.length - cap) };
  const use = rows.slice(0, cap);
  const items: { row: Row; g: Geometry }[] = [];
  for (const row of use) {
    const id = t.geo?.id ? row[t.geo.id] : null;
    let g: Geometry | undefined = id != null ? t.shapes?.[String(id)] : undefined;
    if (!g && t.geo) {
      const lat = toNumber(row[t.geo.lat] ?? null);
      const lon = toNumber(row[t.geo.lon] ?? null);
      if (lat != null && lon != null) g = { type: 'Point', coordinates: [lon, lat] };
    }
    if (!g) stats.noGeometry++;
    else if (validateGeometry(g).some((p) => !p.startsWith('ponto em 0, 0'))) stats.invalid++;
    else items.push({ row, g });
  }
  stats.drawn = items.length;
  const label = (row: Row) => {
    const c = t.columns.find((x) => x !== t.geo?.lat && x !== t.geo?.lon && x !== t.geo?.id && row[x] != null);
    return c ? String(row[c]) : '';
  };
  const vals = items.map((it) => (choice.measure ? toNumber(it.row[choice.measure] ?? null) : null));
  const breaks = choice.measure ? classBreaks(vals.filter((x): x is number => x != null), RAMP.length) : [];
  const colorOf = (i: number) => (!choice.measure ? PALETTE[0]! : vals[i] == null ? NO_DATA : RAMP[Math.min(classOf(vals[i]!, breaks), RAMP.length - 1)]!);
  let legend = choice.measure ? legendFor(vals, breaks, RAMP) : [];
  const table: LayerResult['table'] = items.map(({ row, g }, i) => ({ nome: label(row), tipo: g.type, valor: vals[i] ?? null }));
  const cents: [number, number][] = [];
  let bounds: L.LatLngBounds | null = null;
  items.forEach(({ row, g }, i) => {
    const box = bbox(g)!;
    const b = L.latLngBounds([box.minLat, box.minLon], [box.maxLat, box.maxLon]);
    bounds = bounds ? bounds.extend(b) : b;
    const c = centroidOf(g);
    if (c) cents.push(c);
    const p = parts(g);
    const kind = p.polys.length ? 'Polígonos' : p.lines.length ? 'Linhas' : 'Pontos';
    if (choice.heat && kind === 'Pontos') return;
    const color = colorOf(i);
    const layer = L.geoJSON({ type: 'Feature', properties: {}, geometry: g } as never, {
      style: () => (kind === 'Polígonos' ? { color: '#1f2d3d', weight: 1, fillColor: color, fillOpacity: 0.6, ...(vals[i] == null && choice.measure ? { dashArray: '4' } : {}) } : { color, weight: 3, opacity: 0.9 }),
      pointToLayer: (_f, ll) => L.circleMarker(ll, { radius: 5, color: '#fff', weight: 1, fillColor: color, fillOpacity: 0.85 }),
      onEachFeature: (_f, lyr) => lyr.bindTooltip(tooltipText(label(row)), { sticky: true }),
    });
    groups[kind]!.addLayer(layer);
  });
  if (choice.heat) {
    const span = bounds ? Math.max((bounds as L.LatLngBounds).getEast() - (bounds as L.LatLngBounds).getWest(), (bounds as L.LatLngBounds).getNorth() - (bounds as L.LatLngBounds).getSouth()) : 1;
    const cell = niceCell(span);
    const bins = gridBins(cents, cell);
    const hb = classBreaks(bins.map((x) => x.count), RAMP.length);
    groups.Calor = L.layerGroup(bins.map((x) => L.rectangle([[x.lat, x.lon], [x.lat + cell, x.lon + cell]], { stroke: false, fillColor: RAMP[Math.min(classOf(x.count, hb), RAMP.length - 1)]!, fillOpacity: 0.7 }).bindTooltip(tooltipText(`${x.count} registro(s) nesta célula`), { sticky: true })));
    legend = legendFor(bins.map((x) => x.count), hb, RAMP).map((l) => ({ ...l, label: `${l.label} registros` }));
  }
  return { groups, bounds, legend, table, stats };
}

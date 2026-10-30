import L from 'leaflet';
import { el } from '../app/dom.js';
import { PALETTE } from '../design/palette.js';
import { profileTable, toNumber } from '../profile.js';
import type { ColType, Table } from '../types.js';
import type { ChartHost } from './host.js';

export interface MapOptions {
  forced: Record<string, ColType>;
  basemap: 'esri' | 'none';
  onBasemap: (b: 'esri' | 'none') => void;
}

/** Valor de uma célula como texto puro: o Leaflet trata string como HTML, e o conteúdo vem do arquivo do usuário. */
export function tooltipText(s: string): HTMLElement {
  const span = document.createElement('span');
  span.textContent = s;
  return span;
}

/** Mapa de pontos (até 5.000 registros com coordenadas válidas). Os totais do painel não dependem do que é desenhado aqui. */
export function drawMap(card: HTMLElement, t: Table, opts: MapOptions, host: ChartHost): HTMLElement {
    const prof = profileTable(t, opts.forced);
    const lat = prof.find((p) => p.type === 'lat')!.name;
    const lon = prof.find((p) => p.type === 'lon')!.name;
    const bsel = el('select', { ariaLabel: 'Mapa de fundo' }, el('option', { value: 'esri', selected: opts.basemap === 'esri' }, 'Mapa de fundo: Esri (acessa a internet)'), el('option', { value: 'none', selected: opts.basemap === 'none' }, 'Sem mapa de fundo (não acessa a internet)'));
    bsel.onchange = () => opts.onBasemap(bsel.value as 'esri' | 'none');
    card.append(el('p', { className: 'rate-pick' }, bsel));
    const div = el('div', { className: 'map' });
    card.append(div);
    queueMicrotask(() => {
      const map = L.map(div);
      if (opts.basemap === 'esri') L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 18, attribution: 'Tiles © Esri' }).addTo(map);
      const pts: L.LatLngTuple[] = [];
      for (const r of t.rows.slice(0, 5000)) {
        const a = toNumber(r[lat] ?? null);
        const b = toNumber(r[lon] ?? null);
        if (a == null || b == null || Math.abs(a) > 90 || Math.abs(b) > 180) continue;
        pts.push([a, b]);
        const first = t.columns.find((c) => c !== lat && c !== lon && r[c] != null);
        L.circleMarker([a, b], { radius: 5, color: '#fff', weight: 1, fillColor: PALETTE[0], fillOpacity: 0.85 }).bindTooltip(tooltipText(first ? String(r[first]) : '')).addTo(map);
      }
      if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.1));
      else map.setView([-14, -52], 4);
      host.addMap(map);
    });
    return card;
}

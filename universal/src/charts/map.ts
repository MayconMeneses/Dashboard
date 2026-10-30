import L from 'leaflet';
import { download, el } from '../app/dom.js';
import { toGeoJson } from '../geo/export.js';
import { profileTable } from '../profile.js';
import type { ColType, Table } from '../types.js';
import type { ChartHost } from './host.js';
import { buildLayers, MAP_CAP } from './mapLayers.js';
import type { MapChoice } from './mapLayers.js';

export { tooltipText } from './tooltip.js';

export interface MapOptions {
  forced: Record<string, ColType>;
  basemap: 'esri' | 'none';
  onBasemap: (b: 'esri' | 'none') => void;
  /** redesenha o painel (usado quando a escolha de cor ou de densidade muda) */
  rerender: () => void;
}

/** Escolha de cor/densidade do mapa, lembrada entre redesenhos do painel. */
const choice: MapChoice = { measure: '', heat: false };

/**
 * Mapa com as geometrias reais (polígonos, linhas e pontos) das linhas em análise. Os totais do painel não dependem do que é desenhado aqui;
 * o cartão informa quantas linhas foram desenhadas, quantas ficaram de fora e por quê.
 */
export function drawMap(card: HTMLElement, t0: Table, opts: MapOptions, host: ChartHost): HTMLElement {
  const prof = profileTable(t0, opts.forced);
  // colunas de coordenada pelo perfil (inclui as corrigidas à mão); a coluna de forma, se houver, vem do próprio arquivo
  const lat = prof.find((p) => p.type === 'lat')!.name;
  const lon = prof.find((p) => p.type === 'lon')!.name;
  const t: Table = { ...t0, geo: { lat, lon, ...(t0.geo?.id ? { id: t0.geo.id } : {}) } };
  const measures = prof.filter((p) => (p.type === 'number' || p.type === 'integer') && p.name !== t.geo?.lat && p.name !== t.geo?.lon);
  if (choice.measure && !measures.some((m) => m.name === choice.measure)) choice.measure = '';
  const bsel = el('select', { ariaLabel: 'Mapa de fundo' }, el('option', { value: 'esri', selected: opts.basemap === 'esri' }, 'Mapa de fundo: Esri (acessa a internet)'), el('option', { value: 'none', selected: opts.basemap === 'none' }, 'Sem mapa de fundo (não acessa a internet)'));
  bsel.onchange = () => opts.onBasemap(bsel.value as 'esri' | 'none');
  const msel = el('select', { ariaLabel: 'Colorir o mapa por' }, el('option', { value: '', selected: !choice.measure }, 'Cor única'), ...measures.map((m) => el('option', { value: m.name, selected: m.name === choice.measure }, m.name)));
  msel.onchange = () => {
    choice.measure = msel.value;
    opts.rerender();
  };
  const heat = el('input', { type: 'checkbox', checked: choice.heat, ariaLabel: 'Mostrar densidade em grade' });
  heat.onchange = () => {
    choice.heat = heat.checked;
    opts.rerender();
  };
  const dl = el('button', { type: 'button', className: 'mini' }, 'Baixar GeoJSON (linhas atuais)');
  dl.onclick = () => download(`${t.title ?? t.name}.geojson`, 'application/geo+json', JSON.stringify(toGeoJson(t, t.rows)));
  card.append(el('p', { className: 'rate-pick' }, bsel, ' ', 'Colorir por: ', msel, ' ', el('label', {}, heat, ' Densidade em grade'), ' ', dl));
  const res = buildLayers(t, t.rows, choice);
  const s = res.stats;
  const parts = [`${s.drawn} de ${s.rows} linha(s) desenhada(s)`];
  if (s.noGeometry) parts.push(`${s.noGeometry} sem coordenada ou geometria`);
  if (s.invalid) parts.push(`${s.invalid} com coordenadas inválidas (fora do intervalo, anel aberto ou projetadas — veja as notas da leitura)`);
  if (s.capped) parts.push(`${s.capped} além do limite de ${MAP_CAP} por desenho`);
  card.append(el('p', { className: 'muted', role: 'status' }, parts.join('; ') + '.'));
  if (res.legend.length) {
    card.append(
      el('p', { className: 'muted' }, choice.heat ? 'Densidade: quantos registros caem em cada célula da grade (classes por quantis).' : `Cores por classes de quantis de “${choice.measure}” (cada classe tem quantidade parecida de feições). Totais brutos podem enganar quando as áreas são de tamanhos diferentes; prefira taxas.`),
      el('ul', { className: 'map-legend' }, ...res.legend.map((l) => {
        const sw = el('span', { className: 'swatch' });
        sw.style.background = l.color;
        return el('li', {}, sw, ` ${l.label} (${l.n})`);
      })),
    );
  }
  const div = el('div', { className: 'map' });
  card.append(div);
  queueMicrotask(() => {
    const map = L.map(div);
    if (opts.basemap === 'esri') L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 18, attribution: 'Tiles © Esri' }).addTo(map);
    const overlays: Record<string, L.LayerGroup> = {};
    for (const [name, g] of Object.entries(res.groups)) {
      if (!g.getLayers().length) continue;
      g.addTo(map);
      overlays[name] = g;
    }
    if (Object.keys(overlays).length > 1) L.control.layers({}, overlays, { collapsed: true }).addTo(map);
    if (res.bounds) map.fitBounds(res.bounds.pad(0.1));
    else map.setView([-14, -52], 4);
    host.addMap(map);
  });
  return card;
}

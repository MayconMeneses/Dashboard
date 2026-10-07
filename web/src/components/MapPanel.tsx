import L from 'leaflet';
import 'leaflet.markercluster';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { COLORS, LABEL, filtersToQuery, formatDate } from '../lib/format';
import type { Filters, Locality, MapFeature, Me } from '../lib/types';
import { getBasemaps, initialBasemap } from '../lib/basemaps';
import { useAsync } from '../lib/useAsync';

interface Props {
  me: Me;
  filters: Filters;
  epoch: number;
  selected?: string;
  onSelect: (key: string | undefined) => void;
  focus?: { lat: number; lng: number; n: number };
}

const CROATA_APPROX: L.LatLngTuple = [-4.4, -40.9]; // posição aproximada, usada só quando não há dados
const TYPES = ['localidade', 'area', 'rota', 'visita', 'captura', 'pit', 'outro'] as const;
const TYPE_LABEL: Record<string, string> = { localidade: 'Localidades', area: 'Áreas', rota: 'Rotas', visita: 'Visitas', captura: 'Capturas', pit: 'PITs', outro: 'Pontos de referência' };
type Layer = (typeof TYPES)[number];

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function popupHtml(p: MapFeature['properties']): string {
  const rows: string[] = [`<strong>${esc(p.name || LABEL[p.type] || p.type)}</strong>`, `${esc(LABEL[p.type] ?? p.type)}${p.locality_raw ? ' · ' + esc(p.locality_raw) : ''}`];
  if (p.type === 'captura' || p.type === 'visita') rows.push(`Busca: ${esc(LABEL[p.search_result])}`);
  if (p.type === 'captura') rows.push(`Exame: ${esc(LABEL[p.exam_result])}`);
  if (p.channel) rows.push(`Origem: ${p.channel === 'pit' ? 'PIT' : 'Captura em campanha'}`);
  if (p.environment) rows.push(`Ambiente: ${esc(LABEL[p.environment])}`);
  if (p.visit_date) rows.push(`Data: ${formatDate(p.visit_date)}`);
  if (p.species) rows.push(`Espécie: ${esc(p.species)}`);
  if (p.triatomine_count != null) rows.push(`Quantidade: ${p.triatomine_count}`);
  if (p.origin === 'manual') rows.push('Origem: registro manual');
  return rows.join('<br/>');
}

export function MapPanel({ me, filters, epoch, selected, onSelect, focus }: Props) {
  const [colorByExam, setColorByExam] = useState(true);
  const [colorAreas, setColorAreas] = useState(true);
  const enabled = !!me.map.tileUrl;
  const basemaps = useMemo(() => getBasemaps(me.map.cartoKey), [me.map.cartoKey]);
  const [basemap, setBasemap] = useState<string>(() => (enabled ? initialBasemap(basemaps, me.map.cartoKey) : 'none'));
  const tileRef = useRef<L.TileLayer | null>(null);
  const [on, setOn] = useState<Record<Layer, boolean>>({ localidade: true, area: true, rota: true, visita: true, captura: true, pit: true, outro: true });
  const q = filtersToQuery({ ...filters, locality: undefined, q: undefined, layers: [] });
  const { data, loading, error, reload } = useAsync(() => api.get<{ features: MapFeature[] }>(`/api/map?${q}`), [q, epoch]);

  const statsQ = filtersToQuery({ ...filters, locality: undefined, q: undefined, layers: [] });
  const stats = useAsync(() => api.get<Locality[]>(`/api/localities?${statsQ}`), [statsQ, epoch]);
  const statByKey = useMemo(() => new Map((stats.data ?? []).map((l) => [l.key, l])), [stats.data]);
  const boundaryCfg = useAsync(() => api.get<{ geojson: GeoJSON.GeoJsonObject | null; source: string | null }>('/api/boundary'), []);
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const groups = useRef<Partial<Record<Layer, L.LayerGroup>>>({});
  const boundary = useRef<L.GeoJSON | null>(null);
  const markerByRid = useRef(new Map<string, L.Layer>());
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const fitted = useRef(false);

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: true, minZoom: 8, maxZoom: 19 }).setView(CROATA_APPROX, 10);
    L.control.scale({ imperial: false }).addTo(m);
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
  }, [me.map.tileUrl, me.map.attribution]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    tileRef.current?.remove();
    tileRef.current = null;
    const b = basemaps.find((x) => x.id === basemap);
    if (enabled && b) tileRef.current = L.tileLayer(b.url, { attribution: b.attribution, maxZoom: 19, subdomains: b.subdomains ?? 'abc' }).addTo(m);
    try {
      window.localStorage.setItem('basemap', basemap);
    } catch {
      /* preferência não salva; segue funcionando */
    }
  }, [basemap, enabled, basemaps]);

  // (Re)desenha as camadas quando os dados, a seleção ou o modo de cor mudam.
  useEffect(() => {
    const m = map.current;
    if (!m || !data) return;
    for (const g of Object.values(groups.current)) g?.remove();
    boundary.current?.remove();
    groups.current = {};
    markerByRid.current.clear();
    const mk = (t: Layer) => {
      const g: L.LayerGroup = t === 'captura' || t === 'visita' || t === 'pit' || t === 'localidade' || t === 'outro' ? L.markerClusterGroup({ maxClusterRadius: 40 }) : L.layerGroup();
      groups.current[t] = g;
      return g;
    };
    for (const t of TYPES) mk(t);
    const bounds = L.latLngBounds([]);
    const selBounds = L.latLngBounds([]);
    const boundaryFeatures: MapFeature[] = [];
    for (const f of data.features) {
      const p = f.properties;
      const dimmed = !!selected && p.locality_key !== selected && p.type !== 'area';
      const isSel = !!selected && p.locality_key === selected;
      const t = (TYPES as readonly string[]).includes(p.type) ? (p.type as Layer) : null;
      if (p.is_boundary) {
        boundaryFeatures.push(f);
        continue;
      }
      if (!t) continue;
      const g = groups.current[t]!;
      let layer: L.Layer;
      if (f.geometry.type === 'Point') {
        const [lng, lat] = f.geometry.coordinates as [number, number];
        const ll = L.latLng(lat, lng);
        bounds.extend(ll);
        if (isSel) selBounds.extend(ll);
        if (t === 'pit') layer = L.marker(ll, { icon: L.divIcon({ className: '', html: '<div class="pit-icon"></div>', iconSize: [14, 14] }), opacity: dimmed ? 0.35 : 1 });
        else if (t === 'visita') layer = L.marker(ll, { icon: L.divIcon({ className: '', html: '<div class="visit-icon"></div>', iconSize: [16, 14] }), opacity: dimmed ? 0.35 : 1 });
        else {
          const ref = t === 'localidade' || t === 'outro';
          const color = t === 'captura' && colorByExam ? (COLORS[p.exam_result] ?? '#6b7280') : t === 'localidade' ? '#334155' : t === 'outro' ? '#94a3b8' : '#0f766e';
          layer = L.circleMarker(ll, { radius: ref ? 4 : isSel ? 9 : 7, color: '#ffffff', weight: 2, fillColor: color, fillOpacity: dimmed ? 0.3 : 0.95, opacity: dimmed ? 0.4 : 1 });
        }
      } else {
        const st = p.locality_key ? statByKey.get(p.locality_key) : undefined;
        const area = t === 'localidade' && f.geometry.type === 'Polygon';
        const fill = !colorAreas || !area ? '#0f766e' : (st?.positivos ?? 0) > 0 ? '#c0392b' : (st?.capturas ?? 0) > 0 ? '#2563eb' : '#94a3b8';
        const baseStyle = {
          color: isSel ? '#b45309' : t === 'rota' ? '#7c3aed' : area && colorAreas ? fill : '#0f766e',
          weight: isSel ? 4 : 2,
          fillColor: fill,
          fillOpacity: area ? (isSel ? 0.45 : colorAreas && (st?.capturas ?? 0) > 0 ? 0.3 : 0.12) : 0.05,
          opacity: dimmed ? 0.45 : 1,
        };
        const gj = L.geoJSON({ type: 'Feature', geometry: f.geometry, properties: {} } as GeoJSON.Feature, { style: () => baseStyle });
        if (area) {
          const label = `<strong>${esc(p.name || p.locality_raw)}</strong><br/>${st ? `${st.capturas} captura(s) · ${st.positivos ?? 0} positivo(s) · ${st.negativos ?? 0} negativo(s)` : 'sem registros'}`;
          gj.eachLayer((l) => {
            l.bindTooltip(label, { sticky: true, direction: 'top', className: 'area-tip' });
            l.on('mouseover', () => (l as L.Path).setStyle({ weight: 4, fillOpacity: Math.min(0.6, baseStyle.fillOpacity + 0.25) }));
            l.on('mouseout', () => (l as L.Path).setStyle(baseStyle));
          });
        }
        gj.eachLayer((l) => {
          const lb = (l as L.Polygon).getBounds?.();
          if (lb) {
            bounds.extend(lb);
            if (isSel) selBounds.extend(lb);
          }
        });
        layer = gj;
      }
      if (!(t === 'localidade' && f.geometry.type === 'Polygon')) layer.bindPopup(popupHtml(p));
      if (t === 'localidade' || (p.locality_key && t !== 'rota' && t !== 'area')) layer.on('click', () => p.locality_key && selectRef.current(p.locality_key === selected ? undefined : p.locality_key));
      if (t === 'localidade' && f.geometry.type === 'Point') layer.bindTooltip(esc(p.name || p.locality_raw), { direction: 'top' });
      markerByRid.current.set(p.rid, layer);
      g.addLayer(layer);
    }
    const official = boundaryCfg.data?.geojson;
    if (boundaryFeatures.length || official) {
      boundary.current = L.geoJSON((official ?? boundaryFeatures.map((f) => ({ type: 'Feature', geometry: f.geometry, properties: {} }))) as GeoJSON.GeoJsonObject, {
        style: { color: '#1e293b', weight: 3, dashArray: '8 6', fill: true, fillOpacity: 0.02 },
        interactive: false,
      }).addTo(m);
      bounds.extend(boundary.current.getBounds());
    }
    for (const t of TYPES) if (on[t]) groups.current[t]!.addTo(m);
    if (selected && selBounds.isValid()) m.flyToBounds(selBounds.pad(0.4), { maxZoom: 15, animate: !window.matchMedia('(prefers-reduced-motion: reduce)').matches });
    else if (!fitted.current && bounds.isValid()) {
      m.fitBounds(bounds.pad(0.05));
      fitted.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, selected, colorByExam, colorAreas, statByKey, boundaryCfg.data]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    for (const t of TYPES) {
      const g = groups.current[t];
      if (!g) continue;
      if (on[t]) g.addTo(m);
      else g.remove();
    }
  }, [on, data]);

  useEffect(() => {
    if (focus && map.current) map.current.flyTo([focus.lat, focus.lng], Math.max(map.current.getZoom(), 16), { animate: !window.matchMedia('(prefers-reduced-motion: reduce)').matches });
  }, [focus]);

  const hasBoundary = !!data?.features.some((f) => f.properties.is_boundary);
  const official = boundaryCfg.data?.source;
  const reset = () => {
    onSelect(undefined);
    fitted.current = false;
    reload();
  };

  return (
    <section className="card" aria-label="Mapa">
      <h2>Mapa de Croatá e localidades</h2>
      <div className="toolbar">
        <fieldset>
          <legend>Camadas</legend>
          <div className="checks">
            {TYPES.map((t) => (
              <label key={t}>
                <input type="checkbox" checked={on[t]} onChange={() => setOn((o) => ({ ...o, [t]: !o[t] }))} />
                {TYPE_LABEL[t]}
              </label>
            ))}
            <label>
              <input type="checkbox" checked={colorByExam} onChange={(e) => setColorByExam(e.target.checked)} />
              Cor pelo resultado do exame
            </label>
            <label>
              <input type="checkbox" checked={colorAreas} onChange={(e) => setColorAreas(e.target.checked)} />
              Colorir áreas pela positividade
            </label>
          </div>
        </fieldset>
        <label className="field">
          Mapa-base
          <select value={basemap} onChange={(e) => setBasemap(e.target.value)} disabled={!enabled}>
            {basemaps.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
            <option value="none">Sem mapa-base (nenhuma requisição externa)</option>
          </select>
        </label>
        <button className="small" onClick={reset}>
          Voltar ao município
        </button>
      </div>
      {error && (
        <div className="notice erro" role="alert">
          {error} <button className="small" onClick={reload}>Tentar de novo</button>
        </div>
      )}
      <div ref={el} id="map" role="region" aria-label="Mapa interativo" aria-busy={loading} />
      <div className="legend" aria-label="Legenda">
        <span><span className="dot" style={{ background: COLORS.positivo }} />Captura – exame positivo</span>
        <span><span className="dot" style={{ background: COLORS.negativo }} />Captura – exame negativo</span>
        <span><span className="dot" style={{ background: COLORS.pendente }} />Pendente</span>
        <span><span className="dot" style={{ background: COLORS.nao_realizado }} />Não realizado / não informado</span>
        <span><span className="dot" style={{ background: '#c0392b', opacity: 0.5 }} />Área com exame positivo</span>
        <span><span className="dot" style={{ background: '#2563eb', opacity: 0.5 }} />Área só com negativos/sem resultado</span>
        <span><span className="dot" style={{ background: '#94a3b8' }} />Área sem capturas</span>
        <span>▲ Visita</span>
        <span><span className="dot" style={{ background: '#334155', width: 8, height: 8 }} />Localidade (ponto)</span>
        <span>■ PIT</span>
      </div>
      <p className="small muted" style={{ margin: '8px 0 0' }}>
        {official ? `Limite municipal: ${official}.` : hasBoundary ? 'Limite municipal: polígono presente no arquivo importado.' : 'Limite municipal não carregado: o arquivo não o traz e nenhum limite oficial foi configurado. O mapa enquadra os dados importados.'}{' '}
        {enabled ? (basemap === 'none' ? 'Sem mapa-base.' : `Mapa-base: ${basemaps.find((b) => b.id === basemap)?.attribution}. A região visualizada é pedida ao provedor do mapa.`) : 'Mapa-base desativado pelo administrador.'}
      </p>
    </section>
  );
}

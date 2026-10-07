import L from 'leaflet';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { getBasemaps, initialBasemap } from '../lib/basemaps';
import { registerPrintHook } from '../lib/printHooks';
import type { Me } from '../lib/types';
import { useAsync } from '../lib/useAsync';

interface AreaFeature {
  type: 'Feature';
  geometry: { type: string; coordinates: unknown };
  properties: { rid: string; name: string | null; locality_raw: string | null };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * Mapa só com as áreas das localidades do município (pasta "Area das Localidades" do KML).
 * Ao passar o mouse mostra apenas o nome da localidade: nenhuma informação de triatomíneos.
 */
export function LocalityNamesMap({ me }: { me: Me }) {
  const enabled = !!me.map.tileUrl;
  const basemaps = useMemo(() => getBasemaps(me.map.cartoKey), [me.map.cartoKey]);
  const [basemap, setBasemap] = useState<string>(() => (enabled ? initialBasemap(basemaps, me.map.cartoKey) : 'none'));
  const [hovered, setHovered] = useState<string | null>(null);
  const [tileFail, setTileFail] = useState(false);
  const areas = useAsync(() => api.get<{ features: AreaFeature[] }>('/api/map?layers=localidade'), []);
  const boundary = useAsync(() => api.get<{ geojson: GeoJSON.GeoJsonObject | null; source: string | null }>('/api/boundary'), []);
  const polys = useMemo(() => (areas.data?.features ?? []).filter((f) => f.geometry.type === 'Polygon'), [areas.data]);
  const names = useMemo(() => [...new Set(polys.map((f) => f.properties.name || f.properties.locality_raw || '').filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [polys]);

  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const tile = useRef<L.TileLayer | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const home = useRef<L.LatLngBounds | null>(null);

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { minZoom: 8, maxZoom: 19, zoomSnap: 0.25 }).setView([-4.4, -40.9], 10);
    L.control.scale({ imperial: false }).addTo(m);
    map.current = m;
    layer.current = L.layerGroup().addTo(m);
    // Ao imprimir/gerar PDF a largura muda: reajusta o tamanho e enquadra o município inteiro.
    const refit = () => {
      m.invalidateSize({ animate: false });
      if (home.current?.isValid()) m.fitBounds(home.current.pad(0.03), { animate: false });
    };
    const unregister = registerPrintHook(refit);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => (window.matchMedia?.('print').matches ? refit() : m.invalidateSize({ animate: false }))) : null;
    ro?.observe(el.current);
    return () => {
      unregister();
      ro?.disconnect();
      m.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    tile.current?.remove();
    tile.current = null;
    const b = basemaps.find((x) => x.id === basemap);
    setTileFail(false);
    if (enabled && b) {
      const t = L.tileLayer(b.url, { attribution: b.attribution, maxZoom: 19, subdomains: b.subdomains ?? 'abc' });
      let ok = 0;
      let bad = 0;
      t.on('tileload', () => ok++);
      t.on('tileerror', () => {
        bad++;
        if (bad >= 4 && ok === 0) setTileFail(true);
      });
      tile.current = t.addTo(m);
    }
  }, [basemap, enabled, basemaps]);

  useEffect(() => {
    const m = map.current;
    const g = layer.current;
    if (!m || !g || !areas.data) return;
    g.clearLayers();
    const bounds = L.latLngBounds([]);
    const base: L.PathOptions = { color: '#0f766e', weight: 1.5, fillColor: '#0f766e', fillOpacity: 0.22 };
    const hover: L.PathOptions = { color: '#b45309', weight: 3, fillColor: '#f59e0b', fillOpacity: 0.55 };
    const official = boundary.data?.geojson;
    if (official) {
      const b = L.geoJSON(official, { style: { color: '#1e293b', weight: 3, dashArray: '8 6', fill: false }, interactive: false }).addTo(g);
      bounds.extend(b.getBounds());
    }
    for (const f of polys) {
      const name = f.properties.name || f.properties.locality_raw || '(sem nome)';
      const gj = L.geoJSON({ type: 'Feature', geometry: f.geometry, properties: {} } as GeoJSON.Feature, { style: () => base });
      gj.eachLayer((l) => {
        l.bindTooltip(`<strong>${esc(name)}</strong>`, { sticky: true, direction: 'top' });
        l.on('mouseover', () => {
          (l as L.Path).setStyle(hover);
          (l as L.Path).bringToFront();
          setHovered(name);
        });
        l.on('mouseout', () => {
          (l as L.Path).setStyle(base);
          setHovered(null);
        });
      });
      gj.addTo(g);
      bounds.extend(gj.getBounds());
    }
    if (bounds.isValid()) {
      home.current = bounds;
      m.fitBounds(bounds.pad(0.03));
    }
  }, [polys, boundary.data, areas.data]);

  return (
    <section className="card" aria-label="Localidades do município">
      <h2>Localidades do município</h2>
      <div className="toolbar">
        <span className="small muted" aria-live="polite">
          {areas.loading && !areas.data ? 'Carregando…' : `${names.length} localidades. `}
          {hovered ? <strong style={{ color: 'var(--text)' }}>{hovered}</strong> : 'Passe o mouse sobre uma área para ver o nome.'}
        </span>
        <label className="field">
          Mapa-base
          <select value={basemap} onChange={(e) => { setBasemap(e.target.value); try { window.localStorage.setItem('basemap', e.target.value); } catch { /* preferência não salva */ } }} disabled={!enabled}>
            {basemaps.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
            <option value="none">Sem mapa-base</option>
          </select>
        </label>
        <button className="small" onClick={() => home.current && map.current?.fitBounds(home.current.pad(0.03))}>
          Voltar ao município
        </button>
      </div>
      {areas.error && <div className="notice erro" role="alert">{areas.error} <button className="small" onClick={areas.reload}>Tentar de novo</button></div>}
      {areas.data && polys.length === 0 && <div className="notice info">O arquivo ativo não tem áreas de localidades (pasta “Area das Localidades”).</div>}
      {tileFail && <div className="notice aviso no-print" role="alert">Não foi possível carregar o mapa-base (sem internet, bloqueio de rede ou chave inválida). As áreas continuam aparecendo. Tente outro “Mapa-base” ou escolha “Sem mapa-base”.</div>}
      <div ref={el} id="map-names" role="region" aria-label="Mapa com as áreas das localidades; passe o mouse para ver o nome" aria-busy={areas.loading} />
      <details style={{ marginTop: 8 }}>
        <summary className="small">Ver a lista de localidades ({names.length})</summary>
        <ul className="small names-list">{names.map((n) => <li key={n}>{n}</li>)}</ul>
      </details>
      <p className="small muted" style={{ margin: '8px 0 0' }}>
        Áreas desenhadas por você na pasta “Area das Localidades” do KML. {boundary.data?.source ? `Limite: ${boundary.data.source}.` : ''} Este mapa mostra só os nomes, sem dados de triatomíneos.
      </p>
    </section>
  );
}

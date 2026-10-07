import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import states from '../assets/brasil-estados.json';
import { api } from '../lib/api';
import { COLORS, filtersToQuery } from '../lib/format';
import type { Filters, Locality, MapFeature } from '../lib/types';
import { useAsync } from '../lib/useAsync';

type Ring = [number, number][];

/** Extremos geográficos do Ceará, usados só para posicionar o marcador no mapa esquemático. */
const CE_GEO = { w: -41.423, e: -37.253, n: -2.784, s: -7.857 };
const CROATA = { lon: -40.91, lat: -4.42 };

interface Props {
  filters: Filters;
  epoch: number;
  selected?: string;
  onSelect: (key: string | undefined) => void;
}

function ringsToPath(rings: Ring[], proj: (lon: number, lat: number) => [number, number]): string {
  return rings
    .map((r) => 'M' + r.map(([lon, lat]) => proj(lon, lat).map((n) => n.toFixed(1)).join(' ')).join('L') + 'Z')
    .join('');
}

function polygonsOf(g: GeoJSON.GeoJsonObject | null | undefined): Ring[][] {
  if (!g) return [];
  if (g.type === 'FeatureCollection') return (g as GeoJSON.FeatureCollection).features.flatMap((f) => polygonsOf(f.geometry));
  if (g.type === 'Feature') return polygonsOf((g as GeoJSON.Feature).geometry);
  if (g.type === 'Polygon') return [(g as GeoJSON.Polygon).coordinates as Ring[]];
  if (g.type === 'MultiPolygon') return (g as GeoJSON.MultiPolygon).coordinates as Ring[][];
  return [];
}

export function LocationMaps({ filters, epoch, selected, onSelect }: Props) {
  const ceRef = useRef<SVGPathElement>(null);
  const [ceBox, setCeBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    try {
      const b = ceRef.current?.getBBox();
      if (b) setCeBox({ x: b.x, y: b.y, width: b.width, height: b.height });
    } catch {
      /* sem getBBox (ex.: ambiente de teste): usa moldura padrão */
    }
  }, []);
  const ce = states.states.find((s) => s.id === 'ce')!;
  const box = ceBox ?? { x: 380, y: 100, width: 120, height: 140 };
  const marker = {
    x: box.x + ((CROATA.lon - CE_GEO.w) / (CE_GEO.e - CE_GEO.w)) * box.width,
    y: box.y + ((CE_GEO.n - CROATA.lat) / (CE_GEO.n - CE_GEO.s)) * box.height,
  };

  const q = filtersToQuery({ ...filters, locality: undefined, q: undefined, layers: [] });
  const boundary = useAsync(() => api.get<{ geojson: GeoJSON.GeoJsonObject | null; source: string | null }>('/api/boundary'), []);
  const map = useAsync(() => api.get<{ features: MapFeature[] }>(`/api/map?${q}`), [q, epoch]);
  const locs = useAsync(() => api.get<Locality[]>(`/api/localities?${q}`), [q, epoch]);
  const stat = useMemo(() => new Map((locs.data ?? []).map((l) => [l.key, l])), [locs.data]);
  const [hover, setHover] = useState<{ key: string; name: string; x: number; y: number } | null>(null);

  const view = useMemo(() => {
    const polys = polygonsOf(boundary.data?.geojson);
    const areas = (map.data?.features ?? []).filter((f) => f.properties.type === 'localidade' && f.geometry.type === 'Polygon');
    const rings: Ring[] = polys.length ? polys.flat() : areas.flatMap((f) => f.geometry.coordinates as Ring[]);
    if (!rings.length) return null;
    const lons = rings.flat().map((p) => p[0]);
    const lats = rings.flat().map((p) => p[1]);
    const [w, e, s, n] = [Math.min(...lons), Math.max(...lons), Math.min(...lats), Math.max(...lats)];
    const k = Math.cos((((s + n) / 2) * Math.PI) / 180);
    const proj = (lon: number, lat: number): [number, number] => [(lon - w) * k * 1000, (n - lat) * 1000];
    const width = (e - w) * k * 1000;
    const height = (n - s) * 1000;
    return { proj, vb: `${-width * 0.02} ${-height * 0.02} ${width * 1.04} ${height * 1.04}`, boundary: polys.map((p) => ringsToPath(p, proj)).join(''), areas };
  }, [boundary.data, map.data]);

  const areaFill = (key: string | null) => {
    const st = key ? stat.get(key) : undefined;
    return (st?.positivos ?? 0) > 0 ? COLORS.positivo! : (st?.capturas ?? 0) > 0 ? COLORS.negativo! : '#94a3b8';
  };
  const dots = (map.data?.features ?? []).filter((f) => f.properties.type === 'captura' && f.geometry.type === 'Point');

  return (
    <section className="card" aria-label="Onde fica Croatá">
      <h2>Onde fica Croatá</h2>
      <div className="loc-grid">
        <figure className="loc">
          <figcaption>Brasil</figcaption>
          <svg viewBox="0 0 613 639" role="img" aria-label="Mapa do Brasil com o Ceará destacado">
            {states.states.map((s) => (
              <path key={s.id} d={s.path} fill={s.id === 'ce' ? 'var(--accent)' : 'var(--border)'} stroke="var(--surface)" strokeWidth={0.8} />
            ))}
          </svg>
          <p className="small muted">Ceará em destaque (mapa esquemático).</p>
        </figure>

        <figure className="loc">
          <figcaption>Ceará</figcaption>
          <svg viewBox={`${box.x - 6} ${box.y - 6} ${box.width + 12} ${box.height + 12}`} role="img" aria-label="Mapa do Ceará com a posição de Croatá">
            <path ref={ceRef} d={ce.path} fill="var(--border)" stroke="var(--muted)" strokeWidth={0.6} />
            <circle cx={marker.x} cy={marker.y} r={box.width * 0.035} fill={COLORS.positivo} stroke="#fff" strokeWidth={0.8} />
            <text x={marker.x + box.width * 0.06} y={marker.y + 1.5} fontSize={box.width * 0.075} fill="var(--text)" fontWeight="600">
              Croatá
            </text>
          </svg>
          <p className="small muted">Mapa esquemático; posição de Croatá aproximada.</p>
        </figure>

        <figure className="loc loc-croata">
          <figcaption>Croatá e suas localidades</figcaption>
          {!view && !map.loading && <div className="notice info">Sem áreas de localidades no arquivo ativo.</div>}
          {view && (
            <div className="loc-svg-wrap">
              <svg viewBox={view.vb} role="group" aria-label="Mapa de Croatá com as áreas das localidades" onMouseLeave={() => setHover(null)}>
                {view.boundary && <path d={view.boundary} fill="var(--surface)" stroke="var(--text)" strokeWidth={4} strokeDasharray="14 8" />}
                {view.areas.map((f) => {
                  const key = f.properties.locality_key;
                  const name = f.properties.name || f.properties.locality_raw || '';
                  const isSel = !!key && key === selected;
                  const st = key ? stat.get(key) : undefined;
                  const d = ringsToPath(f.geometry.coordinates as Ring[], view.proj);
                  return (
                    <path
                      key={f.properties.rid}
                      d={d}
                      fill={areaFill(key)}
                      fillOpacity={isSel ? 0.6 : hover?.key === key ? 0.55 : (st?.capturas ?? 0) > 0 ? 0.35 : 0.18}
                      stroke={isSel ? '#b45309' : areaFill(key)}
                      strokeWidth={isSel ? 5 : 2}
                      tabIndex={0}
                      role="button"
                      aria-label={`${name}: ${st?.capturas ?? 0} captura(s), ${st?.positivos ?? 0} positivo(s)`}
                      onMouseMove={(e) => {
                        const r = (e.currentTarget.ownerSVGElement?.parentElement as HTMLElement).getBoundingClientRect();
                        setHover({ key: key ?? '', name, x: e.clientX - r.left, y: e.clientY - r.top });
                      }}
                      onFocus={() => setHover(null)}
                      onClick={() => key && onSelect(key === selected ? undefined : key)}
                      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && key && (e.preventDefault(), onSelect(key === selected ? undefined : key))}
                      style={{ cursor: 'pointer' }}
                    >
                      <title>{name}</title>
                    </path>
                  );
                })}
                {dots.map((f) => {
                  const [lon, lat] = f.geometry.coordinates as [number, number];
                  const [x, y] = view.proj(lon, lat);
                  return <circle key={f.properties.rid} cx={x} cy={y} r={6} fill={COLORS[f.properties.exam_result] ?? '#6b7280'} stroke="#fff" strokeWidth={1.5} pointerEvents="none" />;
                })}
              </svg>
              {hover && hover.name && (
                <div className="area-tooltip" style={{ left: hover.x + 12, top: hover.y + 12 }} role="tooltip">
                  <strong>{hover.name}</strong>
                  <br />
                  {(() => {
                    const st = stat.get(hover.key);
                    return st ? `${st.capturas} captura(s) · ${st.positivos ?? 0} positivo(s) · ${st.negativos ?? 0} negativo(s)` : 'sem registros';
                  })()}
                </div>
              )}
            </div>
          )}
          <span className="legend-row" role="group" aria-label="Legenda das áreas" style={{ margin: '6px 0' }}>
            <span className="swatch-item"><span className="swatch" style={{ background: COLORS.positivo }} aria-hidden="true" />Área com exame positivo</span>
            <span className="swatch-item"><span className="swatch" style={{ background: COLORS.negativo }} aria-hidden="true" />Área só com negativos ou sem resultado</span>
            <span className="swatch-item"><span className="swatch" style={{ background: '#94a3b8' }} aria-hidden="true" />Área sem capturas</span>
          </span>
          <p className="small muted">
            Passe o mouse sobre uma área para ver o nome; clique para selecionar.{' '}
            {boundary.data?.source ? `Limite: ${boundary.data.source}.` : 'Limite municipal não carregado.'}
          </p>
        </figure>
      </div>
      <p className="small muted" style={{ marginBottom: 0 }}>Brasil e Ceará: mapa esquemático © @svg-maps/brazil (CC BY 4.0).</p>
    </section>
  );
}

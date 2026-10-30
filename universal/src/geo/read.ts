import type { Geometry, Pos } from './geometry.js';

export interface GeoFeature {
  properties: Record<string, unknown>;
  geometry: Geometry | null;
}

const isNum = (x: unknown): x is number => typeof x === 'number';
const pos = (c: unknown): Pos | null => (Array.isArray(c) && c.length >= 2 && isNum(c[0]) && isNum(c[1]) ? [c[0], c[1]] : null);
const list = (c: unknown): Pos[] | null => {
  if (!Array.isArray(c)) return null;
  const r = c.map(pos);
  return r.every((p): p is Pos => p != null) ? r : null;
};
const lists = <T>(c: unknown, f: (x: unknown) => T[] | null): T[][] | null => {
  if (!Array.isArray(c)) return null;
  const r = c.map(f);
  return r.every((x): x is T[] => x != null) ? r : null;
};

/** Converte o objeto de geometria do GeoJSON no formato interno; devolve null se a estrutura não for válida. */
export function toGeometry(raw: unknown): Geometry | null {
  if (!raw || typeof raw !== 'object') return null;
  const g = raw as { type?: string; coordinates?: unknown; geometries?: unknown };
  switch (g.type) {
    case 'Point': {
      const p = pos(g.coordinates);
      return p ? { type: 'Point', coordinates: p } : null;
    }
    case 'MultiPoint': {
      const l = list(g.coordinates);
      return l ? { type: 'MultiPoint', coordinates: l } : null;
    }
    case 'LineString': {
      const l = list(g.coordinates);
      return l ? { type: 'LineString', coordinates: l } : null;
    }
    case 'MultiLineString': {
      const l = lists(g.coordinates, list);
      return l ? { type: 'MultiLineString', coordinates: l } : null;
    }
    case 'Polygon': {
      const l = lists(g.coordinates, list);
      return l && l.length ? { type: 'Polygon', coordinates: l } : null;
    }
    case 'MultiPolygon': {
      const l = lists(g.coordinates, (x) => lists(x, list));
      return l ? { type: 'MultiPolygon', coordinates: l } : null;
    }
    case 'GeometryCollection': {
      if (!Array.isArray(g.geometries)) return null;
      const gs = g.geometries.map(toGeometry);
      return gs.every((x): x is Geometry => x != null) ? { type: 'GeometryCollection', geometries: gs } : null;
    }
    default:
      return null;
  }
}

/** Lê GeoJSON em qualquer forma comum: FeatureCollection, Feature isolada ou geometria solta. */
export function readGeoJson(j: unknown): { features: GeoFeature[]; problems: string[] } {
  const problems: string[] = [];
  const o = (j ?? {}) as { type?: string; features?: unknown[]; crs?: { properties?: { name?: unknown } } };
  const crs = o.crs?.properties?.name;
  if (typeof crs === 'string' && !/CRS84|4326/i.test(crs)) problems.push(`O arquivo declara o sistema de coordenadas “${crs}”, diferente de WGS84 (EPSG:4326). Converta para WGS84 antes de importar; o painel não reprojeta.`);
  const raws: { properties?: unknown; geometry?: unknown }[] = o.type === 'FeatureCollection' ? ((o.features ?? []) as { properties?: unknown; geometry?: unknown }[]) : o.type === 'Feature' ? [o as never] : [{ properties: {}, geometry: o }];
  const features = raws.map((f, i): GeoFeature => {
    const properties = f.properties && typeof f.properties === 'object' ? (f.properties as Record<string, unknown>) : {};
    if (f.geometry == null) return { properties, geometry: null };
    const geometry = toGeometry(f.geometry);
    if (!geometry) problems.push(`Feição ${i + 1}: geometria do tipo “${String((f.geometry as { type?: unknown }).type)}” não é suportada ou está malformada; a linha fica sem forma no mapa.`);
    return { properties, geometry };
  });
  return { features, problems };
}

const arr = <T>(x: T | T[] | undefined): T[] => (x == null ? [] : Array.isArray(x) ? x : [x]);
const textOf = (x: unknown): string => (typeof x === 'string' ? x : x && typeof x === 'object' && typeof (x as { '#text'?: unknown })['#text'] === 'string' ? (x as { '#text': string })['#text'] : '');

/** “lon,lat[,alt] lon,lat…” do KML. Posição malformada invalida o anel (devolve null). */
function kmlCoords(node: unknown): Pos[] | null {
  const s = textOf((node as { coordinates?: unknown } | undefined)?.coordinates).trim();
  if (!s) return null;
  const r = s.split(/\s+/).map((t) => t.split(',').map(Number));
  return r.every((a) => a.length >= 2 && Number.isFinite(a[0]) && Number.isFinite(a[1])) ? r.map((a) => [a[0]!, a[1]!] as Pos) : null;
}

type Node = Record<string, unknown>;

function kmlCollect(n: Node, out: Geometry[]): void {
  for (const p of arr(n.Point as Node | Node[] | undefined)) {
    const c = kmlCoords(p);
    if (c?.[0]) out.push({ type: 'Point', coordinates: c[0] });
  }
  for (const l of arr(n.LineString as Node | Node[] | undefined)) {
    const c = kmlCoords(l);
    if (c) out.push({ type: 'LineString', coordinates: c });
  }
  for (const pg of arr(n.Polygon as Node | Node[] | undefined)) {
    const ring = (b: unknown) => kmlCoords((b as { LinearRing?: unknown } | undefined)?.LinearRing);
    const outer = ring(pg.outerBoundaryIs);
    if (!outer) continue;
    const holes = arr(pg.innerBoundaryIs as unknown).map(ring).filter((r): r is Pos[] => r != null);
    out.push({ type: 'Polygon', coordinates: [outer, ...holes] });
  }
  for (const m of arr(n.MultiGeometry as Node | Node[] | undefined)) kmlCollect(m, out);
}

/** Geometria de um Placemark do KML (Point, LineString, Polygon com furos e MultiGeometry). */
export function kmlGeometry(pm: Node): Geometry | null {
  const gs: Geometry[] = [];
  kmlCollect(pm, gs);
  if (!gs.length) return null;
  if (gs.length === 1) return gs[0]!;
  const same = (t: Geometry['type']) => gs.every((g) => g.type === t);
  if (same('Point')) return { type: 'MultiPoint', coordinates: gs.map((g) => (g as { coordinates: Pos }).coordinates) };
  if (same('LineString')) return { type: 'MultiLineString', coordinates: gs.map((g) => (g as { coordinates: Pos[] }).coordinates) };
  if (same('Polygon')) return { type: 'MultiPolygon', coordinates: gs.map((g) => (g as { coordinates: Pos[][] }).coordinates) };
  return { type: 'GeometryCollection', geometries: gs };
}

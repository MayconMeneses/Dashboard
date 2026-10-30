import { toNumber } from '../profile.js';
import type { Row, Table } from '../types.js';
import type { Geometry } from './geometry.js';

export interface ExportFeature {
  type: 'Feature';
  properties: Record<string, unknown>;
  geometry: Geometry;
}

/** GeoJSON (WGS84) das linhas informadas (por exemplo, as filtradas), com a geometria real quando guardada; linha sem geometria nem ponto é omitida. */
export function toGeoJson(t: Pick<Table, 'columns' | 'geo' | 'shapes'>, rows: Row[]): { type: 'FeatureCollection'; features: ExportFeature[] } {
  const skip = new Set([t.geo?.lat, t.geo?.lon, t.geo?.id].filter((x): x is string => !!x));
  const features: ExportFeature[] = [];
  for (const r of rows) {
    const id = t.geo?.id ? r[t.geo.id] : null;
    let geometry: Geometry | undefined = id != null ? t.shapes?.[String(id)] : undefined;
    if (!geometry && t.geo) {
      const lat = toNumber(r[t.geo.lat] ?? null);
      const lon = toNumber(r[t.geo.lon] ?? null);
      if (lat != null && lon != null) geometry = { type: 'Point', coordinates: [lon, lat] };
    }
    if (!geometry) continue;
    const properties: Record<string, unknown> = {};
    for (const c of t.columns) if (!skip.has(c)) properties[c] = r[c] instanceof Date ? (r[c] as Date).toISOString() : (r[c] ?? null);
    features.push({ type: 'Feature', properties, geometry });
  }
  return { type: 'FeatureCollection', features };
}

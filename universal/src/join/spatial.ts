import { bbox, containsPoint, parts } from '../geo/geometry.js';
import type { Geometry } from '../geo/geometry.js';
import { toNumber } from '../profile.js';
import type { Table } from '../types.js';

/**
 * Conta os pontos de `points` dentro de cada polígono de `polys` (pela coluna de forma). Ponto em polígonos sobrepostos conta em todos;
 * ponto em buraco não conta. `outside` são os pontos válidos fora de qualquer polígono; `invalid`, os sem coordenada válida.
 */
export function countPointsIn(polys: Table, points: Table): { counts: Record<string, number>; outside: number; invalid: number } {
  const idCol = polys.geo?.id;
  const counts: Record<string, number> = {};
  const cands: { id: string; g: Geometry; minLon: number; minLat: number; maxLon: number; maxLat: number }[] = [];
  for (const [id, g] of Object.entries(polys.shapes ?? {})) {
    if (!parts(g).polys.length) continue;
    const b = bbox(g);
    if (b) cands.push({ id, g, ...b });
    counts[id] = 0;
  }
  void idCol;
  let outside = 0;
  let invalid = 0;
  const latC = points.geo?.lat;
  const lonC = points.geo?.lon;
  for (const r of points.rows) {
    const lat = latC ? toNumber(r[latC] ?? null) : null;
    const lon = lonC ? toNumber(r[lonC] ?? null) : null;
    if (lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      invalid++;
      continue;
    }
    let inAny = false;
    for (const c of cands) {
      if (lon < c.minLon || lon > c.maxLon || lat < c.minLat || lat > c.maxLat) continue;
      if (containsPoint(c.g, [lon, lat])) {
        counts[c.id]!++;
        inAny = true;
      }
    }
    if (!inAny) outside++;
  }
  return { counts, outside, invalid };
}

import { centroidOf, validateGeometry } from './geometry.js';
import type { Geometry } from './geometry.js';

export const GEO_ID = 'id_geom';

/**
 * Acrescenta a cada linha o identificador da forma, o ponto de referência (latitude/longitude) e o tipo de geometria,
 * guarda as formas reais à parte e resume em notas o que a validação achou (nada é descartado nem corrigido em silêncio).
 */
export function attachGeometry(rows: Record<string, unknown>[], geoms: (Geometry | null)[], problems: string[] = []): { shapes: Record<string, Geometry>; notes: string[] } {
  const shapes: Record<string, Geometry> = {};
  const count = new Map<string, number>();
  rows.forEach((row, i) => {
    const g = geoms[i] ?? null;
    const c = g ? centroidOf(g) : null;
    if (g) {
      const id = `g${i + 1}`;
      shapes[id] = g;
      row[GEO_ID] = id;
      for (const p of validateGeometry(g)) count.set(p, (count.get(p) ?? 0) + 1);
    } else row[GEO_ID] = null;
    row.latitude = c ? c[1] : null;
    row.longitude = c ? c[0] : null;
    row.geometria = g?.type ?? null;
  });
  const notes = [...problems.slice(0, 5), ...[...count].map(([p, n]) => `Geografia: ${n} feição(ões) com problema — ${p}.`)];
  const sem = geoms.filter((g) => !g).length;
  if (sem) notes.push(`Geografia: ${sem} linha(s) sem geometria; ficam fora do mapa.`);
  return { shapes, notes };
}

const TYPES = new Set(['Feature', 'FeatureCollection', 'Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon', 'GeometryCollection']);
export const isGeoJson = (j: unknown): boolean => !!j && typeof j === 'object' && TYPES.has((j as { type?: string }).type ?? '');

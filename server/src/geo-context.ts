import { existsSync, readFileSync, statSync } from 'node:fs';

type Pt = [number, number];

function dp(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts;
  const [x1, y1] = pts[0]!;
  const [x2, y2] = pts[pts.length - 1]!;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const n = Math.hypot(dx, dy) || 1e-12;
  let md = 0;
  let mi = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs(dy * (pts[i]![0] - x1) - dx * (pts[i]![1] - y1)) / n;
    if (d > md) {
      md = d;
      mi = i;
    }
  }
  if (md <= eps) return [pts[0]!, pts[pts.length - 1]!];
  return [...dp(pts.slice(0, mi + 1), eps).slice(0, -1), ...dp(pts.slice(mi), eps)];
}

/** Simplifica um anel fechado (graus) e arredonda a 3 casas (~100 m). */
export function simplifyRing(ring: Pt[], eps: number): Pt[] {
  if (ring.length < 4) return ring;
  const half = Math.floor(ring.length / 2);
  const a = dp(ring.slice(0, half + 1), eps).slice(0, -1);
  const b = dp([...ring.slice(half), ring[0]!], eps);
  const out = [...a, ...b].map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000] as Pt);
  return out.length >= 4 ? out : ring;
}

const simplifyGeom = (g: { type: string; coordinates?: unknown }, eps: number): unknown => {
  if (g.type === 'Polygon') return { type: 'Polygon', coordinates: (g.coordinates as Pt[][]).map((r) => simplifyRing(r, eps)) };
  if (g.type === 'MultiPolygon') return { type: 'MultiPolygon', coordinates: (g.coordinates as Pt[][][]).map((p) => p.map((r) => simplifyRing(r, eps))) };
  return g;
};

/**
 * Lê um GeoJSON oficial (ex.: IBGE) de contexto — Brasil/UFs ou Ceará — e o simplifica para ficar leve.
 * Devolve null se o arquivo não existe ou não é um GeoJSON de polígonos válido.
 */
export function loadContextGeojson(file: string | null | undefined, tolerance = 0.02): unknown | null {
  if (!file || !existsSync(file) || statSync(file).size > 60 * 1024 * 1024) return null;
  try {
    const g = JSON.parse(readFileSync(file, 'utf8')) as { type?: string; features?: { type: string; geometry: { type: string; coordinates?: unknown }; properties?: unknown }[]; geometry?: { type: string; coordinates?: unknown }; properties?: unknown };
    if (g.type === 'FeatureCollection' && Array.isArray(g.features)) {
      return { type: 'FeatureCollection', features: g.features.filter((f) => f.geometry && /Polygon/.test(f.geometry.type)).map((f) => ({ type: 'Feature', properties: f.properties ?? {}, geometry: simplifyGeom(f.geometry, tolerance) })) };
    }
    if (g.type === 'Feature' && g.geometry && /Polygon/.test(g.geometry.type)) return { type: 'Feature', properties: g.properties ?? {}, geometry: simplifyGeom(g.geometry, tolerance) };
    if (g.type === 'Polygon' || g.type === 'MultiPolygon') return simplifyGeom(g as { type: string; coordinates?: unknown }, tolerance);
    return null;
  } catch {
    return null;
  }
}

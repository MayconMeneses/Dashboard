import type { Coord, Geometry } from './types.js';

export function pointInRing(pt: Coord, ring: Coord[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInPolygon(pt: Coord, rings: Coord[][]): boolean {
  const [outer, ...holes] = rings;
  if (!outer || !pointInRing(pt, outer)) return false;
  return !holes.some((h) => pointInRing(pt, h));
}

export function representativePoint(g: Geometry | null): Coord | null {
  if (!g) return null;
  if (g.type === 'Point') return g.coordinates;
  const pts = g.type === 'LineString' ? g.coordinates : (g.coordinates[0] ?? []);
  if (!pts.length) return null;
  const mid = g.type === 'LineString' ? pts[Math.floor(pts.length / 2)]! : null;
  if (mid) return mid;
  const n = pts.length - (pts.length > 1 && pts[0]![0] === pts[pts.length - 1]![0] && pts[0]![1] === pts[pts.length - 1]![1] ? 1 : 0);
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += pts[i]![0];
    sy += pts[i]![1];
  }
  return [sx / n, sy / n];
}

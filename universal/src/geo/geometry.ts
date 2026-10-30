/** Posição GeoJSON: [longitude, latitude] (a ordem é lon,lat; o Leaflet usa lat,lng). */
export type Pos = [number, number];

export type Geometry =
  | { type: 'Point'; coordinates: Pos }
  | { type: 'MultiPoint'; coordinates: Pos[] }
  | { type: 'LineString'; coordinates: Pos[] }
  | { type: 'MultiLineString'; coordinates: Pos[][] }
  | { type: 'Polygon'; coordinates: Pos[][] }
  | { type: 'MultiPolygon'; coordinates: Pos[][][] }
  | { type: 'GeometryCollection'; geometries: Geometry[] };

interface Parts {
  points: Pos[];
  lines: Pos[][];
  /** cada polígono: anel externo e, depois, os buracos */
  polys: Pos[][][];
}

/** Separa qualquer geometria em pontos, linhas e polígonos. */
export function parts(g: Geometry, out: Parts = { points: [], lines: [], polys: [] }): Parts {
  switch (g.type) {
    case 'Point':
      out.points.push(g.coordinates);
      break;
    case 'MultiPoint':
      out.points.push(...g.coordinates);
      break;
    case 'LineString':
      out.lines.push(g.coordinates);
      break;
    case 'MultiLineString':
      out.lines.push(...g.coordinates);
      break;
    case 'Polygon':
      out.polys.push(g.coordinates);
      break;
    case 'MultiPolygon':
      out.polys.push(...g.coordinates);
      break;
    case 'GeometryCollection':
      g.geometries.forEach((x) => parts(x, out));
      break;
  }
  return out;
}

const allPositions = (p: Parts): Pos[] => [...p.points, ...p.lines.flat(), ...p.polys.flat(2)];

/** Centroide (e área) de um anel pela fórmula do “cadarço”. A conta é plana, em graus: serve para posicionar, não para medir. */
function ringCentroid(ring: Pos[]): { area: number; x: number; y: number } {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = ring[i]!;
    const [x1, y1] = ring[i + 1]!;
    const k = x0 * y1 - x1 * y0;
    a += k;
    cx += (x0 + x1) * k;
    cy += (y0 + y1) * k;
  }
  if (a === 0) {
    const n = Math.max(1, ring.length);
    return { area: 0, x: ring.reduce((s, p) => s + p[0], 0) / n, y: ring.reduce((s, p) => s + p[1], 0) / n };
  }
  return { area: Math.abs(a / 2), x: cx / (3 * a), y: cy / (3 * a) };
}

/**
 * Ponto de referência de uma geometria, em [lon, lat]: polígonos pesam pela área (buracos descontados), linhas pelo comprimento,
 * pontos pela média. Numa coleção mista vale a maior dimensão presente (polígono > linha > ponto).
 */
export function centroidOf(g: Geometry): Pos | null {
  const p = parts(g);
  if (p.polys.length) {
    let area = 0;
    let sx = 0;
    let sy = 0;
    for (const rings of p.polys) {
      const o = ringCentroid(rings[0]!);
      area += o.area;
      sx += o.area * o.x;
      sy += o.area * o.y;
      for (const h of rings.slice(1)) {
        const c = ringCentroid(h);
        area -= c.area;
        sx -= c.area * c.x;
        sy -= c.area * c.y;
      }
    }
    if (area > 0) return [sx / area, sy / area];
    const pts = p.polys.flat(2);
    return pts.length ? [pts.reduce((s, q) => s + q[0], 0) / pts.length, pts.reduce((s, q) => s + q[1], 0) / pts.length] : null;
  }
  if (p.lines.length) {
    let len = 0;
    let sx = 0;
    let sy = 0;
    for (const l of p.lines) {
      for (let i = 0; i < l.length - 1; i++) {
        const d = Math.hypot(l[i + 1]![0] - l[i]![0], l[i + 1]![1] - l[i]![1]);
        len += d;
        sx += d * (l[i]![0] + l[i + 1]![0]) / 2;
        sy += d * (l[i]![1] + l[i + 1]![1]) / 2;
      }
    }
    if (len > 0) return [sx / len, sy / len];
    const pts = p.lines.flat();
    return pts.length ? [pts[0]![0], pts[0]![1]] : null;
  }
  if (p.points.length) return [p.points.reduce((s, q) => s + q[0], 0) / p.points.length, p.points.reduce((s, q) => s + q[1], 0) / p.points.length];
  return null;
}

export function bbox(g: Geometry): { minLon: number; minLat: number; maxLon: number; maxLat: number } | null {
  const pos = allPositions(parts(g));
  if (!pos.length) return null;
  return { minLon: Math.min(...pos.map((p) => p[0])), minLat: Math.min(...pos.map((p) => p[1])), maxLon: Math.max(...pos.map((p) => p[0])), maxLat: Math.max(...pos.map((p) => p[1])) };
}

const inRing = (pt: Pos, ring: Pos[]): boolean => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

/** O ponto está dentro de algum polígono da geometria (anel externo sim, buracos não). Pontos sobre a borda não têm garantia. */
export function containsPoint(g: Geometry, pt: Pos): boolean {
  return parts(g).polys.some((rings) => inRing(pt, rings[0]!) && !rings.slice(1).some((h) => inRing(pt, h)));
}

/** Problemas de uma geometria, em frases. Nada é corrigido nem descartado aqui: quem lê decide e avisa. */
export function validateGeometry(g: Geometry): string[] {
  const out = new Set<string>();
  const p = parts(g);
  const check = (pos: Pos) => {
    const [x, y] = pos;
    if (!Number.isFinite(x) || !Number.isFinite(y)) out.add('coordenada não numérica');
    else if (Math.abs(x) > 1000 || Math.abs(y) > 1000) out.add('coordenadas parecem projetadas (em metros); converta para WGS84 (graus) antes de importar');
    else if (Math.abs(x) > 180 || Math.abs(y) > 90) out.add('coordenada fora do intervalo (longitude de −180 a 180, latitude de −90 a 90)');
  };
  allPositions(p).forEach(check);
  if (p.points.some((q) => q[0] === 0 && q[1] === 0)) out.add('ponto em 0, 0 (costuma ser coordenada vazia)');
  for (const ring of p.polys.flat()) {
    if (ring.length < 4) out.add('anel de polígono com menos de 4 posições');
    else if (ring[0]![0] !== ring[ring.length - 1]![0] || ring[0]![1] !== ring[ring.length - 1]![1]) out.add('anel de polígono não está fechado (primeira e última posição diferentes)');
  }
  return [...out];
}

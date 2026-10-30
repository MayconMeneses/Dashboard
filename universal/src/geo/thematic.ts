/** Quebras de classe por quantis (mesma quantidade de feições por classe). Devolve até k−1 limites crescentes; valor ≤ limite cai na classe do limite. */
export function classBreaks(values: number[], k: number): number[] {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length < 2 || k < 2) return [];
  const out: number[] = [];
  for (let i = 1; i < k; i++) {
    const p = (i * v.length) / k;
    const b = Number.isInteger(p) ? (v[p - 1]! + v[p]!) / 2 : v[Math.floor(p)]!;
    if (b > v[0]! && b < v[v.length - 1]! && b !== out[out.length - 1]) out.push(b);
  }
  return out;
}

export const classOf = (value: number, breaks: number[]): number => {
  const i = breaks.findIndex((b) => value <= b);
  return i < 0 ? breaks.length : i;
};

/** Contagem de pontos [lon, lat] por célula quadrada de `cell` graus. `lon`/`lat` são o canto inferior esquerdo da célula. */
export function gridBins(points: [number, number][], cell: number): { lon: number; lat: number; count: number }[] {
  const m = new Map<string, { lon: number; lat: number; count: number }>();
  for (const [x, y] of points) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const lon = Math.floor(x / cell) * cell;
    const lat = Math.floor(y / cell) * cell;
    const k = `${lon}|${lat}`;
    const e = m.get(k) ?? { lon, lat, count: 0 };
    e.count++;
    m.set(k, e);
  }
  return [...m.values()];
}

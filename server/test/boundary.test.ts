import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pointInPolygon } from '../src/parsing/geo.js';
import { get, setup } from './helpers.js';

const gj = JSON.parse(readFileSync(new URL('../../boundary/croata-ibge.geojson', import.meta.url), 'utf8')) as { features: { geometry: { coordinates: [number, number][][] } }[] };
const ring = gj.features[0]!.geometry.coordinates;

describe('limite municipal de Croatá (IBGE, vetorizado do PDF)', () => {
  it('é um polígono fechado com área plausível (~700 km²)', () => {
    const r = ring[0]!;
    expect(r[0]).toEqual(r[r.length - 1]);
    let a = 0;
    for (let i = 0; i < r.length - 1; i++) {
      const [x1, y1] = r[i]!;
      const [x2, y2] = r[i + 1]!;
      a += ((x2 - x1) * Math.PI) / 180 * (2 + Math.sin((y1 * Math.PI) / 180) + Math.sin((y2 * Math.PI) / 180));
    }
    const km2 = Math.abs(a) * 6371.0088 ** 2 / 2;
    expect(km2).toBeGreaterThan(650);
    expect(km2).toBeLessThan(750);
  });
  it('contém a sede (-4.42, -40.91) e não contém pontos de municípios vizinhos', () => {
    expect(pointInPolygon([-40.91, -4.42], ring)).toBe(true);
    expect(pointInPolygon([-41.3, -4.3], ring)).toBe(false); // Piauí
    expect(pointInPolygon([-40.5, -4.4], ring)).toBe(false); // leste
  });
  it('a API não devolve limite quando nenhum arquivo está configurado', async () => {
    const ctx = await setup();
    expect((await get(ctx, '/api/boundary')).json()).toEqual({ geojson: null, source: null });
  });
});

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadContextGeojson, simplifyRing } from '../src/geo-context.js';

type Pt = [number, number];
const ring = (n: number): Pt[] => {
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) pts.push([i / n, i % 2 === 0 ? 0 : 0.0001]);
  pts.push([1, 1], [0, 1], [0, 0]);
  return pts;
};

describe('geo-context', () => {
  it('simplifica anéis mantendo-os fechados', () => {
    const r = ring(200);
    const out = simplifyRing(r, 0.01);
    expect(out.length).toBeLessThan(r.length);
    expect(out[0]).toEqual(out[out.length - 1]);
  });

  it('carrega e simplifica um GeoJSON de polígonos; ignora arquivo ausente ou inválido', () => {
    const dir = mkdtempSync(join(tmpdir(), 'geoctx-'));
    const ok = join(dir, 'ok.geojson');
    writeFileSync(ok, JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { sigla: 'CE' }, geometry: { type: 'Polygon', coordinates: [ring(100)] } }, { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [0, 0] } }] }));
    const g = loadContextGeojson(ok) as { features: { properties: { sigla: string } }[] };
    expect(g.features).toHaveLength(1);
    expect(g.features[0]!.properties.sigla).toBe('CE');
    const bad = join(dir, 'bad.geojson');
    writeFileSync(bad, 'não é json');
    expect(loadContextGeojson(bad)).toBeNull();
    expect(loadContextGeojson(join(dir, 'nao-existe.geojson'))).toBeNull();
    expect(loadContextGeojson(null)).toBeNull();
  });
});

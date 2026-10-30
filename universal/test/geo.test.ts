// Fase 6: geometrias reais, centroides, validação, pontos em polígono, classes e grade (valores calculados à mão; dados sintéticos).
import { describe, expect, it } from 'vitest';
import { bbox, centroidOf, containsPoint, validateGeometry } from '../src/geo/geometry.js';
import type { Geometry } from '../src/geo/geometry.js';
import { readGeoJson } from '../src/geo/read.js';
import { classBreaks, classOf, gridBins } from '../src/geo/thematic.js';
import { toGeoJson } from '../src/geo/export.js';
import { parseFile } from '../src/parse.js';

const enc = (s: string) => new TextEncoder().encode(s);
// quadrado [0,4]² com buraco [0,2]² no canto: área 12; centroide x = (16·2 − 4·1)/12 = 28/12
const comBuraco: Geometry = {
  type: 'Polygon',
  coordinates: [
    [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]],
    [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]],
  ],
};

describe('centroide', () => {
  it('polígono com buraco: ponderado pela área, não pela média dos vértices', () => {
    const c = centroidOf(comBuraco)!;
    expect(c[0]).toBeCloseTo(28 / 12, 9);
    expect(c[1]).toBeCloseTo(28 / 12, 9);
  });
  it('não depende do sentido de desenho do anel', () => {
    const inv: Geometry = { type: 'Polygon', coordinates: [[[0, 0], [0, 4], [4, 4], [4, 0], [0, 0]], [[0, 0], [0, 2], [2, 2], [2, 0], [0, 0]]] };
    expect(centroidOf(inv)![0]).toBeCloseTo(28 / 12, 9);
  });
  it('MultiPolygon: média ponderada pela área (dois quadrados 2×2 → ponto médio)', () => {
    const m: Geometry = { type: 'MultiPolygon', coordinates: [[[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]], [[[4, 0], [6, 0], [6, 2], [4, 2], [4, 0]]]] };
    expect(centroidOf(m)).toEqual([3, 1]);
  });
  it('linha: pesa pelo comprimento ((0,0)→(10,0)→(10,10) → (7,5; 2,5))', () => {
    expect(centroidOf({ type: 'LineString', coordinates: [[0, 0], [10, 0], [10, 10]] })).toEqual([7.5, 2.5]);
  });
  it('ponto e multiponto', () => {
    expect(centroidOf({ type: 'Point', coordinates: [-40.5, -4.25] })).toEqual([-40.5, -4.25]);
    expect(centroidOf({ type: 'MultiPoint', coordinates: [[0, 0], [2, 4]] })).toEqual([1, 2]);
  });
  it('coleção mista usa a dimensão maior (polígono)', () => {
    const g: Geometry = { type: 'GeometryCollection', geometries: [{ type: 'Point', coordinates: [100, 50] }, { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] }] };
    expect(centroidOf(g)).toEqual([1, 1]);
  });
});

describe('ponto em polígono', () => {
  it('buraco exclui; corpo inclui; fora exclui', () => {
    expect(containsPoint(comBuraco, [3, 3])).toBe(true);
    expect(containsPoint(comBuraco, [1, 1])).toBe(false);
    expect(containsPoint(comBuraco, [5, 5])).toBe(false);
  });
  it('só polígonos contêm pontos (linha não)', () => {
    expect(containsPoint({ type: 'LineString', coordinates: [[0, 0], [1, 1]] }, [0.5, 0.5])).toBe(false);
  });
});

describe('validação geográfica', () => {
  it('geometria correta não gera problema', () => {
    expect(validateGeometry(comBuraco)).toEqual([]);
  });
  it('latitude fora de ±90 e longitude fora de ±180', () => {
    expect(validateGeometry({ type: 'Point', coordinates: [10, 95] }).join(' ')).toMatch(/fora do intervalo/);
    expect(validateGeometry({ type: 'Point', coordinates: [190, 10] }).join(' ')).toMatch(/fora do intervalo/);
  });
  it('coordenadas projetadas (metros) pedem conversão para WGS84', () => {
    expect(validateGeometry({ type: 'Point', coordinates: [500000, 9500000] }).join(' ')).toMatch(/WGS84/);
  });
  it('anel aberto e anel com menos de 4 posições', () => {
    expect(validateGeometry({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]] }).join(' ')).toMatch(/não está fechado/);
    expect(validateGeometry({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [0, 0]]] }).join(' ')).toMatch(/menos de 4/);
  });
  it('ponto em 0,0 e valor não numérico', () => {
    expect(validateGeometry({ type: 'Point', coordinates: [0, 0] }).join(' ')).toMatch(/0, ?0/);
    expect(validateGeometry({ type: 'Point', coordinates: [Number.NaN, 1] }).join(' ')).toMatch(/não numérica/);
  });
  it('caixa envolvente em lon/lat', () => {
    expect(bbox(comBuraco)).toEqual({ minLon: 0, minLat: 0, maxLon: 4, maxLat: 4 });
  });
});

describe('leitura de GeoJSON', () => {
  const poly = { type: 'Polygon', coordinates: comBuraco.type === 'Polygon' ? comBuraco.coordinates : [] };
  it('aceita FeatureCollection, Feature isolada e geometria solta', () => {
    expect(readGeoJson({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { a: 1 }, geometry: poly }] }).features).toHaveLength(1);
    expect(readGeoJson({ type: 'Feature', properties: { a: 1 }, geometry: poly }).features).toHaveLength(1);
    const solta = readGeoJson(poly);
    expect(solta.features).toHaveLength(1);
    expect(solta.features[0]!.properties).toEqual({});
  });
  it('mantém a ordem GeoJSON: longitude primeiro', () => {
    const r = readGeoJson({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [-40, -4] } });
    expect(r.features[0]!.geometry).toEqual({ type: 'Point', coordinates: [-40, -4] });
  });
  it('CRS antigo diferente de WGS84 gera aviso; CRS84 não', () => {
    const base = { type: 'FeatureCollection', features: [] };
    expect(readGeoJson({ ...base, crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::31983' } } }).problems.join(' ')).toMatch(/31983/);
    expect(readGeoJson({ ...base, crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } } }).problems).toEqual([]);
  });
  it('geometria de tipo desconhecido vira aviso, não erro', () => {
    const r = readGeoJson({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Circle', coordinates: [0, 0] } }] });
    expect(r.features[0]!.geometry).toBeNull();
    expect(r.problems.join(' ')).toMatch(/Circle/);
  });
});

describe('arquivos: GeoJSON e KML preservam a geometria real', () => {
  it('GeoJSON poligonal: a geometria é guardada e o centroide vem da área', async () => {
    const gj = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { bairro: 'Centro', pop: 120 }, geometry: comBuraco }, { type: 'Feature', properties: { bairro: 'Praia', pop: 80 }, geometry: { type: 'Point', coordinates: [-40, -4] } }] };
    const ds = await parseFile('b.geojson', enc(JSON.stringify(gj)));
    const t = ds.tables[0]!;
    expect(t.geo?.id).toBeDefined();
    const id = String(t.rows[0]![t.geo!.id!]);
    expect(t.shapes![id]).toEqual(comBuraco);
    expect(t.rows[0]!.longitude as number).toBeCloseTo(28 / 12, 9);
    expect(t.rows[1]!.latitude).toBe(-4);
    expect(t.rows[0]!.geometria).toBe('Polygon');
  });
  it('KML: rota (linha), polígono com furo e multigeometria', async () => {
    const kml = `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>
      <Placemark><name>Rota</name><LineString><coordinates>0,0,0 10,0,0 10,10,0</coordinates></LineString></Placemark>
      <Placemark><name>Lote</name><Polygon><outerBoundaryIs><LinearRing><coordinates>0,0 4,0 4,4 0,4 0,0</coordinates></LinearRing></outerBoundaryIs><innerBoundaryIs><LinearRing><coordinates>0,0 2,0 2,2 0,2 0,0</coordinates></LinearRing></innerBoundaryIs></Polygon></Placemark>
      <Placemark><name>Misto</name><MultiGeometry><Point><coordinates>1,1</coordinates></Point><Point><coordinates>3,3</coordinates></Point></MultiGeometry></Placemark>
    </Document></kml>`;
    const t = (await parseFile('r.kml', enc(kml))).tables[0]!;
    const g = (i: number) => t.shapes![String(t.rows[i]![t.geo!.id!])]!;
    expect(g(0)).toEqual({ type: 'LineString', coordinates: [[0, 0], [10, 0], [10, 10]] });
    expect(t.rows[0]!.longitude).toBe(7.5);
    const lote = g(1);
    expect(lote.type).toBe('Polygon');
    expect(lote.type === 'Polygon' ? lote.coordinates : []).toHaveLength(2);
    expect(t.rows[1]!.longitude as number).toBeCloseTo(28 / 12, 9);
    expect(centroidOf(g(2))).toEqual([2, 2]);
  });
  it('arquivo com coordenada projetada gera aviso nas notas da tabela', async () => {
    const gj = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { n: 1 }, geometry: { type: 'Point', coordinates: [500000, 9500000] } }] };
    const t = (await parseFile('p.geojson', enc(JSON.stringify(gj)))).tables[0]!;
    expect((t.notes ?? []).join(' ')).toMatch(/WGS84/);
  });
});

describe('classes e grade', () => {
  it('quebras por quantis: 1..10 em 5 classes → 2,5 | 4,5 | 6,5 | 8,5', () => {
    const b = classBreaks([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5);
    expect(b).toEqual([2.5, 4.5, 6.5, 8.5]);
    expect([1, 2.5, 3, 4.6, 7, 10].map((v) => classOf(v, b))).toEqual([0, 0, 1, 2, 3, 4]);
  });
  it('valores iguais não criam classes vazias nem quebras repetidas', () => {
    expect(classBreaks([5, 5, 5, 5], 4)).toEqual([]);
  });
  it('a grade distribui todos os pontos válidos (soma = total) e a célula certa recebe cada um', () => {
    const pts: [number, number][] = [[0.1, 0.1], [0.2, 0.3], [1.5, 0.1], [1.6, 1.9], [0.9, 1.1]];
    const g = gridBins(pts, 1);
    expect(g.reduce((a, c) => a + c.count, 0)).toBe(pts.length);
    expect(g.find((c) => c.lon === 0 && c.lat === 0)!.count).toBe(2);
    expect(g.find((c) => c.lon === 1 && c.lat === 1)!.count).toBe(1);
  });
});

describe('exportação GeoJSON', () => {
  it('exporta só as linhas filtradas, com propriedades e a geometria real', () => {
    const t = { name: 't', columns: ['id_geom', 'nome', 'latitude', 'longitude'], geo: { lat: 'latitude', lon: 'longitude', id: 'id_geom' }, shapes: { g1: comBuraco, g2: { type: 'Point', coordinates: [1, 2] } as Geometry }, rows: [{ id_geom: 'g2', nome: 'B', latitude: 2, longitude: 1 }] };
    const fc = toGeoJson(t, t.rows);
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0]!.geometry).toEqual({ type: 'Point', coordinates: [1, 2] });
    expect(fc.features[0]!.properties).toEqual({ nome: 'B' });
  });
  it('sem geometria guardada, usa o ponto da linha', () => {
    const t = { name: 't', columns: ['nome', 'latitude', 'longitude'], geo: { lat: 'latitude', lon: 'longitude' }, rows: [{ nome: 'A', latitude: -4, longitude: -40 }, { nome: 'sem', latitude: null, longitude: null }] };
    const fc = toGeoJson(t, t.rows);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0]!.geometry).toEqual({ type: 'Point', coordinates: [-40, -4] });
  });
});

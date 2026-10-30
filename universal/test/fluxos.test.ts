// Mapa de fluxos: pares de coordenadas (origem e destino) viram linhas (dados sintéticos; valores calculados à mão).
import { describe, expect, it } from 'vitest';
import { toGeoJson } from '../src/geo/export.js';
import { comFluxos, detectarPares, ID_FLUXO } from '../src/geo/pares.js';
import type { Row, Table } from '../src/types.js';

const colunas = ['origem', 'destino', 'lat_origem', 'lon_origem', 'lat_destino', 'lon_destino', 'peso'];
const tabela = (rows: Row[]): Table => ({ name: 'logistica', columns: colunas, rows });

describe('detectarPares', () => {
  it('acha lat_/lon_ com o mesmo sufixo, na ordem das colunas', () => {
    expect(detectarPares(colunas)).toEqual([
      { nome: 'origem', lat: 'lat_origem', lon: 'lon_origem' },
      { nome: 'destino', lat: 'lat_destino', lon: 'lon_destino' },
    ]);
  });
  it('acha também prefixo (origem_lat / origem_lng) e latitude/longitude por extenso', () => {
    expect(detectarPares(['a', 'origem_lat', 'origem_lng', 'x'])).toEqual([{ nome: 'origem', lat: 'origem_lat', lon: 'origem_lng' }]);
    expect(detectarPares(['latitude_saida', 'longitude_saida'])).toEqual([{ nome: 'saida', lat: 'latitude_saida', lon: 'longitude_saida' }]);
  });
  it('lat sem a lon correspondente não forma par; colunas comuns não são pares', () => {
    expect(detectarPares(['lat_origem', 'lon_destino', 'peso', 'plataforma'])).toEqual([]);
  });
});

describe('comFluxos', () => {
  const t = tabela([
    { origem: 'F', destino: 'S', lat_origem: -3.73, lon_origem: -38.52, lat_destino: -3.69, lon_destino: -40.35, peso: 10 },
    { origem: 'F', destino: 'F', lat_origem: -3.73, lon_origem: -38.52, lat_destino: -3.73, lon_destino: -38.52, peso: 5 },
    { origem: 'C', destino: 'S', lat_origem: null, lon_origem: -39.4, lat_destino: -3.69, lon_destino: -40.35, peso: 7 },
    { origem: 'X', destino: 'Y', lat_origem: 95, lon_origem: 0, lat_destino: 1, lon_destino: 1, peso: 1 },
  ]);
  it('desenha uma linha reta da origem ao destino, em [longitude, latitude]', () => {
    const f = comFluxos(t)!;
    const id = String(f.rows[0]![ID_FLUXO]);
    expect(f.shapes![id]).toEqual({ type: 'LineString', coordinates: [[-38.52, -3.73], [-40.35, -3.69]] });
    expect(f.geo).toEqual({ lat: 'lat_origem', lon: 'lon_origem', id: ID_FLUXO });
  });
  it('origem igual ao destino vira ponto', () => {
    const f = comFluxos(t)!;
    expect(f.shapes![String(f.rows[1]![ID_FLUXO])]).toEqual({ type: 'Point', coordinates: [-38.52, -3.73] });
  });
  it('registro com coordenada ausente ou fora do intervalo fica sem forma (não vira 0,0)', () => {
    const f = comFluxos(t)!;
    expect(f.rows[2]![ID_FLUXO]).toBeNull();
    expect(f.rows[3]![ID_FLUXO]).toBeNull();
    expect(Object.keys(f.shapes!)).toHaveLength(2);
  });
  it('a tabela original não é alterada e a exportação GeoJSON leva as linhas', () => {
    const antes = JSON.stringify(t);
    const f = comFluxos(t)!;
    expect(JSON.stringify(t)).toBe(antes);
    const fc = toGeoJson(f, f.rows);
    expect(fc.features).toHaveLength(2);
    expect(fc.features[0]!.geometry.type).toBe('LineString');
    expect(fc.features[0]!.properties).toMatchObject({ origem: 'F', destino: 'S', peso: 10 });
  });
  it('sem dois pares não há fluxo', () => {
    expect(comFluxos({ name: 'x', columns: ['lat_a', 'lon_a'], rows: [] })).toBeNull();
  });
});

import { toNumber } from '../profile.js';
import type { Row, Table } from '../types.js';
import type { Geometry } from './geometry.js';

export interface ParCoord {
  /** parte do nome que diferencia o par (origem, destino…) */
  nome: string;
  lat: string;
  lon: string;
}

const LAT = '(lat|latitude)';
const LON = '(lon|lng|long|longitude)';
const SEP = '[\\s_.-]';

/** Pares de colunas de coordenada com sufixo ou prefixo em comum (lat_origem + lon_origem, origem_lat + origem_lon), na ordem das colunas. */
export function detectarPares(columns: string[]): ParCoord[] {
  const out: ParCoord[] = [];
  for (const c of columns) {
    const m = new RegExp(`^${LAT}${SEP}(.+)$`, 'i').exec(c) ?? new RegExp(`^(.+)${SEP}${LAT}$`, 'i').exec(c);
    if (!m) continue;
    const prefixo = new RegExp(`^${LAT}${SEP}`, 'i').test(c);
    const resto = prefixo ? m[2]! : m[1]!;
    const lon = columns.find((x) => {
      const n = prefixo ? new RegExp(`^${LON}${SEP}(.+)$`, 'i').exec(x) : new RegExp(`^(.+)${SEP}${LON}$`, 'i').exec(x);
      return !!n && (prefixo ? n[2] : n[1])!.toLowerCase() === resto.toLowerCase();
    });
    if (lon) out.push({ nome: resto, lat: c, lon });
  }
  return out;
}

export const ID_FLUXO = 'id_fluxo';

/**
 * Tabela de fluxos para o mapa: uma linha reta do primeiro par de coordenadas (origem) ao segundo (destino) em cada registro.
 * A linha é reta no mapa (não é o trajeto real). Registro sem as quatro coordenadas válidas fica sem forma; origem igual ao destino vira ponto.
 */
export function comFluxos(t: Table): Table | null {
  const pares = detectarPares(t.columns);
  if (pares.length < 2) return null;
  const [o, d] = [pares[0]!, pares[1]!];
  const num = (r: Row, c: string, max: number) => {
    const v = toNumber(r[c] ?? null);
    return v != null && Math.abs(v) <= max ? v : null;
  };
  const shapes: Record<string, Geometry> = {};
  const rows = t.rows.map((r, i): Row => {
    const [a, b, c, e] = [num(r, o.lat, 90), num(r, o.lon, 180), num(r, d.lat, 90), num(r, d.lon, 180)];
    if (a == null || b == null || c == null || e == null) return { ...r, [ID_FLUXO]: null };
    const id = `f${i + 1}`;
    shapes[id] = a === c && b === e ? { type: 'Point', coordinates: [b, a] } : { type: 'LineString', coordinates: [[b, a], [e, c]] };
    return { ...r, [ID_FLUXO]: id };
  });
  return { ...t, columns: [...t.columns, ID_FLUXO], rows, geo: { lat: o.lat, lon: o.lon, id: ID_FLUXO }, shapes };
}

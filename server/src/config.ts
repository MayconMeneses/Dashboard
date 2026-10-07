import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const BUNDLED_BOUNDARY = resolve(import.meta.dirname, '../../boundary/croata-ibge.geojson');

export interface Config {
  port: number;
  host: string;
  dataDir: string;
  dbFile: string;
  uploadDir: string;
  maxUploadBytes: number;
  secureCookies: boolean;
  tileUrl: string | null;
  tileAttribution: string;
  sessionHours: number;
  webDist: string | null;
  boundaryFile: string | null;
  boundarySource: string;
  /** chave da API de mapas-base CARTO (opcional; nunca fica no código) */
  cartoKey: string | null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, overrides: Partial<Config> = {}): Config {
  const dataDir = resolve(env.DATA_DIR ?? './data');
  return {
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? '127.0.0.1',
    dataDir,
    dbFile: resolve(dataDir, 'dashboard.sqlite'),
    uploadDir: resolve(dataDir, 'uploads'),
    maxUploadBytes: Number(env.MAX_UPLOAD_MB ?? 25) * 1024 * 1024,
    secureCookies: env.COOKIE_SECURE === 'true',
    // Mapa-base: por padrão OpenStreetMap. Use TILE_URL="" para desativar (sem requisições a terceiros).
    tileUrl: env.TILE_URL === undefined ? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png' : env.TILE_URL || null,
    tileAttribution: env.TILE_ATTRIBUTION ?? '© colaboradores do OpenStreetMap',
    sessionHours: Number(env.SESSION_HOURS ?? 12),
    webDist: resolve(import.meta.dirname, '../../web/dist'),
    // Limite municipal oficial (GeoJSON) opcional, ex.: malha municipal do IBGE. Nunca é desenhado um limite "inventado".
    cartoKey: env.CARTO_API_KEY?.trim() || null,
    boundaryFile: env.BOUNDARY_FILE ? resolve(env.BOUNDARY_FILE) : existsSync(BUNDLED_BOUNDARY) ? BUNDLED_BOUNDARY : null,
    boundarySource:
      env.BOUNDARY_SOURCE ??
      (env.BOUNDARY_FILE
        ? 'Limite municipal fornecido pelo administrador'
        : 'IBGE – Mapa Municipal de Croatá-CE (2304236), Malha Territorial ed. 04/2021; contorno vetorizado do PDF (precisão aproximada)'),
    ...overrides,
  };
}

export interface Basemap {
  id: string;
  label: string;
  url: string;
  attribution: string;
  subdomains?: string;
}

const CARTO_ATTR = '© colaboradores do OpenStreetMap © CARTO';
const ESRI: Basemap = { id: 'esri', label: 'Satélite (Esri)', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attribution: 'Imagens © Esri, Maxar, Earthstar Geographics e comunidade GIS' };
const OSM: Basemap = { id: 'osm', label: 'OpenStreetMap padrão', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '© colaboradores do OpenStreetMap' };

/**
 * Mapas-base abertos. Os da CARTO exigem chave de API (sem ela aparece marca d'água), por isso só são
 * oferecidos quando uma chave foi configurada. O OpenStreetMap padrão bloqueia páginas abertas como arquivo (403).
 * "Sem mapa-base" não faz nenhuma requisição externa.
 */
export function getBasemaps(cartoKey?: string | null): Basemap[] {
  const carto = cartoKey
    ? [
        { id: 'voyager', label: 'Ruas e relevo (CARTO Voyager)', url: `https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png?key=${encodeURIComponent(cartoKey)}`, attribution: CARTO_ATTR },
        { id: 'positron', label: 'Claro (CARTO Positron)', url: `https://basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}.png?key=${encodeURIComponent(cartoKey)}`, attribution: CARTO_ATTR },
      ]
    : [];
  return [...carto, ESRI, OSM];
}

export function defaultBasemap(cartoKey?: string | null): string {
  if (cartoKey) return 'voyager';
  return typeof window !== 'undefined' && window.location.protocol === 'file:' ? 'esri' : 'osm';
}

export function storedBasemap(): string | null {
  try {
    return window.localStorage.getItem('basemap');
  } catch {
    return null;
  }
}

/** Usa a escolha salva só se ela existir na lista atual. */
export function initialBasemap(list: Basemap[], cartoKey?: string | null): string {
  const saved = storedBasemap();
  return saved && (saved === 'none' || list.some((b) => b.id === saved)) ? saved : defaultBasemap(cartoKey);
}

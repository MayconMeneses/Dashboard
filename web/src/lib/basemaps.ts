export interface Basemap {
  id: string;
  label: string;
  url: string;
  attribution: string;
  subdomains?: string;
}
/** Mapas-base abertos. Cada um só é carregado se escolhido; "Sem mapa-base" não faz nenhuma requisição a terceiros. */
export const BASEMAPS: Basemap[] = [
  { id: 'carto', label: 'Claro (OpenStreetMap/CARTO)', url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', attribution: '© colaboradores do OpenStreetMap © CARTO', subdomains: 'abcd' },
  { id: 'esri', label: 'Satélite (Esri)', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attribution: 'Imagens © Esri, Maxar, Earthstar Geographics e comunidade GIS' },
  { id: 'osm', label: 'OpenStreetMap padrão', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '© colaboradores do OpenStreetMap' },
];

export function storedBasemap(): string | null {
  try {
    return window.localStorage.getItem('basemap');
  } catch {
    return null;
  }
}

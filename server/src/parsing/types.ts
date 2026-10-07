export type FeatureType = 'localidade' | 'visita' | 'captura' | 'pit' | 'area' | 'rota' | 'outro';
export type SearchResult = 'com_captura' | 'sem_captura' | 'nao_informado';
export type ExamResult = 'positivo' | 'negativo' | 'pendente' | 'nao_realizado' | 'nao_informado';

export type Coord = [number, number]; // [lon, lat] como no KML/GeoJSON
export type Geometry =
  | { type: 'Point'; coordinates: Coord }
  | { type: 'LineString'; coordinates: Coord[] }
  | { type: 'Polygon'; coordinates: Coord[][] };

export type Severity = 'erro' | 'aviso' | 'info';
export interface Issue {
  severity: Severity;
  code: string;
  message: string;
  /** índice do placemark de origem, quando aplicável */
  placemark?: number;
}

/** Placemark lido do KML, ainda sem interpretação de domínio. */
export interface RawPlacemark {
  index: number;
  name: string;
  folderPath: string[];
  geometries: Geometry[];
  /** campos estruturados (ExtendedData Data/Value, SimpleData) */
  structured: Record<string, string>;
  /** campos extraídos da descrição HTML/CDATA que NÃO estão em `structured` */
  fromDescription: Record<string, string>;
  description: string;
  timestamp: string | null;
  sourceId: string | null;
}

export interface RawKml {
  placemarks: RawPlacemark[];
  folders: string[][];
  issues: Issue[];
}

export interface FieldMapping {
  /** nome do campo no arquivo (normalizado ou original) -> campo canônico */
  fields?: Record<string, CanonicalField>;
  /** caminho da pasta ("A / B") ou nome da pasta -> tipo */
  folders?: Record<string, FeatureType>;
}

export type CanonicalField =
  | 'localidade'
  | 'data_visita'
  | 'data_exame'
  | 'resultado_busca'
  | 'resultado_exame'
  | 'quantidade'
  | 'fase'
  | 'sexo'
  | 'especie'
  | 'endereco'
  | 'imovel'
  | 'pit'
  | 'id_origem'
  | 'ignorar';

export interface NormalizedFeature {
  /** posição do placemark no arquivo */
  index: number;
  sourceId: string | null;
  type: FeatureType;
  name: string;
  folderPath: string[];
  localityRaw: string | null;
  localityKey: string | null;
  geometry: Geometry | null;
  /** representação ponto para mapa/tabela (centróide para linhas/polígonos) */
  lat: number | null;
  lng: number | null;
  visitDate: string | null; // YYYY-MM-DD
  examDate: string | null;
  searchResult: SearchResult;
  examResult: ExamResult;
  triatomineCount: number | null;
  stage: string | null;
  sex: string | null;
  species: string | null;
  propertyRef: string | null;
  pitRef: string | null;
  /** dado de endereço: restrito */
  address: string | null;
  isBoundary: boolean;
  duplicateOf: number | null;
  /** valores originais + normalizados, sem dados pessoais */
  raw: { structured: Record<string, string>; description: Record<string, string>; originalValues: Record<string, string> };
  issues: Issue[];
}

export interface SeenFields {
  localidade: boolean;
  data_visita: boolean;
  data_exame: boolean;
  resultado_busca: boolean;
  resultado_exame: boolean;
  quantidade: boolean;
}

export interface ParseReport {
  folders: string[];
  counts: {
    placemarks: number;
    byType: Record<FeatureType, number>;
    points: number;
    lines: number;
    polygons: number;
    localities: number;
    captureRecords: number;
    pits: number;
    semGeometria: number;
  };
  seenFields: SeenFields;
  unmappedFields: string[];
  droppedPersonalFields: string[];
  folderTypes: Record<string, FeatureType>;
  localities: { key: string; name: string }[];
  similarLocalities: [string, string][];
  duplicates: { key: string; indexes: number[] }[];
  issues: Issue[];
}

export interface ParseResult {
  features: NormalizedFeature[];
  report: ParseReport;
}

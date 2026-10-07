export type Role = 'admin' | 'analista' | 'leitor';
export interface Me {
  username: string;
  role: Role;
  permissions: { importar: boolean; manual: boolean; exportar: boolean; restrito: boolean; auditoria: boolean };
  map: { tileUrl: string | null; attribution: string; maxUploadMb: number };
}
export interface Kpi {
  value: number | null;
  status: 'confirmado' | 'ausente';
  note: string;
  unit: string;
}
export interface Summary {
  versao: { id: number; numero: number | null; arquivo: string; ativadoEm: string | null } | null;
  kpis: Record<'localidades' | 'visitas' | 'comCaptura' | 'semCaptura' | 'examePositivo' | 'exameNegativo' | 'examePendente' | 'exameNaoInformado' | 'pits' | 'triatomineos', Kpi>;
}
export interface Chart {
  mode: 'busca' | 'exame';
  unit: string;
  note: string;
  localities: { key: string; name: string }[];
  series: { key: string; label: string; data: number[] }[];
}
export interface Locality {
  key: string;
  name: string;
  registros: number;
  capturas: number;
  visitas: number;
}
export interface Filters {
  from?: string;
  to?: string;
  locality?: string;
  layers: string[];
  search: string[];
  exam: string[];
  q?: string;
}
export interface RecordRow {
  rid: string;
  origin: 'arquivo' | 'manual';
  type: string;
  name: string | null;
  locality_raw: string | null;
  visit_date: string | null;
  exam_date: string | null;
  search_result: string;
  exam_result: string;
  triatomine_count: number | null;
  species: string | null;
  stage: string | null;
  sex: string | null;
  property_ref: string | null;
  pit_ref: string | null;
  lat: number | null;
  lng: number | null;
  duplicate_of: number | null;
  notes: string | null;
  address?: string | null;
}
export interface MapFeature {
  type: 'Feature';
  geometry: { type: 'Point' | 'LineString' | 'Polygon'; coordinates: unknown };
  properties: {
    rid: string;
    origin: string;
    type: string;
    name: string | null;
    locality_key: string | null;
    locality_raw: string | null;
    visit_date: string | null;
    search_result: string;
    exam_result: string;
    triatomine_count: number | null;
    species: string | null;
    is_boundary: boolean;
  };
}
export interface Issue {
  severity: 'erro' | 'aviso' | 'info';
  code: string;
  message: string;
  placemark?: number;
}
export interface Report {
  folders: string[];
  counts: {
    placemarks: number;
    byType: Record<string, number>;
    points: number;
    lines: number;
    polygons: number;
    localities: number;
    captureRecords: number;
    pits: number;
    semGeometria: number;
  };
  seenFields: Record<string, boolean>;
  unmappedFields: string[];
  droppedPersonalFields: string[];
  folderTypes: Record<string, string>;
  localities: { key: string; name: string }[];
  similarLocalities: [string, string][];
  duplicates: { key: string; indexes: number[] }[];
  issues: Issue[];
}
export interface ImportInfo {
  id: number;
  version: number | null;
  filename: string;
  sha256: string;
  sizeBytes: number;
  status: 'staged' | 'active' | 'archived' | 'failed' | 'discarded';
  createdAt: string;
  createdBy?: string;
  activatedAt: string | null;
  decisionNote: string | null;
  error: { code: string; message: string } | null;
  mapping: { fields?: Record<string, string>; folders?: Record<string, string> };
  report: Report | null;
}
export interface ManualVisit {
  id: number;
  locality: string;
  date: string;
  result: 'com_captura' | 'sem_captura';
  lat: number | null;
  lng: number | null;
  notes: string | null;
  createdAt: string;
  createdBy: string;
}

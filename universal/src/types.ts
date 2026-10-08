export type Cell = string | number | boolean | Date | null;
export type Row = Record<string, Cell>;

export interface Table {
  name: string;
  columns: string[];
  rows: Row[];
  /** colunas de latitude/longitude vindas do próprio formato (KML/GeoJSON) */
  geo?: { lat: string; lon: string };
  /** título do bloco (linha acima do cabeçalho) e texto de contexto da planilha (ex.: município, mês) */
  title?: string;
  context?: string;
}

export interface Dataset {
  fileName: string;
  tables: Table[];
}

export type ColType = 'number' | 'integer' | 'date' | 'category' | 'boolean' | 'text' | 'id' | 'lat' | 'lon';

export interface ColProfile {
  name: string;
  type: ColType;
  filled: number;
  missing: number;
  unique: number;
  min?: number;
  max?: number;
  mean?: number;
  median?: number;
  sum?: number;
  minDate?: number;
  maxDate?: number;
  top?: { value: string; count: number }[];
}

export type ChartKind = 'bar' | 'hbar' | 'donut' | 'line' | 'hist' | 'stacked' | 'map' | 'scatter' | 'multi';

export interface ChartSpec {
  id: string;
  kind: ChartKind;
  title: string;
  description: string;
  x?: string;
  y?: string;
  agg?: 'count' | 'sum' | 'mean';
  stack?: string;
  /** mantém a ordem original das linhas (ex.: ciclos), em vez de ordenar por valor */
  keepOrder?: boolean;
  /** colunas comparadas lado a lado (kind 'multi') */
  series?: string[];
  /** relevância (maior = aparece primeiro) */
  score: number;
}

export interface Kpi {
  label: string;
  value: string;
  hint?: string;
}

export interface Alert {
  level: 'info' | 'aviso';
  text: string;
}

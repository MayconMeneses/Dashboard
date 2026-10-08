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
  /** notas sobre como o arquivo foi lido (mostradas ao usuário) */
  notes?: string[];
  /** tabela só de texto (ex.: PDF sem tabelas): não gera gráficos */
  noCharts?: boolean;
  /** tabela "organizada" a partir de blocos repetidos (ex.: um bloco por mês) */
  tidy?: { period: string; entity: string; label: string; value: string; situation?: string; agravo?: string };
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

export type ChartStyle = 'line' | 'bar' | 'stacked' | 'hbar' | 'donut' | 'area' | 'percent' | 'heatmap' | 'radar' | 'small' | 'pareto';

export type ChartKind = 'bar' | 'hbar' | 'donut' | 'line' | 'hist' | 'stacked' | 'map' | 'scatter' | 'multi' | 'pivot' | 'funnel' | 'bubble';

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
  /** kind 'pivot': soma de y por x, uma série por valor de seriesBy; where filtra linhas; style define o desenho */
  seriesBy?: string;
  where?: Record<string, string[]>;
  style?: ChartStyle;
  /** por que o sistema escolheu este desenho (mostrado ao usuário) */
  why?: string;
  /** mantém o desenho definido em style (não é trocado pela recomendação automática) */
  lockStyle?: boolean;
  /** kind 'funnel': etapas em ordem; cada etapa soma as situações indicadas */
  stages?: { label: string; situations: string[] }[];
  /** kind 'bubble': situação do eixo x, medida do eixo y (taxa) e do tamanho */
  bubble?: { x: string[]; size: string[]; sizeLabel: string; xLabel: string };
  /** texto curto de como ler este gráfico */
  howTo?: string;
  /** linha de taxa (%) sobre as colunas: numerador/denominador são valores da coluna de situação */
  rate?: { options: { label: string; numerator: string[]; denominator: string[]; explain: string }[]; agravo?: string[] };
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

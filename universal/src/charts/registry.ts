import type { ColType, ChartSpec, Table } from '../types.js';
import type { SeriesData } from '../analytics/chartData.js';
import type { ChartHost } from './host.js';

/** Tudo o que um desenho recebe. `d` (dados já calculados) só existe para os desenhos por forma. */
export interface RenderContext {
  card: HTMLElement;
  spec: ChartSpec;
  t: Table;
  host: ChartHost;
  forced: Record<string, ColType>;
  basemap: 'esri' | 'none';
  onBasemap: (b: 'esri' | 'none') => void;
  rerender: () => void;
  d?: SeriesData;
}

/** Devolve o cartão pronto, ou null quando o desenho não se aplica a esta especificação (o painel segue o caminho padrão). */
export type Renderer = (c: RenderContext) => HTMLElement | null;

/** Registro de desenhos: por tipo de gráfico (`kind`) ou por forma (`shape`). Novos gráficos entram aqui, sem mexer no painel. */
export interface Registry {
  kind(kind: string, r: Renderer): Registry;
  shape(shape: string, r: Renderer): Registry;
  forKind(kind: string): Renderer | undefined;
  forShape(shape: string): Renderer | undefined;
  names(): { kinds: string[]; shapes: string[] };
}

export function createRegistry(): Registry {
  const kinds = new Map<string, Renderer>();
  const shapes = new Map<string, Renderer>();
  const reg: Registry = {
    kind(k, r) {
      if (kinds.has(k)) throw new Error(`desenho já registrado para o tipo “${k}”`);
      kinds.set(k, r);
      return reg;
    },
    shape(s, r) {
      if (shapes.has(s)) throw new Error(`desenho já registrado para a forma “${s}”`);
      shapes.set(s, r);
      return reg;
    },
    forKind: (k) => kinds.get(k),
    forShape: (s) => shapes.get(s),
    names: () => ({ kinds: [...kinds.keys()].sort(), shapes: [...shapes.keys()].sort() }),
  };
  return reg;
}

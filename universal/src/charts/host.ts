import type { Chart } from 'chart.js';
import type L from 'leaflet';

/** O que os desenhos de gráfico precisam da tela: guardar o que criaram (para destruir depois) e filtrar por clique. */
export interface ChartHost {
  addChart(c: Chart): void;
  addMap(m: L.Map): void;
  toggleFilter(col: string, value: string): void;
}

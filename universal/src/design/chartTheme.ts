import { Chart } from 'chart.js';
import type { ThemeMode } from './theme.js';

/** Cores de texto e grade dos gráficos (canvas não lê variáveis CSS). Valores iguais aos tokens de tokens.css. */
export const TEXT: Record<ThemeMode, { text: string; grid: string }> = {
  dark: { text: '#B7C8DD', grid: '#28405D' },
  light: { text: '#2C3E57', grid: '#C9D5E6' },
  contrast: { text: '#FFFFFF', grid: '#8A8A8A' },
};

let solid: string | null = null;

/** Fundo sólido só durante captura/impressão: o canvas é transparente e o papel/PDF é branco. */
const solidBackground = {
  id: 'solidBackground',
  beforeDraw(chart: Chart) {
    if (!solid) return;
    const { ctx, width, height } = chart;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = solid;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  },
};
Chart.register(solidBackground);

/** Vale para gráficos criados daqui em diante. */
export function setChartMode(mode: ThemeMode) {
  Chart.defaults.color = TEXT[mode].text;
  Chart.defaults.borderColor = TEXT[mode].grid;
}

interface Colored {
  color?: string;
}
interface ScaleColors {
  ticks?: Colored;
  grid?: Colored;
  title?: Colored;
  pointLabels?: Colored;
  angleLines?: Colored;
}

/**
 * O Chart.js não relê os padrões em gráficos já criados (as cores das escalas e da legenda foram resolvidas
 * na criação): é preciso gravar as cores nas opções de cada gráfico. As opções são proxies do Chart.js:
 * só se atribui propriedade por propriedade (nada de espalhar/clonar o objeto).
 */
function recolor(chart: Chart, mode: ThemeMode) {
  const { text, grid } = TEXT[mode];
  const scales = (chart.options.scales ?? {}) as Record<string, ScaleColors | undefined>;
  for (const key of Object.keys(scales)) {
    const sc = scales[key];
    if (!sc) continue;
    if (sc.ticks) sc.ticks.color = text;
    if (sc.grid) sc.grid.color = grid;
    if (sc.title) sc.title.color = text;
    if (sc.pointLabels) sc.pointLabels.color = text;
    if (sc.angleLines) sc.angleLines.color = grid;
  }
  const plugins = chart.options.plugins as { legend?: { labels?: Colored }; title?: Colored } | undefined;
  if (plugins?.legend?.labels) plugins.legend.labels.color = text;
  if (plugins?.title) plugins.title.color = text;
}

/** Imagem PNG de um gráfico sempre em tema claro com fundo branco, sem alterar o que está na tela. */
export function snapshotPng(charts: Chart[], cv: HTMLCanvasElement, current: ThemeMode, ratio?: number): string {
  const inst = charts.find((c) => c.canvas === cv);
  if (!inst) return cv.toDataURL('image/png');
  const prevRatio = inst.options.devicePixelRatio;
  setChartMode('light');
  solid = '#ffffff';
  try {
    if (ratio) inst.options.devicePixelRatio = ratio;
    recolor(inst, 'light');
    inst.resize();
    inst.update('none');
    return cv.toDataURL('image/png');
  } finally {
    solid = null;
    setChartMode(current);
    inst.options.devicePixelRatio = prevRatio;
    recolor(inst, current);
    inst.resize();
    inst.update('none');
  }
}

/** Liga/desliga o visual de impressão (tema claro e fundo branco) em todos os gráficos da tela. */
export function printCharts(charts: Chart[], on: boolean, current: ThemeMode) {
  solid = on ? '#ffffff' : null;
  setChartMode(on ? 'light' : current);
  for (const c of charts) {
    recolor(c, on ? 'light' : current);
    c.resize();
    c.update('none');
  }
}

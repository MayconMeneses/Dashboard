import {
  ArcElement, BarController, BarElement, CategoryScale, Chart as ChartJS, DoughnutController, Legend, LineController, LineElement, LinearScale, PointElement, Tooltip,
  type ChartConfiguration, type Plugin, type TooltipItem,
} from 'chart.js';
import { useEffect, useRef, type ReactNode } from 'react';
import { formatNumber } from '../lib/format';

ChartJS.register(ArcElement, BarController, BarElement, CategoryScale, DoughnutController, Legend, LineController, LineElement, LinearScale, PointElement, Tooltip);

const css = (name: string, fallback: string) => {
  try {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  } catch {
    return fallback;
  }
};
const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
export const dim = (hex: string, on: boolean) => (on && /^#[0-9a-f]{6}$/i.test(hex) ? hex + '55' : hex);

/** Escreve o total ao final de cada barra empilhada horizontal. */
const totalsPlugin: Plugin<'bar'> = {
  id: 'totalLabels',
  afterDatasetsDraw(chart, _args, opts: { enabled?: boolean; horizontal?: boolean; suffix?: string }) {
    if (!opts?.enabled) return;
    const { ctx, scales } = chart;
    const n = chart.data.labels?.length ?? 0;
    ctx.save();
    ctx.fillStyle = css('--text', '#14202b');
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < n; i++) {
      const total = chart.data.datasets.reduce((a, d, di) => a + (chart.isDatasetVisible(di) ? Number((d.data as number[])[i] ?? 0) : 0), 0);
      const metas = chart.data.datasets.map((_, di) => chart.getDatasetMeta(di).data[i]).filter(Boolean);
      const last = metas[metas.length - 1];
      if (!last) continue;
      if (opts.horizontal) {
        const x = scales.x!.getPixelForValue(total);
        ctx.textAlign = 'left';
        ctx.fillText(`${formatNumber(total)}${opts.suffix ?? ''}`, x + 6, last.y);
      } else {
        const y = scales.y!.getPixelForValue(total);
        ctx.textAlign = 'center';
        ctx.fillText(`${formatNumber(total)}`, last.x, y - 8);
      }
    }
    ctx.restore();
  },
};

/** Texto no centro de uma rosca. */
const centerPlugin: Plugin<'doughnut'> = {
  id: 'centerText',
  afterDraw(chart, _a, opts: { text?: string; sub?: string }) {
    if (!opts?.text) return;
    const { ctx, chartArea } = chart;
    const x = (chartArea.left + chartArea.right) / 2;
    const y = (chartArea.top + chartArea.bottom) / 2;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = css('--text', '#14202b');
    ctx.font = '700 22px system-ui, sans-serif';
    ctx.fillText(opts.text, x, y - 2);
    ctx.fillStyle = css('--muted', '#55636f');
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText(opts.sub ?? '', x, y + 16);
    ctx.restore();
  },
};

/** Antes de imprimir/gerar PDF, redesenha os gráficos para a largura da página. */
if (typeof window !== 'undefined') {
  const resizeAll = () => Object.values(ChartJS.instances).forEach((c) => c.resize());
  window.addEventListener('beforeprint', resizeAll);
  window.addEventListener('afterprint', resizeAll);
  (window as unknown as { __prepararImpressao?: () => void }).__prepararImpressao = resizeAll;
}

function useChart(build: () => ChartConfiguration | null, deps: unknown[]) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cfg = build();
    if (!ref.current || !cfg) return;
    const c = new ChartJS(ref.current, cfg);
    return () => c.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

export interface Series {
  label: string;
  data: number[];
  color: string;
}

interface BarProps {
  labels: string[];
  series: Series[];
  unit: string;
  horizontal?: boolean;
  stacked?: boolean;
  totals?: boolean;
  /** índices a atenuar (seleção ativa em outro item) */
  dimmed?: (i: number) => boolean;
  onPick?: (i: number) => void;
  thickness?: number;
  percent?: boolean;
  /** sufixo do valor escrito no fim da barra (ex.: "%") */
  suffix?: string;
  extraTooltip?: (i: number) => string | undefined;
  ariaLabel: string;
  /** altura por categoria (barras horizontais) */
  rowHeight?: number;
}

/** Barras finas (horizontais por padrão) ou colunas. */
export function BarChart({ labels, series, unit, horizontal = true, stacked = false, totals = false, dimmed, onPick, thickness = 12, percent = false, suffix = '', extraTooltip, ariaLabel, rowHeight = 24 }: BarProps) {
  const height = horizontal ? Math.max(120, labels.length * rowHeight + 70) : 300;
  const ref = useChart(
    () => ({
      type: 'bar',
      plugins: [totalsPlugin as Plugin],
      data: {
        labels,
        datasets: series.map((s) => ({
          label: s.label,
          data: s.data,
          backgroundColor: labels.map((_, i) => dim(s.color, !!dimmed?.(i))),
          borderRadius: 3,
          borderSkipped: false,
          ...(horizontal ? { barThickness: thickness } : { maxBarThickness: Math.max(thickness, 28) }),
        })),
      },
      options: {
        indexAxis: horizontal ? 'y' : 'x',
        responsive: true,
        maintainAspectRatio: false,
        animation: reduced() ? false : { duration: 350 },
        layout: { padding: { right: totals && horizontal ? 40 : 4, top: totals && !horizontal ? 22 : 0 } },
        scales: {
          x: {
            stacked,
            beginAtZero: true,
            grid: { color: css('--border', '#d9dee4') },
            ticks: { color: css('--muted', '#55636f'), precision: 0, font: { size: 11 }, ...(percent && horizontal ? { callback: (v: string | number) => `${v}%` } : {}), ...(horizontal ? {} : { maxRotation: 0, autoSkip: false }) },
            title: { display: horizontal, text: unit, color: css('--muted', '#55636f'), font: { size: 11 } },
            ...(percent && horizontal ? { max: 100 } : {}),
          },
          y: {
            stacked,
            beginAtZero: true,
            grace: horizontal ? 0 : '12%',
            grid: { display: !horizontal, color: css('--border', '#d9dee4') },
            ticks: { color: css('--text', '#14202b'), font: { size: 12 }, autoSkip: false, precision: 0 },
            title: { display: !horizontal, text: unit, color: css('--muted', '#55636f'), font: { size: 11 } },
            ...(percent && !horizontal ? { max: 100 } : {}),
          },
        },
        plugins: {
          legend: { display: series.length > 1, position: 'top', align: 'start', labels: { color: css('--text', '#14202b'), boxWidth: 12, boxHeight: 12, font: { size: 12 } } },
          tooltip: {
            callbacks: {
              title: (items: TooltipItem<'bar'>[]) => items[0]?.label ?? '',
              label: (c: TooltipItem<'bar'>) => `${c.dataset.label}: ${formatNumber(Number(c.raw))}${percent ? '%' : ''} ${percent ? '' : unit}`.trim(),
              footer: (items: TooltipItem<'bar'>[]) => {
                const i = items[0]?.dataIndex ?? 0;
                const lines: string[] = [];
                if (stacked && series.length > 1) {
                  const total = series.reduce((a, s) => a + (s.data[i] ?? 0), 0);
                  lines.push(`Total: ${formatNumber(total)}`);
                }
                const extra = extraTooltip?.(i);
                if (extra) lines.push(extra);
                return lines;
              },
            },
          },
          totalLabels: { enabled: totals, horizontal, suffix },
        },
        onClick: (_e, els) => {
          const el = els[0];
          if (el && onPick) onPick(el.index);
        },
        onHover: (e, els) => {
          const t = e.native?.target as HTMLElement | undefined;
          if (t) t.style.cursor = onPick && els.length ? 'pointer' : 'default';
        },
      },
    }),
    [labels, series, horizontal, stacked, totals, dimmed, onPick, thickness, percent, suffix, unit, extraTooltip, rowHeight],
  );
  return (
    <div style={{ height, position: 'relative' }}>
      <canvas ref={ref} role="img" aria-label={ariaLabel} />
    </div>
  );
}

interface DonutProps {
  labels: string[];
  values: number[];
  colors: string[];
  unit: string;
  centerText: string;
  centerSub: string;
  dimmed?: (i: number) => boolean;
  onPick?: (i: number) => void;
  ariaLabel: string;
}

export function DonutChart({ labels, values, colors, unit, centerText, centerSub, dimmed, onPick, ariaLabel }: DonutProps) {
  const total = values.reduce((a, b) => a + b, 0);
  const ref = useChart(
    () => ({
      type: 'doughnut',
      plugins: [centerPlugin as Plugin],
      data: { labels, datasets: [{ data: values, backgroundColor: colors.map((c, i) => dim(c, !!dimmed?.(i))), borderColor: css('--surface', '#fff'), borderWidth: 2, hoverOffset: 6 }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '62%',
        animation: reduced() ? false : { duration: 350 },
        plugins: {
          legend: { position: 'bottom', labels: { color: css('--text', '#14202b'), boxWidth: 12, boxHeight: 12, font: { size: 12 } } },
          tooltip: { callbacks: { label: (c) => `${c.label}: ${formatNumber(Number(c.raw))} ${unit} (${total ? Math.round((Number(c.raw) / total) * 100) : 0}%)` } },
          centerText: { text: centerText, sub: centerSub },
        },
        onClick: (_e, els) => {
          const el = els[0];
          if (el && onPick) onPick(el.index);
        },
        onHover: (e, els) => {
          const t = e.native?.target as HTMLElement | undefined;
          if (t) t.style.cursor = onPick && els.length ? 'pointer' : 'default';
        },
      },
    }),
    [labels, values, colors, centerText, centerSub, dimmed, onPick, unit, total],
  );
  return (
    <div style={{ height: 280, position: 'relative' }}>
      <canvas ref={ref} role="img" aria-label={ariaLabel} />
    </div>
  );
}

interface ComboProps {
  labels: string[];
  bars: Series[];
  line: { label: string; data: (number | null)[]; color: string };
  unit: string;
  unitRight: string;
  /** texto extra do balão (por categoria) */
  extraTooltip?: (i: number) => string | undefined;
  dimmed?: (i: number) => boolean;
  onPick?: (i: number) => void;
  ariaLabel: string;
}

/** Colunas agrupadas (eixo esquerdo) + linha em % (eixo direito). */
export function ComboChart({ labels, bars, line, unit, unitRight, extraTooltip, dimmed, onPick, ariaLabel }: ComboProps) {
  const ref = useChart(
    () => ({
      type: 'bar',
      data: {
        labels,
        datasets: [
          ...bars.map((s) => ({ type: 'bar' as const, label: s.label, data: s.data, backgroundColor: labels.map((_, i) => dim(s.color, !!dimmed?.(i))), borderRadius: 3, maxBarThickness: 26, yAxisID: 'y', order: 2 })),
          { type: 'line' as const, label: line.label, data: line.data, borderColor: line.color, backgroundColor: line.color, pointRadius: 5, pointHoverRadius: 7, borderWidth: 2.5, tension: 0, spanGaps: false, clip: false as unknown as number, yAxisID: 'y2', order: 1 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: reduced() ? false : { duration: 350 },
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { grid: { display: false }, ticks: { color: css('--text', '#14202b'), font: { size: 12 }, maxRotation: 0, autoSkip: false } },
          y: { beginAtZero: true, grace: '10%', grid: { color: css('--border', '#d9dee4') }, ticks: { color: css('--muted', '#55636f'), precision: 0, font: { size: 11 } }, title: { display: true, text: unit, color: css('--muted', '#55636f'), font: { size: 11 } } },
          y2: { position: 'right', beginAtZero: true, max: 100, grid: { drawOnChartArea: false }, ticks: { color: css('--muted', '#55636f'), font: { size: 11 }, callback: (v) => `${v}%` }, title: { display: true, text: unitRight, color: css('--muted', '#55636f'), font: { size: 11 } } },
        },
        plugins: {
          legend: { position: 'top', align: 'start', labels: { color: css('--text', '#14202b'), boxWidth: 12, boxHeight: 12, font: { size: 12 } } },
          tooltip: {
            callbacks: {
              label: (c) => (c.dataset.yAxisID === 'y2' ? `${c.dataset.label}: ${c.raw === null ? 'sem exames' : `${formatNumber(Number(c.raw))}%`}` : `${c.dataset.label}: ${formatNumber(Number(c.raw))}`),
              footer: (items) => {
                const x = extraTooltip?.(items[0]?.dataIndex ?? 0);
                return x ? [x] : [];
              },
            },
          },
        },
        onClick: (_e, els) => {
          const el = els[0];
          if (el && onPick) onPick(el.index);
        },
      },
    }),
    [labels, bars, line, unit, unitRight, extraTooltip, dimmed, onPick],
  );
  return (
    <div style={{ height: 320, position: 'relative' }}>
      <canvas ref={ref} role="img" aria-label={ariaLabel} />
    </div>
  );
}

export function downloadCanvasPng(host: HTMLElement | null, name: string) {
  const src = host?.querySelector('canvas');
  if (!src) return;
  const out = document.createElement('canvas');
  out.width = src.width;
  out.height = src.height;
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = css('--surface', '#ffffff');
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(src, 0, 0);
  const a = document.createElement('a');
  a.href = out.toDataURL('image/png');
  a.download = `${name}.png`;
  a.click();
}

export function downloadCsv(head: string[], rows: (string | number | null)[][], name: string) {
  const cell = (v: string | number | null) => {
    let s = v === null ? '' : String(v);
    if (/^[=+\-@]/.test(s)) s = `'${s}`;
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const text = '﻿' + [head, ...rows].map((r) => r.map(cell).join(';')).join('\r\n') + '\r\n';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  a.download = `${name}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export type { ReactNode };

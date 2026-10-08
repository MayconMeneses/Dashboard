import { toNumber } from './profile.js';
import type { ChartSpec, ChartStyle, Table } from './types.js';
import type { SeriesData } from './suggest.js';

const sumOk = (a: number[]) => a.filter((v) => !Number.isNaN(v)).reduce((x, y) => x + y, 0);

/** Matriz série × rótulo para mapa de calor; NaN = sem dado. */
export function toHeatmap(d: SeriesData) {
  const rows = d.datasets ?? [{ label: 'Valor', values: d.values }];
  const flat = rows.flatMap((r) => r.values).filter((v) => !Number.isNaN(v));
  return { rows: rows.map((r) => r.label), cols: d.labels, cells: rows.map((r) => r.values), min: flat.length ? Math.min(...flat) : 0, max: flat.length ? Math.max(...flat) : 0 };
}

/** Converte cada coluna em proporção (%) do total do rótulo (barras 100% empilhadas). */
export function toPercent(d: SeriesData): SeriesData {
  if (!d.datasets) return d;
  const tot = d.labels.map((_, i) => sumOk(d.datasets!.map((s) => s.values[i]!)));
  return { ...d, datasets: d.datasets.map((s) => ({ label: s.label, values: s.values.map((v, i) => (Number.isNaN(v) || !tot[i] ? Number.NaN : (v / tot[i]!) * 100)) })) };
}

/** Pareto: valores em ordem decrescente e % acumulado do total. */
export function toPareto(d: SeriesData) {
  const vals = d.datasets ? d.labels.map((_, i) => sumOk(d.datasets!.map((s) => s.values[i]!))) : d.values;
  const items = d.labels.map((l, i) => [l, vals[i]!] as const).filter(([, v]) => !Number.isNaN(v)).sort((a, b) => b[1] - a[1]);
  const total = items.reduce((a, [, v]) => a + v, 0) || 1;
  let acc = 0;
  return { labels: items.map(([l]) => l), values: items.map(([, v]) => v), cumulative: items.map(([, v]) => ((acc += v) / total) * 100) };
}

/** Funil: etapas em ordem com o % em relação à etapa anterior. */
export function funnelData(t: Table, spec: ChartSpec) {
  const td = t.tidy;
  if (!td?.situation || !spec.stages) return null;
  const agr = spec.where?.[td.agravo ?? ''] ?? null;
  const rows = t.rows.filter((r) => !td.agravo || !agr || (r[td.agravo] == null ? agr.includes('∅') : agr.includes(String(r[td.agravo]))));
  const vals = spec.stages.map((s) => rows.reduce((a, r) => (s.situations.includes(String(r[td.situation!])) ? a + (toNumber(r['Valor'] ?? null) ?? 0) : a), 0));
  return { labels: spec.stages.map((s, i) => `${s.label}: ${new Intl.NumberFormat('pt-BR').format(vals[i]!)}${i ? ` (${vals[i - 1] ? ((vals[i]! / vals[i - 1]!) * 100).toFixed(1).replace('.', ',') : '—'}% da etapa anterior)` : ''}`), values: vals };
}

/** Bolhas por entidade: x = volume, y = positividade (%), tamanho = outra medida. */
export function bubbleData(t: Table, spec: ChartSpec) {
  const td = t.tidy;
  const opt = spec.rate?.options[0];
  if (!td?.situation || !opt || !spec.bubble) return [];
  const agr = spec.rate?.agravo;
  const rows = t.rows.filter((r) => !td.agravo || !agr || (r[td.agravo] == null ? agr.includes('∅') : agr.includes(String(r[td.agravo]))));
  const ents = [...new Set(rows.map((r) => String(r[td.entity])))];
  const sum = (e: string, names: string[]) => rows.reduce((a, r) => (String(r[td.entity]) === e && names.includes(String(r[td.situation!])) ? a + (toNumber(r['Valor'] ?? null) ?? 0) : a), 0);
  return ents
    .map((e) => {
      const den = sum(e, opt.denominator);
      return { entity: e, x: sum(e, spec.bubble!.x), y: den > 0 ? (sum(e, opt.numerator) / den) * 100 : Number.NaN, size: sum(e, spec.bubble!.size) };
    })
    .filter((b) => !Number.isNaN(b.y) && b.x > 0);
}

export interface StyleOption {
  style: ChartStyle;
  label: string;
  why: string;
  recommended?: boolean;
}

/**
 * Regras de escolha do desenho. Recebe o formato dos dados (eixo ordenado? quantas séries/rótulos?)
 * e devolve os desenhos compatíveis, com o recomendado primeiro e o motivo de cada um.
 */
export function compatibleStyles(opts: { ordered: boolean; series: number; labels: number; positive: boolean }): StyleOption[] {
  const { ordered, series, labels, positive } = opts;
  const o: StyleOption[] = [];
  const add = (style: ChartStyle, label: string, why: string, recommended = false) => o.push({ style, label, why, recommended });
  if (ordered) {
    if (series === 0) {
      if (labels >= 4) add('line', 'Linha', 'O eixo é uma sequência (tempo) e há vários pontos: a linha mostra a tendência.', true);
      add('bar', 'Colunas', 'Compara o valor de cada período isoladamente.', labels < 4);
      if (labels >= 4) add('area', 'Área', 'Linha com o volume preenchido; destaca a magnitude acumulada ao longo do tempo.');
    } else if (series <= 5) {
      add('line', 'Linhas', `O eixo é uma sequência (tempo) com ${series} séries: linhas deixam comparar a forma de cada uma.`, true);
      add('stacked', 'Colunas empilhadas', 'Mostra o total do período e quanto cada série contribui.');
      if (positive) add('area', 'Áreas empilhadas', 'Como as colunas empilhadas, mas ligando os períodos.');
      if (positive) add('percent', '100% empilhado', 'Mostra a proporção de cada série em cada período, sem o efeito do volume total.');
      add('heatmap', 'Mapa de calor', 'Cores no lugar de alturas; útil para ver períodos mais “quentes”.');
    } else {
      add('small', 'Gráficos pequenos (um por série)', `Com ${series} séries, linhas no mesmo gráfico se embaralham; um gráfico pequeno por série facilita comparar a forma.`, true);
      add('heatmap', 'Mapa de calor', 'Compacto: série × período, com cor proporcional ao valor.');
      add('line', 'Linhas juntas', 'Todas as séries no mesmo eixo (pode ficar poluído).');
    }
  } else if (series === 0) {
    if (labels > 15) add('pareto', 'Pareto', `Muitos itens (${labels}): mostra os maiores e quanto eles somam do total (acumulado).`, true);
    const donutRec = labels >= 2 && labels <= 4 && positive;
    add('hbar', 'Barras horizontais', 'Ranking de categorias: rótulos longos ficam legíveis e a ordem do maior ao menor é imediata.', labels <= 15 && !donutRec);
    add('bar', 'Colunas', 'Compara categorias lado a lado.');
    if (labels <= 15 && labels >= 4) add('pareto', 'Pareto', 'Ranking com o percentual acumulado: mostra se poucos itens concentram o total.');
    if (labels >= 2 && labels <= 6 && positive) add('donut', 'Rosca', 'Poucas partes de um todo: mostra a proporção de cada uma.', donutRec);
  } else {
    add('stacked', 'Colunas empilhadas', 'Cada coluna é um total dividido em partes (séries); mostra volume e composição.', true);
    if (positive) add('percent', '100% empilhado', 'Compara a proporção de cada parte entre os itens, independente do tamanho de cada um.');
    add('heatmap', 'Mapa de calor', 'Cruza item × série com cores; bom quando há muitas combinações.');
    if (labels >= 3 && labels <= 8 && series <= 6 && positive) add('radar', 'Radar', 'Compara o perfil dos itens em várias dimensões ao mesmo tempo.');
    add('bar', 'Colunas agrupadas', 'Colunas lado a lado em vez de empilhadas.');
  }
  return o.sort((a, b) => Number(!!b.recommended) - Number(!!a.recommended));
}

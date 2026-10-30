import type { ChartSpec } from '../types.js';
import type { Agg } from './chartData.js';
import { aggFor, explainColumns } from './semantic.js';
import type { Semantic } from './semantic.js';

/** Escolha feita à mão na exploração: agrupar por `x`, calcular `agg` sobre `y` (sem `y` só se conta). */
export interface ExploreChoice {
  x: string;
  y: string;
  agg: Agg;
}

export const AGG_NAMES: Record<Agg, string> = { count: 'Contagem', sum: 'Soma', mean: 'Média', median: 'Mediana', min: 'Mínimo', max: 'Máximo' };

const GROUPABLE = new Set(['dimension', 'flag', 'time']);

/** Escolha inicial: a primeira dimensão com a primeira medida, no cálculo que faz sentido para ela. */
export function defaultChoice(sem: Semantic[]): ExploreChoice | null {
  const x = sem.find((s) => s.role === 'dimension') ?? sem.find((s) => GROUPABLE.has(s.role));
  if (!x) return null;
  const y = sem.find((s) => s.role === 'measure');
  return y ? { x: x.name, y: y.name, agg: aggFor(y) === 'mean' ? 'mean' : 'sum' } : { x: x.name, y: '', agg: 'count' };
}

export type ExploreResult = { spec: ChartSpec; problem?: undefined } | { spec?: undefined; problem: string };

/** Valida a escolha pelas regras de papel das colunas e monta o gráfico. Combinação sem significado volta como `problem`, não como gráfico. */
export function exploreSpec(c: ExploreChoice, sem: Semantic[]): ExploreResult {
  const by = new Map(sem.map((s) => [s.name, s]));
  const x = by.get(c.x);
  if (!x) return { problem: 'Escolha a coluna para agrupar.' };
  if (!GROUPABLE.has(x.role)) return { problem: `“${c.x}” é ${x.role === 'identifier' ? 'um identificador' : x.role === 'measure' ? 'uma medida' : 'texto livre'} e não serve para agrupar. Troque o tipo da coluna na tabela de colunas se isso estiver errado.` };
  let spec: ChartSpec;
  if (c.agg === 'count') {
    spec = { id: `explore-${c.x}--count`, kind: x.role === 'time' && !x.period ? 'line' : 'pivot', style: 'hbar', ...(x.period ? { keepOrder: true, period: true } : {}), x: c.x, agg: 'count', title: `Registros por ${c.x}`, description: `Contagem de registros para cada valor de “${c.x}” (exploração manual).`, score: 0 };
  } else {
    const y = by.get(c.y);
    if (!y) return { problem: 'Escolha a medida a calcular.' };
    if (y.role !== 'measure') return { problem: `“${c.y}” não é uma medida (${y.role === 'identifier' ? 'é um código' : y.role}); só contagem faz sentido com ela.` };
    if (c.agg === 'sum' && !y.additive) return { problem: `“${c.y}” é percentual ou taxa: somar não tem significado. Use média, mediana, mínimo ou máximo.` };
    const nome = AGG_NAMES[c.agg];
    spec = { id: `explore-${c.x}-${c.y}-${c.agg}`, kind: x.role === 'time' && !x.period ? 'line' : 'pivot', style: 'hbar', ...(x.period ? { keepOrder: true, period: true } : {}), x: c.x, y: c.y, agg: c.agg, title: `${nome} de ${c.y} por ${c.x}`, description: `${nome} de “${c.y}” para cada valor de “${c.x}”; linhas sem valor em “${c.y}” ficam de fora (não viram zero). Exploração manual.`, score: 0 };
  }
  return { spec: { ...spec, reasons: explainColumns([c.x, c.y || undefined], sem) } };
}

import { clickFilters } from '../analytics/recommend.js';
import type { ChartSpec } from '../types.js';

export interface FiltroCtx {
  /** início do período já filtrado, se houver (clicar de novo no mesmo mês limpa o período) */
  periodoDe: string | undefined;
  aplicarPeriodo(r: { col?: string; from?: string; to?: string }): void;
  alternarFiltro(col: string, valor: string): void;
}

/**
 * Filtro pelo rótulo de um gráfico: o mesmo caminho para o clique na barra/fatia e para o botão da tabela de dados (teclado e leitor de tela).
 * Em gráfico de linha por mês o rótulo vira período daquele mês; nos demais, filtro de igualdade na coluna do eixo.
 */
export function filtrarPorRotulo(spec: ChartSpec, rotulo: string, ctx: FiltroCtx): void {
  if (!spec.x || !clickFilters(spec)) return;
  const mm = spec.kind === 'line' ? /^(\d{4})-(\d{2})$/.exec(rotulo) : null;
  if (mm) {
    const ultimo = new Date(Date.UTC(Number(mm[1]), Number(mm[2]), 0)).getUTCDate();
    const de = `${mm[1]}-${mm[2]}-01`;
    ctx.aplicarPeriodo(ctx.periodoDe === de ? {} : { col: spec.x, from: de, to: `${mm[1]}-${mm[2]}-${String(ultimo).padStart(2, '0')}` });
    return;
  }
  ctx.alternarFiltro(spec.x, rotulo);
}

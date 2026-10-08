import type { ColType } from './types.js';

export interface StateForReport {
  filters: Record<string, string>;
  dateRange: { col?: string; from?: string; to?: string };
  merges: Record<string, Record<string, string>>;
  forced: Record<string, ColType>;
  removed: string[];
  locale: { dateOrder: 'dmy' | 'mdy'; numbers: 'br' | 'us' };
}

const TYPE_PT: Record<string, string> = { number: 'número', integer: 'inteiro', date: 'data', category: 'categoria', boolean: 'sim/não', text: 'texto', id: 'identificador', lat: 'latitude', lon: 'longitude' };

export function formatBytes(n: number): string {
  if (n >= 1048576) return `${(n / 1048576).toFixed(1).replace('.', ',')} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

/** Descreve em frases, para o relatório, tudo o que o usuário filtrou, corrigiu ou escolheu. */
export function describeState(s: StateForReport): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(s.filters)) out.push(`Filtro por clique: ${k} = ${v}`);
  if (s.dateRange.col && (s.dateRange.from || s.dateRange.to)) {
    const f = (d?: string) => (d ? d.split('-').reverse().join('/') : '…');
    out.push(`Período em “${s.dateRange.col}”: de ${f(s.dateRange.from)} até ${f(s.dateRange.to)} (linhas sem data ficam fora)`);
  }
  for (const [col, map] of Object.entries(s.merges)) out.push(`Grafias unificadas em “${col}”: ${Object.entries(map).map(([a, b]) => `“${a}” → “${b}”`).join(', ')}`);
  for (const [col, t] of Object.entries(s.forced)) out.push(`Tipo da coluna “${col}” definido manualmente: ${TYPE_PT[t] ?? t}`);
  if (s.removed.length) out.push(`${s.removed.length} gráfico(s) removido(s) do painel pelo usuário`);
  out.push(`Interpretação regional: datas com barra como ${s.locale.dateOrder === 'dmy' ? 'dia/mês/ano' : 'mês/dia/ano'}; números com ${s.locale.numbers === 'br' ? 'ponto de milhar e vírgula decimal (padrão brasileiro)' : 'vírgula de milhar e ponto decimal (padrão americano)'}`);
  return out;
}

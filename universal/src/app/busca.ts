import type { Cell, Row } from '../types.js';

/** Texto sem acento e em minúsculas, para a busca não depender de “Ceará” × “ceara”. */
export const normalizar = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const texto = (v: Cell | undefined): string => {
  if (v == null) return '';
  if (v instanceof Date) {
    const iso = v.toISOString().slice(0, 10);
    const [a, m, d] = iso.split('-');
    return `${iso} ${d}/${m}/${a}`;
  }
  return String(v);
};

/**
 * Linhas em que TODAS as palavras do termo aparecem em alguma coluna (sem distinguir caixa nem acento). Termo vazio devolve as mesmas linhas.
 * Vale para o painel inteiro (indicadores, gráficos, tabela e relatório), como qualquer outro filtro.
 */
export function filtrarPorTexto(rows: Row[], columns: string[], termo: string): Row[] {
  const palavras = normalizar(termo).split(/\s+/).filter(Boolean);
  if (!palavras.length) return rows;
  return rows.filter((r) => {
    const linha = normalizar(columns.map((c) => texto(r[c])).join(' '));
    return palavras.every((p) => linha.includes(p));
  });
}

export type PeriodoRapido = 'tudo' | '30d' | '90d' | '12m' | 'ano' | 'anoAnt';

export const PERIODOS: [PeriodoRapido, string][] = [
  ['tudo', 'Todo o período'],
  ['30d', 'Últimos 30 dias'],
  ['90d', 'Últimos 90 dias'],
  ['12m', 'Últimos 12 meses'],
  ['ano', 'Este ano'],
  ['anoAnt', 'Ano anterior'],
];

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const DIA = 86_400_000;

/** Intervalo (aaaa-mm-dd) de um período rápido, contado a partir da data mais recente que existe nos dados (não de hoje: o arquivo pode ser antigo). */
export function periodoRapido(tipo: PeriodoRapido, max: number): { from?: string; to?: string } {
  const fim = new Date(max);
  const ano = fim.getUTCFullYear();
  switch (tipo) {
    case 'tudo':
      return {};
    case '30d':
      return { from: iso(max - 29 * DIA), to: iso(max) };
    case '90d':
      return { from: iso(max - 89 * DIA), to: iso(max) };
    case '12m':
      return { from: iso(Date.UTC(ano - 1, fim.getUTCMonth(), fim.getUTCDate() + 1)), to: iso(max) };
    case 'ano':
      return { from: `${ano}-01-01`, to: iso(max) };
    case 'anoAnt':
      return { from: `${ano - 1}-01-01`, to: `${ano - 1}-12-31` };
  }
}

/** Qual período rápido corresponde ao intervalo atual (para mostrar no seletor); 'custom' se nenhum. */
export function periodoAtual(r: { from?: string; to?: string }, max: number): PeriodoRapido | 'custom' {
  if (!r.from && !r.to) return 'tudo';
  for (const [k] of PERIODOS) {
    if (k === 'tudo') continue;
    const p = periodoRapido(k, max);
    if (p.from === r.from && p.to === r.to) return k;
  }
  return 'custom';
}

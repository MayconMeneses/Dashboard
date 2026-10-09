import type { Row, Table } from './types.js';
import { sentenceCase } from './util.js';

const YEAR = /\b(?:19|20)\d{2}\b/g;
const KEY_NAME = /^(ano|anos|year|exerc[ií]cio)$/i;

/**
 * Quadros de relatório costumam listar um ano por linha sem ter a coluna “Ano”; o título diz “… em 2024, 2025 e 2026”.
 * Quando a quantidade de anos do título é igual à de linhas, acrescenta a coluna “Ano” (e avisa).
 */
export function inferYearColumn(t: Table): Table {
  if (t.columns.some((c) => KEY_NAME.test(c.trim()))) return t;
  const years = (t.title ?? '').match(YEAR) ?? [];
  if (years.length < 2 || years.length !== t.rows.length || new Set(years).size !== years.length) return t;
  const rows: Row[] = t.rows.map((r, i) => ({ Ano: years[i]!, ...r }));
  return { ...t, columns: ['Ano', ...t.columns], rows, notes: [...(t.notes ?? []), `Coluna “Ano” criada a partir do título (“${t.title}”): as linhas estão na ordem ${years.join(', ')}. Confira se a ordem do documento é essa.`] };
}

const keyOf = (t: Table) => t.columns.find((c) => KEY_NAME.test(c.trim()));

/**
 * Junta, por Ano, os quadros que têm exatamente os mesmos anos (cada um com uma linha por ano), num único quadro geral,
 * para cruzar indicadores de quadros diferentes. Colunas com o mesmo nome em quadros diferentes ganham o nome do grupo.
 */
export function joinByYear(tables: Table[], baseName: string): Table | undefined {
  const cands = tables.filter((t) => !t.noCharts && !t.tidy && keyOf(t) && t.rows.length >= 2);
  const sig = (t: Table) => {
    const k = keyOf(t)!;
    const vals = t.rows.map((r) => String(r[k] ?? '').trim());
    return new Set(vals).size === vals.length && vals.every(Boolean) ? [...vals].sort().join('|') : '';
  };
  const bySig = new Map<string, Table[]>();
  for (const t of cands) {
    const s = sig(t);
    if (s) bySig.set(s, [...(bySig.get(s) ?? []), t]);
  }
  const group = [...bySig.values()].sort((a, b) => b.length - a.length)[0];
  if (!group || group.length < 2) return undefined;
  const key = keyOf(group[0]!)!;
  const years = group[0]!.rows.map((r) => String(r[key] ?? '').trim());
  const label = (t: Table) => sentenceCase(t.group ?? t.title ?? t.name);

  const tail = (c: string) => (c.includes(' — ') ? c.split(' — ').pop()! : c).trim().toLowerCase();
  const count = new Map<string, number>();
  for (const t of group) for (const c of t.columns) if (c !== keyOf(t)) count.set(tail(c), (count.get(tail(c)) ?? 0) + 1);
  const columns: string[] = [key];
  const rows: Row[] = years.map((y) => ({ [key]: y }));
  const seenConst = new Set<string>();
  for (const t of group) {
    const k = keyOf(t)!;
    const byYear = new Map(t.rows.map((r) => [String(r[k] ?? '').trim(), r]));
    for (const c of t.columns) {
      if (c === k) continue;
      let name = c;
      if ((count.get(tail(c)) ?? 0) > 1 && !c.includes(' — ')) name = `${label(t)} — ${c}`;
      // coluna de rótulo repetido (ex.: o município) só entra uma vez
      const vals = t.rows.map((r) => r[c]);
      if (vals.every((v) => v === vals[0]) && vals[0] != null && typeof vals[0] === 'string' && Number.isNaN(Number(vals[0].replace(',', '.')))) {
        if (seenConst.has(c)) continue;
        seenConst.add(c);
      }
      let n = name;
      for (let i = 2; columns.includes(n); i++) n = `${name} (${i})`;
      columns.push(n);
      rows.forEach((row, i) => (row[n] = byYear.get(years[i]!)?.[c] ?? null));
    }
  }
  return {
    name: `${baseName} · quadro geral por ${key}`,
    title: `Quadro geral por ${key}: ${group.length} quadros do documento juntos`,
    columns,
    rows,
    notes: [`Juntei por “${key}” os ${group.length} quadros do documento que têm os mesmos períodos (${years.join(', ')}), para cruzar indicadores. Colunas com o mesmo nome em quadros diferentes receberam o nome do grupo.`],
    stats: { dropped: 0, truncated: 0 },
  };
}

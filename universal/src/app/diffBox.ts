import { el } from './dom.js';
import type { TableDiff } from '../project.js';

export function diffBox(d: TableDiff): HTMLElement {
  const n = (x: number) => new Intl.NumberFormat('pt-BR').format(x);
  const items: string[] = [`Linhas: ${n(d.rows.before)} → ${n(d.rows.after)} (${d.rows.after >= d.rows.before ? '+' : ''}${n(d.rows.after - d.rows.before)})`];
  if (d.columnsAdded.length) items.push(`Colunas novas: ${d.columnsAdded.join(', ')}`);
  if (d.columnsRemoved.length) items.push(`Colunas que sumiram: ${d.columnsRemoved.join(', ')}`);
  for (const s of d.sums) items.push(`Soma de “${s.col}”: ${n(s.before)} → ${n(s.after)}${s.before ? ` (${s.after >= s.before ? '+' : ''}${(((s.after - s.before) / Math.abs(s.before)) * 100).toFixed(1).replace('.', ',')}%)` : ''}`);
  for (const v of d.newValues) items.push(`Valores novos em “${v.col}”: ${v.values.join(', ')}`);
  for (const v of d.goneValues) items.push(`Valores que sumiram de “${v.col}”: ${v.values.join(', ')}`);
  return el('ul', {}, ...items.map((x) => el('li', {}, x)));
}

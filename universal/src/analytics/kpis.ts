import { toNumber } from '../profile.js';
import type { ColProfile, Kpi, Table } from '../types.js';
import { fmtNum } from './format.js';
import { semanticProfile } from './semantic.js';
import { tidyKpis } from './tidy.js';

export function kpis(t: Table, prof: ColProfile[]): Kpi[] {
  if (t.tidy) return tidyKpis(t);
  const per = prof.find((p) => p.period && p.filled === t.rows.length && p.unique === t.rows.length);
  if (per && t.rows.length >= 2 && t.rows.length <= 40) return periodKpis(t, prof, per);
  const out: Kpi[] = [{ label: 'Registros', value: fmtNum(t.rows.length) }, { label: 'Colunas', value: String(t.columns.length) }];
  // só medida de verdade: código (CEP, CPF…) não tem total, e percentual/taxa pede média, não soma
  const sem = semanticProfile(t, prof);
  const m = prof.find((p) => (p.type === 'number' || p.type === 'integer') && sem.find((s) => s.name === p.name)?.role === 'measure');
  const additive = m ? sem.find((s) => s.name === m.name)!.additive : true;
  if (m?.sum != null && additive) out.push({ label: `Total de ${m.name}`, value: fmtNum(m.sum), hint: `média ${fmtNum(m.mean!)} · mediana ${fmtNum(m.median!)}` });
  else if (m?.mean != null) out.push({ label: `Média de ${m.name}`, value: fmtNum(m.mean), hint: `mediana ${fmtNum(m.median!)} · mínimo ${fmtNum(m.min!)} · máximo ${fmtNum(m.max!)}` });
  const d = prof.find((p) => p.type === 'date');
  if (d?.minDate != null) out.push({ label: `Período (${d.name})`, value: `${new Date(d.minDate).toLocaleDateString('pt-BR', { timeZone: 'UTC' })} a ${new Date(d.maxDate!).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}` });
  const filled = prof.reduce((a, p) => a + p.filled, 0) / Math.max(1, t.rows.length * t.columns.length);
  out.push({ label: 'Preenchimento', value: `${(filled * 100).toFixed(0)}%`, hint: 'células com valor; vazio nunca é tratado como zero' });
  return out;
}

/** Indicadores de um quadro por período: primeiro e último período dos indicadores que mais mudaram. */
export function periodKpis(t: Table, prof: ColProfile[], per: ColProfile): Kpi[] {
  const first = t.rows[0]!;
  const last = t.rows[t.rows.length - 1]!;
  const a = String(first[per.name]);
  const z = String(last[per.name]);
  const out: Kpi[] = [{ label: 'Períodos', value: fmtNum(t.rows.length), hint: `${a} a ${z}` }];
  const cand = prof
    .filter((c) => (c.type === 'number' || c.type === 'integer') && c.unique > 1)
    .map((c) => ({ c, f: toNumber(first[c.name] ?? null), l: toNumber(last[c.name] ?? null) }))
    .filter((x): x is { c: ColProfile; f: number; l: number } => x.f != null && x.l != null && x.f !== 0)
    .map((x) => ({ ...x, pct: ((x.l - x.f) / Math.abs(x.f)) * 100 }))
    .sort((p, q) => Math.abs(q.pct) - Math.abs(p.pct))
    .slice(0, 4);
  for (const x of cand) out.push({ label: `${x.c.name} (${z})`, value: `${fmtNum(x.l)}${x.c.percent ? '%' : ''}`, hint: `${fmtNum(x.f)}${x.c.percent ? '%' : ''} em ${a} → ${fmtNum(x.l)}${x.c.percent ? '%' : ''} em ${z}: ${x.pct >= 0 ? '+' : ''}${fmtNum(x.pct)}%` });
  return out;
}

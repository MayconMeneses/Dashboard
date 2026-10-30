import { toNumber } from '../profile.js';
import type { LocaleInfo } from '../profile.js';
import { similarGroups } from '../similar.js';
import type { Alert, ColProfile, Table } from '../types.js';
import { tidyAlerts } from './tidy.js';

/** Alertas de qualidade dos dados (ausentes, colunas constantes, duplicadas, valores extremos). */
export function qualityAlerts(t: Table, prof: ColProfile[], loc?: LocaleInfo): Alert[] {
  if (t.tidy) return tidyAlerts(t);
  const out: Alert[] = [];
  for (const p of prof) {
    if (p.invalidCount) out.push({ level: 'aviso', text: `“${p.name}” é numérica, mas ${p.invalidCount} valor(es) não são número e ficam fora das contas: ${p.invalid!.slice(0, 5).map((b) => `linha ${b.row}: “${b.value}”`).join('; ')}${p.invalidCount > 5 ? '…' : ''}.` });
    if (p.missingMarkers) out.push({ level: 'info', text: `“${p.name}” tem ${p.missingMarkers} marcador(es) de ausência (como n/d ou -); foram tratados como sem dado, não como zero.` });
  }
  for (const g of similarGroups(t, prof)) out.push({ level: 'aviso', text: `Em “${g.col}”, ${g.values.map((v) => `“${v.value}” (${v.count})`).join(', ')} parecem a mesma categoria escrita de formas diferentes; os gráficos os contam separados.`, merge: { col: g.col, values: g.values.map((v) => v.value), to: g.suggested } });
  if (loc?.dateAmbiguous) out.push({ level: 'aviso', text: `${loc.dateAmbiguousCount} data(s) com barra têm dia e mês ≤ 12 (ex.: 03/04/2024), então não dá para saber se é dia/mês ou mês/dia. Estou usando ${loc.dateOrder === 'dmy' ? 'dia/mês/ano' : 'mês/dia/ano'}; confirme na prévia.` });
  if (loc?.numberAmbiguous) out.push({ level: 'aviso', text: `${loc.numberAmbiguousCount} número(s) como “1.234” podem ser milhar (1234) ou decimal (1,234). Estou usando ${loc.numbers === 'br' ? 'o padrão brasileiro (ponto = milhar)' : 'o padrão americano (ponto = decimal)'}; confirme na prévia.` });
  const dup = t.rows.length - new Set(t.rows.map((r) => JSON.stringify(t.columns.map((c) => r[c])))).size;
  if (dup > 0) out.push({ level: 'aviso', text: `${dup} linha(s) idêntica(s) a outra (possíveis duplicatas).` });
  for (const p of prof) {
    if (p.filled === 0) out.push({ level: 'aviso', text: `“${p.name}” está totalmente vazia.` });
    else if (p.missing / t.rows.length >= 0.3) out.push({ level: 'aviso', text: `“${p.name}” tem ${Math.round((p.missing / t.rows.length) * 100)}% de células vazias; os gráficos usam só as preenchidas.` });
    if (p.filled > 1 && p.unique === 1) out.push({ level: 'info', text: `“${p.name}” tem um único valor em todas as linhas; não gera gráfico.` });
    if ((p.type === 'number' || p.type === 'integer') && p.filled >= 8) {
      const v = t.rows.map((r) => toNumber(r[p.name] ?? null)).filter((x): x is number => x != null).sort((a, b) => a - b);
      const q = (f: number) => v[Math.floor((v.length - 1) * f)]!;
      const iqr = q(0.75) - q(0.25);
      const out_ = iqr > 0 ? v.filter((x) => x < q(0.25) - 3 * iqr || x > q(0.75) + 3 * iqr).length : 0;
      if (out_) out.push({ level: 'info', text: `“${p.name}” tem ${out_} valor(es) muito distante(s) dos demais (confira se são erros de digitação).` });
    }
  }
  out.push(...relationAlerts(t, prof));
  for (const n of t.notes ?? []) out.push({ level: 'info', text: n });
  return out;
}

/** Relação encontrada: P = A ÷ B × 100 (A ≤ B) em todas (ou na maioria) das linhas. */
export interface Relation {
  p: string;
  a: string;
  b: string;
  n: number;
  bad: number[];
}

/**
 * Procura taxas e índices que saem de duas outras colunas (P = A ÷ B × 100). A mesma relação aparece em várias formas
 * (A = B÷C×100, C = B÷A×100…); fica a forma em que o resultado é a taxa (nome com índice/taxa/cobertura ou terminado em %).
 */
export function findRelations(t: Table, prof: ColProfile[]): Relation[] {
  const nums = prof.filter((p) => (p.type === 'number' || p.type === 'integer') && p.unique > 1).slice(0, 14);
  if (nums.length < 3 || t.rows.length < 3 || t.rows.length > 5000) return [];
  const vals = new Map(nums.map((c) => [c.name, t.rows.map((r) => toNumber(r[c.name] ?? null))]));
  const found: { key: string; rate: boolean; rel: Relation }[] = [];
  for (const P of nums) {
    const pv = vals.get(P.name)!;
    let best: Relation | null = null;
    for (const A of nums) {
      for (const B of nums) {
        if (A.name === B.name || A.name === P.name || B.name === P.name) continue;
        const av = vals.get(A.name)!;
        const bv = vals.get(B.name)!;
        let n = 0;
        const bad: number[] = [];
        for (let i = 0; i < pv.length; i++) {
          const a = av[i];
          const b = bv[i];
          const pp = pv[i];
          if (a == null || b == null || pp == null || b === 0) continue;
          n++;
          if (a > b || Math.abs((a / b) * 100 - pp) > Math.max(0.1, Math.abs(pp) * 0.005)) bad.push(i + 1);
        }
        if (n >= 3 && bad.length <= Math.floor(n / 3) && (!best || bad.length < best.bad.length)) best = { p: P.name, a: A.name, b: B.name, n, bad };
      }
    }
    if (best) found.push({ key: [P.name, best.a, best.b].sort().join('|'), rate: /índice|indice|taxa|cobertura|propor[cç][ãa]o|percentual|%/i.test(P.name) || !!P.percent, rel: best });
  }
  const byKey = new Map<string, (typeof found)[number]>();
  for (const f of found) {
    const cur = byKey.get(f.key);
    if (!cur || (f.rate && !cur.rate)) byKey.set(f.key, f);
  }
  return [...byKey.values()].map((f) => f.rel);
}

/** Avisa quando uma taxa confere (ou não) com as colunas de que sai. */
export function relationAlerts(t: Table, prof: ColProfile[]): Alert[] {
  return findRelations(t, prof).slice(0, 6).map((r) => {
    const calc = `“${r.a}” ÷ “${r.b}” × 100`;
    return { level: r.bad.length ? 'aviso' : 'info', text: r.bad.length ? `“${r.p}” bate com ${calc} em ${r.n - r.bad.length} de ${r.n} linhas; confira a(s) linha(s) ${r.bad.join(', ')}, que não bate(m).` : `“${r.p}” confere com ${calc} em todas as ${r.n} linhas (diferença dentro de arredondamento).` } as Alert;
  });
}

import { VALUE_COL } from '../grid.js';
import { toNumber } from '../profile.js';
import type { ChartSpec, Table } from '../types.js';
import { NONE, pivotData } from './chartData.js';

/** Opções de "positividade" quando há situações do tipo confirmados / descartados / notificados. */
export function rateOptions(sitNames: string[]) {
  const find = (re: RegExp) => sitNames.filter((n) => re.test(n.toLowerCase()) && !/crit[eé]rio/.test(n.toLowerCase()));
  const conf = find(/confirmad/);
  const desc = find(/descartad/);
  const notif = find(/notificad/);
  const opts: { label: string; numerator: string[]; denominator: string[]; explain: string }[] = [];
  if (conf.length && desc.length) opts.push({ label: 'Confirmados ÷ concluídos', numerator: conf, denominator: [...conf, ...desc], explain: 'Positividade = confirmados ÷ (confirmados + descartados): entre os casos que já tiveram conclusão, quantos foram confirmados. Casos “em andamento” ficam fora.' });
  if (conf.length && notif.length) opts.push({ label: 'Confirmados ÷ notificados', numerator: conf, denominator: notif, explain: 'Taxa = confirmados ÷ notificados: do total notificado, quantos já estão confirmados. Cai quando há muitos casos ainda em andamento.' });
  return opts;
}

/** Taxa (%) por rótulo do eixo x, usando as mesmas linhas filtradas do gráfico. */
export function rateData(t: Table, spec: ChartSpec, optIdx: number): { labels: string[]; values: number[]; explain: string; name: string } | null {
  const td = t.tidy;
  const opt = spec.rate?.options[optIdx] ?? spec.rate?.options[0];
  if (!td?.situation || !opt || !spec.x) return null;
  const rows = t.rows.filter((r) => !td.agravo || !spec.rate?.agravo || (r[td.agravo] == null ? spec.rate.agravo.includes(NONE) : spec.rate.agravo.includes(String(r[td.agravo]))));
  const labels = pivotData(t, { ...spec, seriesBy: undefined }).labels;
  const sum = (k: string, names: string[]) => rows.reduce((a, r) => (String(r[spec.x!]) === k && names.includes(String(r[td.situation!])) ? a + (toNumber(r[VALUE_COL] ?? null) ?? 0) : a), 0);
  const has = (k: string, names: string[]) => rows.some((r) => String(r[spec.x!]) === k && names.includes(String(r[td.situation!])) && r[VALUE_COL] != null);
  const values = labels.map((k) => (has(k, opt.denominator) && sum(k, opt.denominator) > 0 ? (sum(k, opt.numerator) / sum(k, opt.denominator)) * 100 : Number.NaN));
  return { labels, values, explain: opt.explain, name: `Positividade (${opt.label})` };
}

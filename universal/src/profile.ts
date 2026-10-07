import type { Cell, ColProfile, ColType, Row, Table } from './types.js';

const DATE_RES = [/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?/, /^\d{1,2}\/\d{1,2}\/\d{2,4}$/];
const BOOL = new Set(['sim', 'não', 'nao', 'true', 'false', 'yes', 'no', 's', 'n']);

/** Converte célula em timestamp (ms) ou null. Aceita ISO e dd/mm/aaaa. */
export function toDate(v: Cell): number | null {
  if (v instanceof Date) return v.getTime();
  if (typeof v !== 'string') return null;
  const s = v.trim();
  const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (br) {
    const y = Number(br[3]!.length === 2 ? '20' + br[3] : br[3]);
    const d = new Date(Date.UTC(y, Number(br[2]) - 1, Number(br[1])));
    return d.getUTCMonth() === Number(br[2]) - 1 ? d.getTime() : null;
  }
  if (DATE_RES[0]!.test(s)) {
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

/** Converte célula em número (aceita vírgula decimal e separador de milhar BR). */
export function toNumber(v: Cell): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const s = v.trim().replace(/^R\$\s*/, '').replace(/%$/, '');
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) return Number(s.replace(/\./g, '').replace(',', '.'));
  if (/^-?\d+,\d+$/.test(s)) return Number(s.replace(',', '.'));
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return null;
}

function median(sorted: number[]): number {
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m]! : (sorted[m - 1]! + sorted[m]!) / 2;
}

export function profileColumn(name: string, rows: Row[], geo?: Table['geo']): ColProfile {
  const vals = rows.map((r) => r[name]).filter((v): v is Exclude<Cell, null> => v != null);
  const filled = vals.length;
  const missing = rows.length - filled;
  const base: ColProfile = { name, type: 'text', filled, missing, unique: new Set(vals.map((v) => String(v))).size };
  if (!filled) return base;

  const nums = vals.map(toNumber);
  const dates = vals.map(toDate);
  const frac = (a: unknown[]) => a.filter((x) => x != null).length / filled;
  const lname = name.toLowerCase();

  let type: ColType;
  if (vals.every((v) => typeof v === 'boolean') || (base.unique <= 2 && vals.every((v) => BOOL.has(String(v).toLowerCase())))) type = 'boolean';
  else if (frac(nums) >= 0.95 && vals.some((v) => typeof v === 'number' || /^-?[\d.,]+$/.test(String(v)))) {
    type = nums.every((n) => n == null || Number.isInteger(n)) ? 'integer' : 'number';
  } else if (frac(dates) >= 0.9) type = 'date';
  else if (base.unique <= Math.max(20, filled * 0.05) && base.unique < filled) type = 'category';
  else if (base.unique >= filled * 0.95 && filled > 5) type = 'id';
  else type = base.unique <= 60 ? 'category' : 'text';

  if ((type === 'number' || type === 'integer') && geo) {
    if (name === geo.lat) type = 'lat';
    if (name === geo.lon) type = 'lon';
  } else if ((type === 'number' || type === 'integer') && /^(lat|latitude)$/.test(lname)) type = 'lat';
  else if ((type === 'number' || type === 'integer') && /^(lon|lng|long|longitude)$/.test(lname)) type = 'lon';
  // código/identificador numérico: inteiros quase todos distintos
  if (type === 'integer' && base.unique >= filled * 0.95 && filled > 5 && /(^id$|^id[_ ]|código|codigo|cod\b|\bid$)/.test(lname)) type = 'id';
  base.type = type;

  if (type === 'number' || type === 'integer') {
    const n = nums.filter((x): x is number => x != null).sort((a, b) => a - b);
    base.min = n[0];
    base.max = n[n.length - 1];
    base.sum = n.reduce((a, b) => a + b, 0);
    base.mean = base.sum / n.length;
    base.median = median(n);
  }
  if (type === 'date') {
    const d = dates.filter((x): x is number => x != null);
    base.minDate = Math.min(...d);
    base.maxDate = Math.max(...d);
  }
  if (type === 'category' || type === 'boolean') {
    const c = new Map<string, number>();
    for (const v of vals) c.set(String(v), (c.get(String(v)) ?? 0) + 1);
    base.top = [...c.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }));
  }
  return base;
}

export const profileTable = (t: Table): ColProfile[] => t.columns.map((c) => profileColumn(c, t.rows, t.geo));

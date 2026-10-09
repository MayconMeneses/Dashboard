import type { Cell, ColProfile, ColType, Row, Table } from './types.js';
import { maxOf, minOf } from './util.js';

const DATE_RES = [/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?/, /^\d{1,2}\/\d{1,2}\/\d{2,4}$/];
const BOOL = new Set(['sim', 'não', 'nao', 'true', 'false', 'yes', 'no', 's', 'n']);
/** marcadores comuns de "sem informação": contam como vazio, não como valor inválido */
export const MISSING_TOKENS = new Set(['n/d', 'nd', 'n/a', 'na', 's/i', 'si', '-', '--', '—', 'sem dado', 'sem dados', 'não informado', 'nao informado', 'null', 'nan']);
export const isMissingToken = (v: unknown) => typeof v === 'string' && MISSING_TOKENS.has(v.trim().toLowerCase());

/** Interpretação regional usada em toda a leitura de datas e números. */
export const locale = { dateOrder: 'dmy' as 'dmy' | 'mdy', numbers: 'br' as 'br' | 'us' };

export interface LocaleInfo {
  dateOrder: 'dmy' | 'mdy';
  numbers: 'br' | 'us';
  /** todas as datas com barra têm dia e mês ≤ 12: não dá para saber a ordem */
  dateAmbiguous: boolean;
  dateAmbiguousCount: number;
  /** há números como "1.234" que podem ser milhar ou decimal */
  numberAmbiguous: boolean;
  numberAmbiguousCount: number;
}

/** Converte célula em timestamp (ms) ou null. Aceita ISO e dd/mm/aaaa (ou mm/dd/aaaa conforme `locale`). */
export function toDate(v: Cell): number | null {
  if (v instanceof Date) return v.getTime();
  if (typeof v !== 'string') return null;
  const s = v.trim();
  const sl = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (sl) {
    const [a, b] = [Number(sl[1]), Number(sl[2])];
    const [day, month] = locale.dateOrder === 'dmy' ? [a, b] : [b, a];
    const y = Number(sl[3]!.length === 2 ? '20' + sl[3] : sl[3]);
    const d = new Date(Date.UTC(y, month - 1, day));
    return d.getUTCMonth() === month - 1 && d.getUTCDate() === day ? d.getTime() : null;
  }
  if (DATE_RES[0]!.test(s)) {
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

/** Converte célula em número. Formatos inequívocos (1.234,56 e 1,234.56) são sempre aceitos; os ambíguos seguem `locale.numbers`. */
export function toNumber(v: Cell): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const s = v.trim().replace(/^R\$\s*/, '').replace(/^US\$\s*/, '').replace(/%$/, '');
  if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(s)) return Number(s.replace(/\./g, '').replace(',', '.')); // 1.234,56
  if (/^-?\d{1,3}(,\d{3})+\.\d+$/.test(s)) return Number(s.replace(/,/g, '')); // 1,234.56
  if (locale.numbers === 'br') {
    if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) return Number(s.replace(/\./g, '')); // 1.234 = mil duzentos e trinta e quatro
    if (/^-?\d+,\d+$/.test(s)) return Number(s.replace(',', '.'));
  } else {
    if (/^-?\d{1,3}(,\d{3})+$/.test(s)) return Number(s.replace(/,/g, '')); // 1,234 = mil duzentos e trinta e quatro
  }
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return null;
}

/** Examina as células de texto e sugere a interpretação regional; indica o que continua ambíguo. */
export function inferLocale(tables: Table[]): LocaleInfo {
  let dmyOnly = 0;
  let mdyOnly = 0;
  let both = 0;
  let usEvidence = 0;
  let brEvidence = 0;
  let dotThousands = 0;
  for (const t of tables) {
    let seen = 0;
    for (const r of t.rows) {
      for (const c of t.columns) {
        const v = r[c];
        if (typeof v !== 'string') continue;
        if (++seen > 30000) break;
        const sl = v.match(/^(\d{1,2})\/(\d{1,2})\/\d{2,4}$/);
        if (sl) {
          const [a, b] = [Number(sl[1]), Number(sl[2])];
          if (a > 12 && b <= 12) dmyOnly++;
          else if (b > 12 && a <= 12) mdyOnly++;
          else if (a <= 12 && b <= 12) both++;
          continue;
        }
        const s = v.trim();
        if (/^-?\d{1,3}(,\d{3})+\.\d+$/.test(s)) usEvidence++;
        else if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(s) || /^-?\d+,\d{1,2}$/.test(s)) brEvidence++;
        else if (/^-?\d{1,3}\.\d{3}$/.test(s)) dotThousands++;
      }
    }
  }
  const dateOrder = mdyOnly > dmyOnly ? 'mdy' : 'dmy';
  const numbers = usEvidence > brEvidence ? 'us' : 'br';
  return {
    dateOrder,
    numbers,
    dateAmbiguous: dmyOnly === 0 && mdyOnly === 0 && both > 0,
    dateAmbiguousCount: both,
    numberAmbiguous: dotThousands > 0 && usEvidence === 0 && brEvidence === 0,
    numberAmbiguousCount: dotThousands,
  };
}

const MONTH_NAMES = new Set(['janeiro', 'fevereiro', 'março', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro', 'jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']);

function median(sorted: number[]): number {
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m]! : (sorted[m - 1]! + sorted[m]!) / 2;
}

export function profileColumn(name: string, rows: Row[], geo?: Table['geo'], forced?: ColType): ColProfile {
  const rawVals = rows.map((r) => r[name]);
  const missingTokens = rawVals.filter(isMissingToken).length;
  const vals = rawVals.filter((v): v is Exclude<Cell, null> => v != null && !isMissingToken(v));
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
  else if (frac(nums) >= 0.8 && vals.some((v) => typeof v === 'number' || /^(R\$\s*|US\$\s*)?-?[\d.,]+\s*%?$/.test(String(v)))) {
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
  // ano (2024) ou mês por extenso, todos distintos: é eixo de período, não medida
  const isYear = (type === 'integer' || type === 'category' || type === 'text') && /^(ano|anos|year|exerc[ií]cio)$/i.test(lname.trim()) && vals.every((v) => /^(19|20)\d{2}$/.test(String(v).trim()));
  const isMonth = (type === 'category' || type === 'text') && base.unique >= 3 && vals.every((v) => MONTH_NAMES.has(String(v).trim().toLowerCase().replace(/\.$/, '')));
  if (isYear || isMonth) {
    type = 'category';
    base.period = true;
  }
  if (forced) type = forced;
  base.type = type;
  if (vals.filter((v) => typeof v === 'string' && v.trim().endsWith('%')).length >= filled * 0.8 && (type === 'number' || type === 'integer')) base.percent = true;
  if (missingTokens) base.missingMarkers = missingTokens;
  if (type === 'number' || type === 'integer' || type === 'lat' || type === 'lon') {
    const bad: { row: number; value: string }[] = [];
    let n = 0;
    rawVals.forEach((v, i) => {
      if (v == null || isMissingToken(v) || toNumber(v as Cell) != null) return;
      n++;
      if (bad.length < 25) bad.push({ row: i + 1, value: String(v) });
    });
    if (n) {
      base.invalidCount = n;
      base.invalid = bad;
    }
  }

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
    base.minDate = minOf(d);
    base.maxDate = maxOf(d);
  }
  if (type === 'category' || type === 'boolean') {
    const c = new Map<string, number>();
    for (const v of vals) c.set(String(v), (c.get(String(v)) ?? 0) + 1);
    base.top = [...c.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }));
  }
  return base;
}

export const profileTable = (t: Table, forced: Record<string, ColType> = {}): ColProfile[] => t.columns.map((c) => profileColumn(c, t.rows, t.geo, forced[c]));

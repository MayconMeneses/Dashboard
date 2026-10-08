import { toNumber } from './profile.js';
import type { Row, Table } from './types.js';

const str = (v: unknown): string => (v == null ? '' : String(v).trim());
const filled = (r: unknown[]) => r.map((c, i) => [i, str(c)] as const).filter(([, s]) => s !== '');
const isNumeric = (s: string) => toNumber(s) != null;

interface Section {
  header: number;
  periodRow: number;
  periodKey: string;
  period: string;
  end: number;
}

/** Nome do período a partir de uma linha "chave valor" (ex.: "Mês | Janeiro") ou de uma célula só. */
function periodOf(row: unknown[] | undefined, n: number): { key: string; value: string } {
  const cells = row ? filled(row).map(([, s]) => s) : [];
  if (cells.length === 2) return { key: cells[0]!.replace(/[:：]\s*$/, ''), value: cells[1]! };
  if (cells.length === 1) {
    const m = cells[0]!.match(/^(m[eê]s|per[ií]odo|semana|ano|trimestre|compet[eê]ncia|data)\s*[:\-–]?\s+(.+)$/i);
    if (m) return { key: m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1).toLowerCase(), value: m[2]! };
    return { key: 'Período', value: cells[0]! };
  }
  return { key: 'Período', value: `Bloco ${n}` };
}

const SUFFIX_MIN = 3;
const ACCENTS: Record<string, string> = { municipio: 'Município', periodo: 'Período', mes: 'Mês', regiao: 'Região', unidade: 'Unidade', estado: 'Estado' };
/** Ajusta só o NOME do cabeçalho (ex.: "Municipio" -> "Município") e títulos de período todos em maiúsculas ("MARÇO" -> "Março"). */
const fixHeader = (s: string) => ACCENTS[s.toLowerCase()] ?? s;
const fixPeriod = (s: string) => (s.length > 3 && s === s.toUpperCase() && /[A-ZÀ-Ý]/.test(s) ? s.charAt(0) + s.slice(1).toLowerCase() : s);

/** Separa "Notificados Dengue" em situação ("Notificados") e agravo ("Dengue") quando o último termo se repete. */
function splitLabels(labels: string[]): Map<string, { situation: string; agravo: string | null }> | null {
  const last = new Map<string, Set<string>>();
  for (const l of labels) {
    const w = l.split(/\s+/);
    if (w.length < 2) continue;
    const k = w[w.length - 1]!;
    if (!last.has(k)) last.set(k, new Set());
    last.get(k)!.add(l);
  }
  const suffixes = new Set([...last.entries()].filter(([, s]) => s.size >= SUFFIX_MIN).map(([k]) => k));
  if (suffixes.size < 2) return null;
  const out = new Map<string, { situation: string; agravo: string | null }>();
  for (const l of labels) {
    const w = l.split(/\s+/);
    const k = w[w.length - 1]!;
    out.set(l, w.length >= 2 && suffixes.has(k) ? { situation: w.slice(0, -1).join(' '), agravo: k } : { situation: l, agravo: null });
  }
  return out;
}

/**
 * Detecta planilhas com o MESMO cabeçalho repetido em vários blocos (ex.: um bloco por mês, colunas = municípios,
 * linhas = indicadores) e as converte em uma tabela "organizada": Período | Entidade | Indicador | Situação | Agravo | Valor.
 * Células em branco ficam como "sem dado" (nunca viram zero). Devolve null se o padrão não existir.
 */
export function detectRepeatedBlocks(name: string, matrix: unknown[][]): Table | null {
  const headers: { row: number; col0: number; sig: string; cols: [number, string][] }[] = [];
  matrix.forEach((r, i) => {
    const f = filled(r);
    if (f.length < 4) return;
    const rest = f.slice(1);
    // cabeçalho: um rótulo seguido de vários textos que não são números
    if (rest.some(([, s]) => isNumeric(s))) return;
    headers.push({ row: i, col0: f[0]![0], sig: rest.map(([, s]) => s).join('|'), cols: rest.map(([c, s]) => [c, s] as [number, string]) });
  });
  const bySig = new Map<string, typeof headers>();
  for (const h of headers) bySig.set(h.sig, [...(bySig.get(h.sig) ?? []), h]);
  const best = [...bySig.values()].sort((a, b) => b.length - a.length)[0];
  if (!best || best.length < 2) return null;

  const sections: Section[] = [];
  best.forEach((h, k) => {
    // período = primeira linha não vazia acima do cabeçalho, se tiver só 1–2 células
    let p = h.row - 1;
    while (p >= 0 && filled(matrix[p]!).length === 0) p--;
    const prevHeader = k > 0 ? best[k - 1]!.row : -1;
    const hasPeriod = p > prevHeader && filled(matrix[p]!).length > 0 && filled(matrix[p]!).length <= 2;
    const per = periodOf(hasPeriod ? matrix[p] : undefined, k + 1);
    sections.push({ header: h.row, periodRow: hasPeriod ? p : h.row, periodKey: per.key, period: per.value, end: matrix.length });
  });
  sections.forEach((s, k) => (s.end = k + 1 < sections.length ? sections[k + 1]!.periodRow : matrix.length));

  const cols = best[0]!.cols;
  const col0 = best[0]!.col0;
  const entityName = fixHeader(str(matrix[best[0]!.row]![col0]) || 'Item');
  const periodKey = fixHeader(sections[0]!.periodKey);
  for (const s of sections) s.period = fixPeriod(s.period);
  type L = { period: string; label: string; entity: string; value: number | null };
  const longRows: L[] = [];
  for (const s of sections) {
    for (let r = s.header + 1; r < s.end; r++) {
      const row = matrix[r]!;
      const label = str(row[col0]);
      if (!label) continue;
      const nums = cols.filter(([c]) => isNumeric(str(row[c]))).length;
      if (nums === 0 && cols.every(([c]) => str(row[c]) === '')) continue; // linha só com rótulo
      for (const [c, ent] of cols) {
        const s2 = str(row[c]);
        longRows.push({ period: s.period, label, entity: ent, value: s2 === '' ? null : toNumber(s2) });
      }
    }
  }
  if (!longRows.length) return null;

  // colunas totalmente vazias (ex.: "Total" sem valor calculado) saem; as demais mantêm os vazios como "sem dado"
  const emptyEntities = new Set(cols.map(([, e]) => e).filter((e) => longRows.filter((x) => x.entity === e).every((x) => x.value == null)));
  const kept = longRows.filter((x) => !emptyEntities.has(x.entity));
  const labels = [...new Set(kept.map((x) => x.label))];
  const split = splitLabels(labels);

  const columns = [periodKey, entityName, 'Indicador', ...(split ? ['Situação', 'Agravo'] : []), 'Valor'];
  const rows: Row[] = kept.map((x) => {
    const o: Row = { [periodKey]: x.period, [entityName]: x.entity, Indicador: x.label };
    if (split) {
      const sp = split.get(x.label)!;
      o['Situação'] = sp.situation;
      o['Agravo'] = sp.agravo;
    }
    o['Valor'] = x.value;
    return o;
  });

  const notes = [`Reconheci ${sections.length} blocos com o mesmo cabeçalho (${sections.map((s) => s.period).join(', ')}) e os reuni em uma única tabela: ${periodKey} × ${entityName} × indicador.`];
  if (emptyEntities.size) notes.push(`A coluna “${[...emptyEntities].join('”, “')}” está sem valores no arquivo (provavelmente fórmula não calculada) e foi ignorada; os totais são calculados aqui.`);
  if (split) notes.push('Separei o nome do indicador em “Situação” e “Agravo” pela última palavra, que se repete em vários indicadores.');
  const missing = kept.filter((x) => x.value == null).length;
  if (missing) notes.push(`${missing} células em branco foram mantidas como “sem dado” (não são zero).`);

  const titleCell = (() => {
    for (let i = 0; i < Math.min(sections[0]!.periodRow, matrix.length); i++) {
      const f = filled(matrix[i]!);
      if (f.length) return f.map(([, s]) => s).join(' ').replace(/\s+/g, ' ');
    }
    return undefined;
  })();

  return {
    name,
    title: titleCell,
    columns,
    rows,
    notes,
    tidy: { period: periodKey, entity: entityName, label: 'Indicador', value: 'Valor', ...(split ? { situation: 'Situação', agravo: 'Agravo' } : {}) },
  };
}

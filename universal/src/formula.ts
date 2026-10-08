import { toNumber } from './profile.js';
import type { Cell, Row } from './types.js';

/** Fórmulas de métricas próprias: números, [Coluna], + - * / ( ), ABS, ROUND e agregações (SUM, AVG, MIN, MAX, COUNT, SUMIF, COUNTIF). */
export class FormulaError extends Error {}

type Node =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'ref'; name: string }
  | { t: 'neg'; e: Node }
  | { t: 'bin'; op: '+' | '-' | '*' | '/'; l: Node; r: Node }
  | { t: 'call'; name: string; args: Node[] };

interface Tok {
  k: 'num' | 'str' | 'ref' | 'id' | 'op' | '(' | ')' | ',' | 'eof';
  v: string;
  pos: number;
}

const AGG = new Set(['SUM', 'AVG', 'MIN', 'MAX', 'COUNT', 'SUMIF', 'COUNTIF']);
const ROWFN = new Set(['ABS', 'ROUND']);

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) i++;
    else if (/\d/.test(c) || (c === '.' && /\d/.test(src[i + 1] ?? ''))) {
      let j = i;
      while (j < src.length && /[\d.]/.test(src[j]!)) j++;
      out.push({ k: 'num', v: src.slice(i, j), pos: i });
      i = j;
    } else if (c === '[') {
      const j = src.indexOf(']', i);
      if (j < 0) throw new FormulaError(`Falta fechar o colchete “]” da coluna que começa na posição ${i + 1}.`);
      out.push({ k: 'ref', v: src.slice(i + 1, j).trim(), pos: i });
      i = j + 1;
    } else if (c === '"') {
      const j = src.indexOf('"', i + 1);
      if (j < 0) throw new FormulaError(`Falta fechar as aspas do texto que começa na posição ${i + 1}.`);
      out.push({ k: 'str', v: src.slice(i + 1, j), pos: i });
      i = j + 1;
    } else if (/[A-Za-zÀ-ÿ_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-zÀ-ÿ_0-9]/.test(src[j]!)) j++;
      out.push({ k: 'id', v: src.slice(i, j).toUpperCase(), pos: i });
      i = j;
    } else if ('+-*/'.includes(c)) {
      out.push({ k: 'op', v: c, pos: i });
      i++;
    }
    else if (c === '(' || c === ')' || c === ',') {
      out.push({ k: c, v: c, pos: i });
      i++;
    }
    else throw new FormulaError(`Caractere não permitido “${c}” na posição ${i + 1}.`);
  }
  out.push({ k: 'eof', v: '', pos: src.length });
  return out;
}

function parse(src: string): Node {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p]!;
  const eat = () => toks[p++]!;
  const expect = (k: Tok['k'], what: string) => {
    if (peek().k !== k) throw new FormulaError(`Esperava ${what} na posição ${peek().pos + 1}.`);
    return eat();
  };
  const expr = (): Node => {
    let l = term();
    while (peek().k === 'op' && (peek().v === '+' || peek().v === '-')) {
      const op = eat().v as '+' | '-';
      l = { t: 'bin', op, l, r: term() };
    }
    return l;
  };
  const term = (): Node => {
    let l = unary();
    while (peek().k === 'op' && (peek().v === '*' || peek().v === '/')) {
      const op = eat().v as '*' | '/';
      l = { t: 'bin', op, l, r: unary() };
    }
    return l;
  };
  const unary = (): Node => {
    if (peek().k === 'op' && peek().v === '-') {
      eat();
      return { t: 'neg', e: unary() };
    }
    return primary();
  };
  const primary = (): Node => {
    const t = eat();
    if (t.k === 'num') {
      const v = Number(t.v);
      if (Number.isNaN(v)) throw new FormulaError(`Número inválido “${t.v}” na posição ${t.pos + 1}.`);
      return { t: 'num', v };
    }
    if (t.k === 'str') return { t: 'str', v: t.v };
    if (t.k === 'ref') return { t: 'ref', name: t.v };
    if (t.k === '(') {
      const e = expr();
      expect(')', '“)”');
      return e;
    }
    if (t.k === 'id') {
      if (!AGG.has(t.v) && !ROWFN.has(t.v)) throw new FormulaError(`Função desconhecida “${t.v}”. Use: ${[...ROWFN, ...AGG].join(', ')}.`);
      expect('(', '“(” depois do nome da função');
      const args: Node[] = [];
      if (peek().k !== ')') {
        args.push(expr());
        while (peek().k === ',') {
          eat();
          args.push(expr());
        }
      }
      expect(')', '“)”');
      return { t: 'call', name: t.v, args };
    }
    throw new FormulaError(t.k === 'eof' ? 'A fórmula terminou antes do esperado.' : `Não esperava “${t.v}” na posição ${t.pos + 1}.`);
  };
  const e = expr();
  if (peek().k !== 'eof') throw new FormulaError(`Sobrou texto depois da fórmula, na posição ${peek().pos + 1}: “${peek().v}”.`);
  return e;
}

export interface Compiled {
  src: string;
  ast: Node;
  /** true quando usa SUM/AVG/…: vira um indicador único em vez de uma coluna nova */
  aggregate: boolean;
  columns: string[];
}

/** Lê e valida a fórmula (sintaxe, funções, argumentos e colunas existentes). */
export function compileFormula(src: string, existing?: string[]): Compiled {
  if (!src.trim()) throw new FormulaError('Escreva a fórmula.');
  const ast = parse(src);
  const columns = new Set<string>();
  let aggregate = false;
  let rowRefOutsideAgg = false;
  const check = (n: Node, inAgg: boolean) => {
    if (n.t === 'ref') {
      columns.add(n.name);
      if (!inAgg) rowRefOutsideAgg = true;
    } else if (n.t === 'neg') check(n.e, inAgg);
    else if (n.t === 'bin') {
      check(n.l, inAgg);
      check(n.r, inAgg);
    }
    else if (n.t === 'call') {
      const isAgg = AGG.has(n.name);
      if (isAgg) aggregate = true;
      const need = ({ SUM: 1, AVG: 1, MIN: 1, MAX: 1, COUNT: 0, SUMIF: 3, COUNTIF: 2, ABS: 1, ROUND: 2 } as Record<string, number>)[n.name]!;
      if (n.name === 'COUNT' ? n.args.length > 1 : n.name === 'ROUND' ? n.args.length < 1 || n.args.length > 2 : n.args.length !== need) throw new FormulaError(`${n.name} espera ${n.name === 'COUNT' ? '0 ou 1' : n.name === 'ROUND' ? '1 ou 2' : need} argumento(s).`);
      if (isAgg) {
        const colArgs = n.name === 'SUMIF' ? [0, 1] : n.name === 'COUNTIF' ? [0] : n.args.length ? [0] : [];
        for (const i of colArgs) if (n.args[i]!.t !== 'ref') throw new FormulaError(`${n.name}: o argumento ${i + 1} deve ser uma coluna, como [Coluna].`);
        if ((n.name === 'SUMIF' && n.args[2]!.t === 'ref') || (n.name === 'COUNTIF' && n.args[1]!.t === 'ref')) throw new FormulaError(`${n.name}: o valor a comparar deve ser um texto entre aspas ou um número.`);
        n.args.forEach((a, i) => (a.t === 'ref' ? (columns.add(a.name), i) : check(a, true)));
      } else n.args.forEach((a) => check(a, inAgg));
    }
  };
  check(ast, false);
  if (aggregate && rowRefOutsideAgg) throw new FormulaError('Numa fórmula com SUM, AVG, COUNT etc., toda coluna deve estar dentro de uma dessas funções (ex.: SUM([A]) / SUM([B])).');
  if (existing) {
    const miss = [...columns].filter((c) => !existing.includes(c));
    if (miss.length) throw new FormulaError(`Coluna não encontrada: ${miss.map((m) => `[${m}]`).join(', ')}. Colunas disponíveis: ${existing.slice(0, 12).map((c) => `[${c}]`).join(', ')}${existing.length > 12 ? '…' : ''}.`);
  }
  return { src, ast, aggregate, columns: [...columns] };
}

const num = (v: Cell | undefined): number | null => (v == null ? null : toNumber(v as Cell));

function evalNode(n: Node, row: Row | null, rows: Row[] | null): number | string | null {
  switch (n.t) {
    case 'num':
      return n.v;
    case 'str':
      return n.v;
    case 'ref':
      return row ? num(row[n.name]) : null;
    case 'neg': {
      const v = evalNode(n.e, row, rows);
      return typeof v === 'number' ? -v : null;
    }
    case 'bin': {
      const a = evalNode(n.l, row, rows);
      const b = evalNode(n.r, row, rows);
      if (typeof a !== 'number' || typeof b !== 'number') return null;
      if (n.op === '+') return a + b;
      if (n.op === '-') return a - b;
      if (n.op === '*') return a * b;
      return b === 0 ? null : a / b;
    }
    case 'call': {
      if (AGG.has(n.name)) {
        const rs = rows ?? [];
        const col = (i: number) => (n.args[i] as { name: string }).name;
        const lit = (i: number) => {
          const a = n.args[i]!;
          return a.t === 'str' ? a.v : a.t === 'num' ? String(a.v) : '';
        };
        if (n.name === 'COUNT') return n.args.length ? rs.filter((r) => r[col(0)] != null).length : rs.length;
        if (n.name === 'COUNTIF') return rs.filter((r) => r[col(0)] != null && String(r[col(0)]) === lit(1)).length;
        const vals = (n.name === 'SUMIF' ? rs.filter((r) => r[col(1)] != null && String(r[col(1)]) === lit(2)) : rs).map((r) => num(r[col(0)])).filter((v): v is number => v != null);
        if (!vals.length) return null;
        if (n.name === 'AVG') return vals.reduce((a, b) => a + b, 0) / vals.length;
        if (n.name === 'MIN') return vals.reduce((a, b) => Math.min(a, b), Infinity);
        if (n.name === 'MAX') return vals.reduce((a, b) => Math.max(a, b), -Infinity);
        return vals.reduce((a, b) => a + b, 0); // SUM, SUMIF
      }
      const a = evalNode(n.args[0]!, row, rows);
      if (typeof a !== 'number') return null;
      if (n.name === 'ABS') return Math.abs(a);
      const d = n.args[1] ? evalNode(n.args[1], row, rows) : 0;
      const f = 10 ** (typeof d === 'number' ? d : 0);
      return Math.round(a * f) / f;
    }
  }
}

/** Resultado por linha (fórmula sem agregações). null = sem dado. */
export function evalRow(c: Compiled, row: Row): number | null {
  const v = evalNode(c.ast, row, null);
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Resultado único sobre as linhas (fórmula com agregações). null = sem dado. */
export function evalAggregate(c: Compiled, rows: Row[]): number | null {
  const v = evalNode(c.ast, null, rows);
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

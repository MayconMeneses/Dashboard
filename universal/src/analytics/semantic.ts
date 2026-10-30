import type { ColProfile, ColType, Table } from '../types.js';

/** Papel analítico da coluna: o que ela é para o painel, além do tipo técnico. */
export type Role = 'identifier' | 'measure' | 'dimension' | 'time' | 'geo' | 'flag' | 'text';
export type Unit = 'percent' | 'currency' | 'count';

export interface Semantic {
  name: string;
  role: Role;
  unit?: Unit;
  /** somar os valores faz sentido (contagem, dinheiro, quantidade); percentual e taxa pedem média */
  additive: boolean;
  /** cada regra que decidiu o papel, em frase, para o usuário conferir */
  reasons: string[];
  /** o tipo foi corrigido à mão pelo usuário */
  manual: boolean;
}

const CODE_NAME = /(^|[\s_.-])(cep|cpf|cnpj|rg|telefone|fone|celular|matr[ií]cula|ibge|c[oó]digo|cod|id)($|[\s_.-])/i;
const PERCENT_NAME = /(%|percentual|porcentagem|propor[cç][aã]o|taxa|[ií]ndice|cobertura|raz[aã]o)/i;
const CURRENCY_NAME = /(valor|pre[cç]o|custo|receita|faturamento|sal[aá]rio|despesa|r\$)/i;
const COUNT_NAME = /(qtd|quant|total|n[úu]mero de|casos|[óo]bitos|nascidos|habitantes|popula[cç][aã]o)/i;

function firstFilled(t: Table, name: string): string {
  for (const r of t.rows) {
    const v = r[name];
    if (v != null && v !== '') return String(v).trim();
  }
  return '';
}

/** Deduz o papel de uma coluna. Só regras explícitas, determinísticas: o mesmo arquivo dá sempre o mesmo resultado. */
export function semanticOf(p: ColProfile, t: Table, forced: Record<string, ColType> = {}): Semantic {
  const manual = forced[p.name] != null;
  const out: Semantic = { name: p.name, role: 'text', additive: false, reasons: [], manual };
  const say = (s: string) => out.reasons.push(s);
  if (manual) say(`Tipo definido por você: ${p.type}.`);
  if (p.type === 'lat' || p.type === 'lon') {
    out.role = 'geo';
    say('Coordenada geográfica: não se soma nem se faz média.');
  } else if (p.type === 'date' || p.period) {
    out.role = 'time';
    say(p.period ? 'Sequência de períodos (ano ou mês): serve de eixo de tempo.' : 'Datas: serve de eixo de tempo.');
  } else if (p.type === 'boolean') {
    out.role = 'flag';
    say('Dois valores (sim/não): vira proporção, não soma.');
  } else if (p.type === 'id') {
    out.role = 'identifier';
    say('Quase todos os valores são distintos: identifica o registro, não é medida.');
  } else if (p.type === 'number' || p.type === 'integer') {
    const sample = firstFilled(t, p.name);
    if (CODE_NAME.test(p.name) && (p.min ?? 0) >= 0) {
      out.role = 'identifier';
      say(`O nome “${p.name}” indica um código: somar ou tirar média de códigos não tem significado.`);
    } else {
      out.role = 'measure';
      if (p.percent || PERCENT_NAME.test(p.name)) {
        out.unit = 'percent';
        say(p.percent ? 'Os valores terminam em %: percentual não se soma, usa-se a média.' : `O nome “${p.name}” indica taxa ou proporção: usa-se a média, não a soma.`);
      } else if (/^(R\$|US\$)/.test(sample) || CURRENCY_NAME.test(p.name)) {
        out.unit = 'currency';
        out.additive = true;
        say('Valor em dinheiro: pode ser somado.');
      } else {
        if (p.type === 'integer' && COUNT_NAME.test(p.name)) out.unit = 'count';
        out.additive = true;
        say(out.unit === 'count' ? 'Contagem inteira: pode ser somada.' : 'Valor numérico: pode ser somado e comparado.');
      }
    }
  } else if (p.type === 'category') {
    out.role = 'dimension';
    say(`${p.unique} valor(es) distinto(s) repetidos entre os registros: serve para agrupar.`);
  } else {
    say('Texto livre: sem agrupamento nem conta.');
  }
  return out;
}

export const semanticProfile = (t: Table, prof: ColProfile[], forced: Record<string, ColType> = {}): Semantic[] => prof.map((p) => semanticOf(p, t, forced));

/** Como agregar uma coluna de medida: percentual e taxa pedem média; o resto, soma. */
export const aggFor = (s: Semantic | undefined): 'sum' | 'mean' => (s && s.role === 'measure' && !s.additive ? 'mean' : 'sum');

/** Frases que explicam, coluna por coluna, por que o gráfico usa os dados que usa. */
export function explainColumns(cols: (string | undefined)[], sem: Semantic[]): string[] {
  const by = new Map(sem.map((s) => [s.name, s]));
  return [...new Set(cols.filter((c): c is string => !!c))].flatMap((c) => {
    const s = by.get(c);
    return s ? [`“${c}”: ${s.reasons.join(' ')}`] : [];
  });
}

/** O que mudou de uma coluna entre a tabela inteira e o recorte filtrado (para o usuário ver o efeito do filtro). */
export interface FilterEffect {
  name: string;
  filledFull: number;
  filledView: number;
  uniqueFull: number;
  uniqueView: number;
}

export function filterEffects(full: ColProfile[], view: ColProfile[]): FilterEffect[] {
  const v = new Map(view.map((p) => [p.name, p]));
  return full.flatMap((f) => {
    const w = v.get(f.name);
    return w && (w.filled !== f.filled || w.unique !== f.unique) ? [{ name: f.name, filledFull: f.filled, filledView: w.filled, uniqueFull: f.unique, uniqueView: w.unique }] : [];
  });
}

/** Linhagem: de onde vem cada coluna e o que foi feito com ela (nome original, tipo corrigido, unidade, junção de grafias). */
export interface LineageState {
  renames: Record<string, string>;
  forced: Record<string, ColType>;
  units: Record<string, string>;
  /** coluna → (grafia original → grafia unificada), como no projeto salvo */
  merges: Record<string, Record<string, string>>;
  metrics: { name: string }[];
}

export function lineageOf(column: string, st: LineageState): string[] {
  const out: string[] = [];
  const original = Object.entries(st.renames).find(([, to]) => to === column)?.[0];
  if (original) out.push(`Renomeada de “${original}”.`);
  if (st.metrics.some((m) => m.name === column || `${m.name} (métrica)` === column)) out.push('Calculada por você a partir de outras colunas (métrica).');
  if (st.forced[column]) out.push(`Tipo corrigido por você para ${st.forced[column]}.`);
  if (st.units[column]) out.push(`Unidade informada por você: ${st.units[column]}.`);
  const mg = Object.entries(st.merges[column] ?? {}).filter(([a, b]) => a !== b);
  if (mg.length) out.push(`${mg.length} grafia(s) unificada(s): ${mg.slice(0, 5).map(([a, b]) => `“${a}” → “${b}”`).join('; ')}${mg.length > 5 ? '…' : ''}.`);
  return out.length ? out : ['Lida do arquivo sem alteração.'];
}

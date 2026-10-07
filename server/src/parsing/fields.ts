import type { CanonicalField, ExamResult, SearchResult } from './types.js';
import { levenshtein, normalizeKey } from './text.js';

export const FIELD_ALIASES: Record<Exclude<CanonicalField, 'ignorar'>, string[]> = {
  localidade: ['localidade', 'nome_localidade', 'comunidade', 'povoado', 'sitio', 'distrito', 'local', 'bairro'],
  data_visita: ['data_de_captura', 'data', 'data_visita', 'data_da_visita', 'dt_visita', 'data_captura', 'data_da_captura', 'dt_captura', 'data_busca'],
  data_exame: ['data_exame', 'data_do_exame', 'dt_exame', 'data_resultado', 'data_laudo'],
  resultado_busca: ['resultado_busca', 'resultado_da_busca', 'situacao_busca', 'busca', 'houve_captura', 'captura_realizada', 'captura'],
  resultado_exame: ['resultado_do_exame_a_fresco', 'resultado_exame_a_fresco', 'resultado_exame', 'resultado_do_exame', 'exame', 'resultado', 'positividade', 't_cruzi', 'infeccao', 'resultado_laboratorio'],
  quantidade: ['quantidade', 'qtd', 'qtde', 'n_triatomineos', 'numero_de_triatomineos', 'exemplares', 'total_triatomineos'],
  fase: ['fase', 'estagio', 'estadio'],
  sexo: ['sexo'],
  especie: ['especie', 'especie_triatomineo'],
  endereco: ['endereco_completo', 'endereco', 'logradouro', 'rua'],
  imovel: ['numero_da_residencia', 'numero_residencia', 'residencia', 'imovel', 'numero_imovel', 'n_imovel', 'codigo_imovel', 'cod_imovel'],
  pit: ['nome_do_pit', 'pit', 'codigo_pit', 'cod_pit', 'numero_pit'],
  id_origem: ['n_da_etiqueta', 'numero_da_etiqueta', 'etiqueta', 'id', 'codigo', 'cod', 'identificador', 'id_registro', 'id_origem'],
  canal: ['campanha_captura_ou_pit', 'captura_ou_pit', 'campanha', 'origem_captura'],
  ambiente: ['intra_ou_peri', 'ambiente', 'local_captura'],
  fase_sexo: ['ninfa_macho_ou_femea', 'fase_sexo', 'ninfa_macho_femea'],
};

/** Campos que só aparecem como informação auxiliar; ficam no registro original, sem gerar aviso de "campo sem mapeamento". */
export const IGNORED_FIELDS = new Set(
  ['descricao', 'latitude', 'longitude', 'estado_uf', 'municipio', 'cep', 'ponto_de_referencia', 'quantidade_de_imoveis', 'cod_da_localidade', 'zona', 'nome'].map(normalizeKey),
);

/** Campos com dados pessoais: nunca são importados nem exibidos. */
export const PERSONAL_FIELDS = new Set(
  ['morador', 'nome_morador', 'proprietario', 'responsavel', 'telefone', 'celular', 'cpf', 'rg', 'email', 'nome_do_morador', 'contato'].map(normalizeKey),
);

const REVERSE = new Map<string, CanonicalField>();
for (const [canon, aliases] of Object.entries(FIELD_ALIASES)) for (const a of aliases) if (!REVERSE.has(a)) REVERSE.set(a, canon as CanonicalField);

export function canonicalFor(rawKey: string, userMap: Record<string, CanonicalField> = {}): CanonicalField | null {
  const k = normalizeKey(rawKey);
  for (const [uk, v] of Object.entries(userMap)) if (normalizeKey(uk) === k) return v;
  return REVERSE.get(k) ?? (IGNORED_FIELDS.has(k) ? 'ignorar' : null);
}

export function parseExamResult(v: string | undefined): { value: ExamResult; recognized: boolean } {
  const s = normalizeKey(v ?? '');
  if (!s) return { value: 'nao_informado', recognized: true };
  if (['positivo', 'pos', 'p', 'positiva', 'sim', 'reagente', 'infectado', 'tc', 'positive'].includes(s)) return { value: 'positivo', recognized: true };
  if (['negativo', 'neg', 'n', 'negativa', 'nao', 'nao_reagente', 'nao_infectado', 'negative'].includes(s)) return { value: 'negativo', recognized: true };
  if (['pendente', 'aguardando', 'em_analise', 'aguardando_resultado', 'em_exame'].includes(s)) return { value: 'pendente', recognized: true };
  if (['nao_realizado', 'nao_realizada', 'sem_exame', 'nr', 'nao_examinado', 'nao_foi_examinado'].includes(s)) return { value: 'nao_realizado', recognized: true };
  if (['nao_informado', 'ni', 'sem_informacao', 'ignorado'].includes(s)) return { value: 'nao_informado', recognized: true };
  // erro de digitação de 1 letra (ex.: "Negaivo")
  if (s.length >= 6 && levenshtein(s, 'negativo') <= 1) return { value: 'negativo', recognized: true };
  if (s.length >= 6 && levenshtein(s, 'positivo') <= 1) return { value: 'positivo', recognized: true };
  return { value: 'nao_informado', recognized: false };
}

export function parseSearchResult(v: string | undefined): { value: SearchResult; recognized: boolean } {
  const s = normalizeKey(v ?? '');
  if (!s) return { value: 'nao_informado', recognized: true };
  if (['com_captura', 'capturado', 'capturados', 'positiva', 'positivo', 'sim', 'houve_captura', 'com_triatomineo', 'com_triatomineos'].includes(s)) return { value: 'com_captura', recognized: true };
  if (['sem_captura', 'nao_capturado', 'negativa', 'negativo', 'nao', 'sem_triatomineo', 'sem_triatomineos', 'nenhuma_captura'].includes(s)) return { value: 'sem_captura', recognized: true };
  if (['nao_informado', 'ni', 'sem_informacao', 'ignorado'].includes(s)) return { value: 'nao_informado', recognized: true };
  return { value: 'nao_informado', recognized: false };
}

/** Aceita dd/mm/aaaa, aaaa-mm-dd e ISO com hora. Retorna YYYY-MM-DD ou null. */
export function parseDate(v: string | null | undefined): { date: string | null; valid: boolean } {
  const s = (v ?? '').trim();
  if (!s) return { date: null, valid: true };
  let y: number, m: number, d: number;
  let mt = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?!\d)/.exec(s);
  if (mt) {
    d = +mt[1]!;
    m = +mt[2]!;
    y = mt[3]!.length === 2 ? 2000 + +mt[3]! : +mt[3]!;
  } else if ((mt = /^(\d{4})-(\d{2})-(\d{2})/.exec(s))) {
    y = +mt[1]!;
    m = +mt[2]!;
    d = +mt[3]!;
  } else return { date: null, valid: false };
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d || y < 1990 || y > 2100) return { date: null, valid: false };
  return { date: `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, valid: true };
}

export function parseCount(v: string | undefined): number | null {
  const m = /^\s*(\d{1,6})\b/.exec(v ?? '');
  return m ? Number(m[1]) : null;
}

export function parseChannel(v: string | undefined): 'captura' | 'pit' | null {
  const s = normalizeKey(v ?? '');
  if (!s) return null;
  if (s.startsWith('pit')) return 'pit';
  if (s.startsWith('captura') || s.startsWith('campanha')) return 'captura';
  return null;
}

export function parseEnvironment(v: string | undefined): 'intra' | 'peri' | 'intra_peri' | null {
  const s = normalizeKey(v ?? '');
  const intra = /\bintra|^intra/.test(s);
  const peri = /(^|_)peri/.test(s);
  return intra && peri ? 'intra_peri' : intra ? 'intra' : peri ? 'peri' : null;
}

/** "Ninfa_Macho ou Femea" mistura fase e sexo: separa os dois. */
export function parseStageSex(v: string | undefined): { stage: string | null; sex: string | null } {
  const s = normalizeKey(v ?? '');
  if (!s) return { stage: null, sex: null };
  const nin = s.includes('ninfa');
  const mac = s.includes('macho');
  const fem = s.includes('femea');
  const sex = mac && fem ? 'Macho e Fêmea' : mac ? 'Macho' : fem ? 'Fêmea' : null;
  const stage = nin && (mac || fem) ? 'Ninfa e adulto' : nin ? 'Ninfa' : mac || fem ? 'Adulto' : null;
  return { stage, sex };
}

/** Normaliza grafias de espécie vindas do nome do registro (ex.: "P. Lutzi P." -> "Panstrongylus lutzi"). O valor original fica no registro. */
export function normalizeSpecies(name: string): string | null {
  const s = normalizeKey(name.replace(/\bP\.\s*$/i, ''));
  if (!s) return null;
  if (/brasil+ie?nsis|brasilensis/.test(s)) return 'Triatoma brasiliensis';
  if (/lutzi/.test(s)) return 'Panstrongylus lutzi';
  if (/pseudomaculata/.test(s)) return 'Triatoma pseudomaculata';
  if (/r[h]?odnius/.test(s)) return 'Rhodnius sp.';
  return null;
}

/**
 * Dados dos gráficos de análise. Função pura: o servidor e o painel compartilhável (HTML único)
 * usam exatamente este código, então os números são sempre os mesmos.
 *
 * Regra de filtros cruzados: cada gráfico ignora o filtro da sua própria dimensão
 * (ex.: o gráfico de espécies continua mostrando todas as espécies quando uma está filtrada),
 * para que dê para comparar e trocar a seleção com um clique.
 */
import { select, type Filters, type SnapshotRec } from './engine.js';

export const EXAM_KEYS = ['positivo', 'negativo', 'pendente', 'nao_realizado', 'nao_informado'] as const;
export type ExamKey = (typeof EXAM_KEYS)[number];
export type ExamCounts = Record<ExamKey, number> & { total: number };

const empty = (): ExamCounts => ({ positivo: 0, negativo: 0, pendente: 0, nao_realizado: 0, nao_informado: 0, total: 0 });
const add = (c: ExamCounts, r: SnapshotRec) => {
  c[r.exam_result as ExamKey]++;
  c.total++;
};
const NO_SPECIES = 'Não identificada';
/** maior contagem primeiro; empate por nome; "Não identificada" sempre por último */
const bySpecies = (a: { especie: string; total: number }, b: { especie: string; total: number }) =>
  (a.especie === NO_SPECIES ? 1 : 0) - (b.especie === NO_SPECIES ? 1 : 0) || b.total - a.total || a.especie.localeCompare(b.especie, 'pt-BR');

export interface OrigemTotal { captura: number; pit: number; semOrigem: number; total: number; posCaptura: number; posPit: number; examCaptura: number; examPit: number }
export interface OrigemRow extends OrigemTotal { key: string; name: string }

const emptyOrigem = (): OrigemTotal => ({ captura: 0, pit: 0, semOrigem: 0, total: 0, posCaptura: 0, posPit: 0, examCaptura: 0, examPit: 0 });
function addOrigem(g: OrigemTotal, r: SnapshotRec) {
  g.total++;
  const exam = r.exam_result === 'positivo' || r.exam_result === 'negativo';
  if (r.channel === 'captura') {
    g.captura++;
    if (exam) g.examCaptura++;
    if (r.exam_result === 'positivo') g.posCaptura++;
  } else if (r.channel === 'pit') {
    g.pit++;
    if (exam) g.examPit++;
    if (r.exam_result === 'positivo') g.posPit++;
  } else g.semOrigem++;
}

export interface Analytics {
  resumo: { capturas: number; comResultado: number; positivos: number; negativos: number; positividade: number | null; imoveis: number | null; localidadesComImoveis: number };
  porLocalidade: ({ key: string; name: string; imoveis: number | null; capturasPor100Imoveis: number | null } & ExamCounts)[];
  porEspecie: ({ especie: string } & ExamCounts)[];
  linhaDoTempo: { mes: string; capturas: number; positivos: number; negativos: number; semResultado: number; campanha: number; pit: number; semOrigem: number }[];
  semDataCaptura: number;
  porOrigem: ({ chave: 'captura' | 'pit' | 'nao_informado' } & ExamCounts)[];
  porAmbiente: ({ chave: 'intra' | 'peri' | 'intra_peri' | 'nao_informado' } & ExamCounts)[];
  /** quantos registros têm cada tipo (um registro com mais de um tipo conta em cada um) */
  faseSexo: { categoria: 'Ninfa' | 'Macho' | 'Fêmea' | 'Não informado'; total: number }[];
  /** combinações exatas dentro do mesmo registro (ex.: "Macho e Fêmea", "Ninfa e Macho") */
  faseSexoCombinacoes: { combinacao: string; total: number }[];
  especieAmbiente: { especie: string; intra: number; peri: number; intra_peri: number; nao_informado: number; total: number }[];
  tempoAteResultado: {
    faixas: { faixa: string; total: number }[];
    medianaDias: number | null;
    minDias: number | null;
    maxDias: number | null;
    comAsDuasDatas: number;
    semDataDoExame: number;
  };
  origemComparativo: {
    total: OrigemTotal;
    porLocalidade: OrigemRow[];
    porEspecie: OrigemRow[];
    porAmbiente: OrigemRow[];
  };
  pits: { nome: string; unidade: string | null; zona: string | null; localidade: string | null; localityKey: string | null }[];
}

const captures = (rec: SnapshotRec[], f: Filters) => select(rec, { ...f, layers: undefined, q: f.q }).filter((r) => r.type === 'captura');

/** Quais tipos de inseto o registro tem: ninfa, macho e/ou fêmea (a fase/sexo pode vir combinada, ex.: "Ninfa e Macho"). */
export function stageSexFlags(r: Pick<SnapshotRec, 'stage' | 'sex'>): { ninfa: boolean; macho: boolean; femea: boolean } {
  const stage = (r.stage ?? '').toLowerCase();
  const sex = (r.sex ?? '').toLowerCase();
  return { ninfa: stage.includes('ninfa'), macho: sex.includes('macho'), femea: sex.includes('fêmea') || sex.includes('femea') };
}

export function stageSexCombination(r: Pick<SnapshotRec, 'stage' | 'sex'>): string {
  const f = stageSexFlags(r);
  const parts = [f.ninfa && 'Ninfa', f.macho && 'Macho', f.femea && 'Fêmea'].filter(Boolean) as string[];
  if (parts.length === 0) return 'Não informado';
  if (parts.length === 1) return parts[0]!;
  return parts.length === 2 ? `${parts[0]} e ${parts[1]}` : `${parts[0]}, ${parts[1]} e ${parts[2]}`;
}

export function analytics(rec: SnapshotRec[], f: Filters): Analytics {
  // --- resumo (todos os filtros)
  const all = captures(rec, f);
  const positivos = all.filter((r) => r.exam_result === 'positivo').length;
  const negativos = all.filter((r) => r.exam_result === 'negativo').length;

  // --- por localidade (sem o filtro de localidade)
  const imoveis = new Map<string, number>();
  for (const r of rec) if (r.type === 'localidade' && r.locality_key && r.property_count != null) imoveis.set(r.locality_key, Math.max(imoveis.get(r.locality_key) ?? 0, r.property_count));
  const imoveisFiltrados = [...imoveis].filter(([k]) => !f.locality || k === f.locality);
  const loc = new Map<string, ExamCounts & { name: string }>();
  for (const r of captures(rec, { ...f, locality: undefined })) {
    const k = r.locality_key ?? '';
    const g = loc.get(k) ?? { ...empty(), name: k === '' ? '(sem localidade)' : (r.locality_raw ?? k) };
    add(g, r);
    loc.set(k, g);
  }
  const porLocalidade = [...loc].map(([key, g]) => {
    const im = imoveis.get(key) ?? null;
    return { key, ...g, imoveis: im, capturasPor100Imoveis: im ? Math.round((g.total / im) * 1000) / 10 : null };
  });
  porLocalidade.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'pt-BR'));

  // --- por espécie (sem o filtro de espécie)
  const sp = new Map<string, ExamCounts>();
  for (const r of captures(rec, { ...f, species: undefined })) {
    const k = r.species ?? NO_SPECIES;
    const g = sp.get(k) ?? empty();
    add(g, r);
    sp.set(k, g);
  }
  const porEspecie = [...sp].map(([especie, g]) => ({ especie, ...g })).sort(bySpecies);

  // --- linha do tempo (sem o filtro de período: mostra tudo e o período aparece destacado)
  const months = new Map<string, { capturas: number; positivos: number; negativos: number; semResultado: number; campanha: number; pit: number; semOrigem: number }>();
  let semData = 0;
  for (const r of captures(rec, { ...f, from: undefined, to: undefined })) {
    if (!r.visit_date) {
      semData++;
      continue;
    }
    const m = r.visit_date.slice(0, 7);
    const g = months.get(m) ?? { capturas: 0, positivos: 0, negativos: 0, semResultado: 0, campanha: 0, pit: 0, semOrigem: 0 };
    g.capturas++;
    if (r.channel === 'captura') g.campanha++;
    else if (r.channel === 'pit') g.pit++;
    else g.semOrigem++;
    if (r.exam_result === 'positivo') g.positivos++;
    else if (r.exam_result === 'negativo') g.negativos++;
    else g.semResultado++;
    months.set(m, g);
  }
  const linhaDoTempo = [...months].map(([mes, g]) => ({ mes, ...g })).sort((a, b) => a.mes.localeCompare(b.mes));

  // --- origem e ambiente (cada um sem o próprio filtro)
  const group = <K extends string>(rows: SnapshotRec[], key: (r: SnapshotRec) => K) => {
    const m = new Map<K, ExamCounts>();
    for (const r of rows) {
      const g = m.get(key(r)) ?? empty();
      add(g, r);
      m.set(key(r), g);
    }
    return m;
  };
  const origemOrder = ['captura', 'pit', 'nao_informado'] as const;
  const origem = group(captures(rec, { ...f, channel: undefined }), (r) => (r.channel ?? 'nao_informado') as (typeof origemOrder)[number]);
  const ambienteOrder = ['intra', 'peri', 'intra_peri', 'nao_informado'] as const;
  const ambiente = group(captures(rec, { ...f, environment: undefined }), (r) => (r.environment ?? 'nao_informado') as (typeof ambienteOrder)[number]);

  // --- fase/sexo: presença de cada tipo e combinações exatas
  const presence = { Ninfa: 0, Macho: 0, 'Fêmea': 0, 'Não informado': 0 };
  const combos = new Map<string, number>();
  for (const r of all) {
    const f = stageSexFlags(r);
    if (f.ninfa) presence.Ninfa++;
    if (f.macho) presence.Macho++;
    if (f.femea) presence['Fêmea']++;
    if (!f.ninfa && !f.macho && !f.femea) presence['Não informado']++;
    const c = stageSexCombination(r);
    combos.set(c, (combos.get(c) ?? 0) + 1);
  }
  const faseSexo = (['Fêmea', 'Macho', 'Ninfa', 'Não informado'] as const).map((categoria) => ({ categoria, total: presence[categoria] }));
  const faseSexoCombinacoes = [...combos].map(([combinacao, total]) => ({ combinacao, total })).sort((a, b) => b.total - a.total || a.combinacao.localeCompare(b.combinacao, 'pt-BR'));

  // --- espécie × ambiente
  const se = new Map<string, { intra: number; peri: number; intra_peri: number; nao_informado: number; total: number }>();
  for (const r of all) {
    const k = r.species ?? NO_SPECIES;
    const g = se.get(k) ?? { intra: 0, peri: 0, intra_peri: 0, nao_informado: 0, total: 0 };
    g[(r.environment ?? 'nao_informado') as 'intra' | 'peri' | 'intra_peri' | 'nao_informado']++;
    g.total++;
    se.set(k, g);
  }
  const especieAmbiente = [...se].map(([especie, g]) => ({ especie, ...g })).sort(bySpecies);

  // --- tempo entre a captura e o resultado do exame
  const days: number[] = [];
  let semDataExame = 0;
  for (const r of all) {
    if (!r.exam_date) {
      semDataExame++;
      continue;
    }
    if (!r.visit_date) continue;
    days.push(Math.round((Date.parse(r.exam_date) - Date.parse(r.visit_date)) / 86_400_000));
  }
  days.sort((a, b) => a - b);
  const bins: [string, (d: number) => boolean][] = [
    ['Exame antes da captura (conferir)', (d) => d < 0],
    ['0 a 7 dias', (d) => d >= 0 && d <= 7],
    ['8 a 14 dias', (d) => d >= 8 && d <= 14],
    ['15 a 21 dias', (d) => d >= 15 && d <= 21],
    ['22 a 28 dias', (d) => d >= 22 && d <= 28],
    ['29 a 35 dias', (d) => d >= 29 && d <= 35],
    ['Mais de 35 dias', (d) => d > 35],
  ];
  const mid = days.length ? (days.length % 2 ? days[(days.length - 1) / 2]! : (days[days.length / 2 - 1]! + days[days.length / 2]!) / 2) : null;

  // --- PITs (nome da unidade, zona e localidade; sem endereço)
  const pits = rec
    .filter((r) => r.type === 'pit' && (!f.locality || r.locality_key === f.locality))
    .map((r) => ({ nome: r.name ?? '(sem nome)', unidade: r.pit_ref ?? null, zona: r.zone ?? null, localidade: r.locality_raw, localityKey: r.locality_key }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { numeric: true }));

  // --- campanha × PIT (demanda): cada visão ignora o filtro de origem e o da própria dimensão
  const origemPor = (g: Filters, key: (r: SnapshotRec) => [string, string]): OrigemRow[] => {
    const m = new Map<string, OrigemRow>();
    for (const r of captures(rec, { ...g, channel: undefined })) {
      const [k, name] = key(r);
      const row = m.get(k) ?? { ...emptyOrigem(), key: k, name };
      addOrigem(row, r);
      m.set(k, row);
    }
    return [...m.values()].sort((x, y) => y.total - x.total || x.name.localeCompare(y.name, 'pt-BR'));
  };
  const origemTotal = emptyOrigem();
  for (const r of captures(rec, { ...f, channel: undefined })) addOrigem(origemTotal, r);
  const ENV_NAME: Record<string, string> = { intra: 'Intradomicílio', peri: 'Peridomicílio', intra_peri: 'Intra e peridomicílio', nao_informado: 'Não informado' };

  return {
    resumo: {
      capturas: all.length,
      comResultado: positivos + negativos,
      positivos,
      negativos,
      positividade: positivos + negativos > 0 ? Math.round((positivos / (positivos + negativos)) * 1000) / 10 : null,
      imoveis: imoveisFiltrados.length ? imoveisFiltrados.reduce((a, [, v]) => a + v, 0) : null,
      localidadesComImoveis: imoveisFiltrados.length,
    },
    porLocalidade,
    porEspecie,
    linhaDoTempo,
    semDataCaptura: semData,
    porOrigem: origemOrder.filter((k) => origem.has(k)).map((chave) => ({ chave, ...origem.get(chave)! })),
    porAmbiente: ambienteOrder.filter((k) => ambiente.has(k)).map((chave) => ({ chave, ...ambiente.get(chave)! })),
    faseSexo,
    faseSexoCombinacoes,
    especieAmbiente,
    tempoAteResultado: {
      faixas: bins.map(([faixa, fn]) => ({ faixa, total: days.filter(fn).length })),
      medianaDias: mid,
      minDias: days[0] ?? null,
      maxDias: days[days.length - 1] ?? null,
      comAsDuasDatas: days.length,
      semDataDoExame: semDataExame,
    },
    origemComparativo: {
      total: origemTotal,
      porLocalidade: origemPor({ ...f, locality: undefined }, (r) => [r.locality_key ?? '', r.locality_key ? (r.locality_raw ?? r.locality_key) : '(sem localidade)']),
      porEspecie: origemPor({ ...f, species: undefined }, (r) => [r.species ?? NO_SPECIES, r.species ?? NO_SPECIES]),
      porAmbiente: origemPor({ ...f, environment: undefined }, (r) => [r.environment ?? 'nao_informado', ENV_NAME[r.environment ?? 'nao_informado']!]),
    },
    pits,
  };
}

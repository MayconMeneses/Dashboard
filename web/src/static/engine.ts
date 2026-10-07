/**
 * Motor de consultas em memória usado pelo painel compartilhável (um único arquivo HTML, sem servidor).
 * Espelha as consultas do servidor (server/src/services/queries.ts); há um teste de paridade no servidor.
 */
export interface SnapshotRec {
  rid: string;
  origin: 'arquivo' | 'manual';
  type: string;
  name: string | null;
  locality_key: string | null;
  locality_raw: string | null;
  visit_date: string | null;
  exam_date: string | null;
  search_result: string;
  exam_result: string;
  triatomine_count: number | null;
  stage: string | null;
  sex: string | null;
  species: string | null;
  lat: number | null;
  lng: number | null;
  channel: string | null;
  environment: string | null;
  geometry: { type: string; coordinates: unknown } | null;
  is_boundary: boolean;
  duplicate_of: number | null;
}

export interface Snapshot {
  formato: 1;
  geradoEm: string;
  arquivo: string;
  arquivoSha256?: string;
  ativadoEm: string;
  /** contagem por tipo de TUDO o que foi lido do arquivo (antes de excluir duplicatas) */
  byType: Record<string, number>;
  seenFields: Record<string, boolean>;
  rec: SnapshotRec[];
  boundary: { geojson: unknown; source: string } | null;
  sobre: {
    registrosLidos: number;
    duplicatasExcluidas: number;
    avisos: { codigo: string; mensagem: string; quantidade: number }[];
    camposDescartados: string[];
    camposRestritosRemovidos: string[];
  };
}

interface Filters {
  from?: string;
  to?: string;
  locality?: string;
  layers?: string[];
  search?: string[];
  exam?: string[];
  channel?: string[];
  species?: string[];
  q?: string;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const TYPES = ['localidade', 'visita', 'captura', 'pit', 'area', 'rota', 'outro'];
const SEARCH = ['com_captura', 'sem_captura', 'nao_informado'];
const EXAM = ['positivo', 'negativo', 'pendente', 'nao_realizado', 'nao_informado'];
const list = (v: string | null): string[] | undefined => (v ? v.split(',').filter(Boolean) : undefined);

export function parseFilters(p: URLSearchParams): Filters {
  const f: Filters = {};
  const from = p.get('from');
  const to = p.get('to');
  if (from && ISO.test(from)) f.from = from;
  if (to && ISO.test(to)) f.to = to;
  if (p.get('locality')) f.locality = p.get('locality')!;
  f.layers = list(p.get('layers'))?.filter((x) => TYPES.includes(x));
  f.search = list(p.get('search'))?.filter((x) => SEARCH.includes(x));
  f.exam = list(p.get('exam'))?.filter((x) => EXAM.includes(x));
  f.channel = list(p.get('channel'))?.filter((x) => ['captura', 'pit'].includes(x));
  f.species = list(p.get('species'))?.filter((x) => x.length <= 60).slice(0, 20);
  const q = p.get('q');
  if (q && q.trim()) f.q = q.trim().slice(0, 80);
  return f;
}

function select(rec: SnapshotRec[], f: Filters, opts: { skipLocality?: boolean } = {}): SnapshotRec[] {
  const q = f.q ? f.q.replace(/[%_]/g, '').toLowerCase() : null;
  return rec.filter((r) => {
    if (f.from && !(r.visit_date !== null && r.visit_date >= f.from)) return false;
    if (f.to && !(r.visit_date !== null && r.visit_date <= f.to)) return false;
    if (f.locality && !opts.skipLocality && r.locality_key !== f.locality) return false;
    if (f.layers?.length && !f.layers.includes(r.type)) return false;
    if (f.search?.length && !f.search.includes(r.search_result)) return false;
    if (f.exam?.length && !f.exam.includes(r.exam_result)) return false;
    if (f.channel?.length && !(r.channel !== null && f.channel.includes(r.channel))) return false;
    if (f.species?.length && !(r.species !== null && f.species.includes(r.species))) return false;
    if (q && ![r.name, r.locality_raw, r.species].some((v) => v !== null && v.toLowerCase().includes(q))) return false;
    return true;
  });
}

export interface Kpi {
  value: number | null;
  status: 'confirmado' | 'ausente';
  note: string;
  unit: string;
}

export function summary(s: Snapshot, f: Filters) {
  const rows = select(s.rec, f);
  const has = (t: string) => (s.byType[t] ?? 0) > 0;
  const seen = s.seenFields;
  const loc = new Set(rows.filter((r) => r.locality_key).map((r) => r.locality_key));
  const count = (fn: (r: SnapshotRec) => boolean) => rows.filter(fn).length;
  const kpi = (value: number, confirmed: boolean, unit: string, absentNote: string, okNote = ''): Kpi =>
    confirmed ? { value, status: 'confirmado', note: okNote, unit } : { value: null, status: 'ausente', note: absentNote, unit };
  const cap = rows.filter((r) => r.type === 'captura');
  const withQty = cap.filter((r) => r.triatomine_count !== null);
  const examNote = 'O arquivo não traz o resultado do exame; o dado não está disponível (não é zero).';
  const examCount = (v: string[]) => cap.filter((r) => v.includes(r.exam_result)).length;
  return {
    versao: { id: 1, numero: 1, arquivo: s.arquivo, ativadoEm: s.ativadoEm },
    kpis: {
      localidades: kpi(loc.size, loc.size > 0 || has('localidade'), 'localidades', 'Nenhuma localidade identificada.'),
      visitas: kpi(count((r) => r.type === 'visita'), has('visita'), 'visitas', 'Nenhuma visita registrada no arquivo nem manualmente.'),
      comCaptura: kpi(count((r) => r.search_result === 'com_captura'), has('captura') || has('visita'), 'registros', 'Sem registros de captura ou visita.'),
      semCaptura: kpi(
        count((r) => r.search_result === 'sem_captura'),
        !!seen.resultado_busca,
        'buscas',
        'O arquivo não informa buscas sem captura. A ausência de ponto não significa busca negativa; registre visitas sem captura manualmente.',
      ),
      examePositivo: kpi(examCount(['positivo']), !!seen.resultado_exame, 'registros de captura', examNote),
      exameNegativo: kpi(examCount(['negativo']), !!seen.resultado_exame, 'registros de captura', examNote),
      examePendente: kpi(examCount(['pendente', 'nao_realizado']), !!seen.resultado_exame, 'registros de captura', examNote),
      exameNaoInformado: kpi(examCount(['nao_informado']), has('captura'), 'registros de captura', 'Sem registros de captura.'),
      pits: kpi(count((r) => r.type === 'pit'), has('pit'), 'PITs', 'O arquivo não contém PITs.'),
      triatomineos: kpi(
        withQty.reduce((a, r) => a + (r.triatomine_count ?? 0), 0),
        withQty.length > 0,
        'triatomíneos',
        'O arquivo não informa a quantidade de triatomíneos.',
        cap.length > withQty.length ? `${cap.length - withQty.length} registro(s) sem quantidade informada não entram na soma.` : '',
      ),
    },
  };
}

const BUSCA_CATS = [
  { key: 'com_captura', label: 'Com captura' },
  { key: 'sem_captura', label: 'Sem captura' },
  { key: 'nao_informado', label: 'Não informado' },
];
const EXAME_CATS = [
  { key: 'positivo', label: 'Positivo' },
  { key: 'negativo', label: 'Negativo' },
  { key: 'pendente', label: 'Pendente' },
  { key: 'nao_realizado', label: 'Não realizado' },
  { key: 'nao_informado', label: 'Não informado' },
];

export function chart(s: Snapshot, f: Filters, mode: 'busca' | 'exame', sort: 'nome' | 'total', hideEmpty: boolean) {
  const cats = mode === 'busca' ? BUSCA_CATS : EXAME_CATS;
  const types = mode === 'busca' ? ['captura', 'visita'] : ['captura'];
  const rows = select(s.rec, { ...f, layers: undefined }, { skipLocality: true }).filter((r) => types.includes(r.type));
  const names = new Map<string, string>();
  for (const r of s.rec) if (r.locality_key && ['localidade', 'captura', 'visita', 'pit'].includes(r.type) && r.locality_raw && !names.has(r.locality_key)) names.set(r.locality_key, r.locality_raw);
  const data = new Map<string, Record<string, number>>();
  const ensure = (k: string) => data.get(k) ?? (data.set(k, {}), data.get(k)!);
  if (!hideEmpty) for (const k of names.keys()) ensure(k);
  for (const r of rows) {
    const k = r.locality_key ?? '';
    const cat = mode === 'busca' ? r.search_result : r.exam_result;
    const rec = ensure(k);
    rec[cat] = (rec[cat] ?? 0) + 1;
    if (k && r.locality_raw && !names.has(k)) names.set(k, r.locality_raw);
  }
  const total = (k: string) => Object.values(data.get(k)!).reduce((a, b) => a + b, 0);
  const nm = (k: string) => names.get(k) ?? '';
  const keys = [...data.keys()].sort(
    sort === 'total' ? (a, b) => total(b) - total(a) || nm(a).localeCompare(nm(b), 'pt-BR') : (a, b) => (names.get(a) ?? 'zzz').localeCompare(names.get(b) ?? 'zzz', 'pt-BR'),
  );
  return {
    mode,
    unit: mode === 'busca' ? 'registros (capturas e visitas)' : 'registros de captura',
    note:
      mode === 'busca'
        ? 'Resultado da busca no imóvel/visita. "Sem captura" só aparece quando informado no arquivo ou registrado manualmente.'
        : 'Resultado do exame dos triatomíneos capturados. Não é o mesmo que o resultado da busca.',
    localities: keys.map((k) => ({ key: k, name: k === '' ? '(sem localidade)' : (names.get(k) ?? k) })),
    series: cats.map((c) => ({ key: c.key, label: c.label, data: keys.map((k) => data.get(k)![c.key] ?? 0) })),
  };
}

export function localities(s: Snapshot, f: Filters) {
  const rows = select(s.rec, { ...f, locality: undefined, layers: undefined, q: undefined }).filter((r) => r.locality_key !== null);
  const by = new Map<string, { key: string; name: string; registros: number; capturas: number; visitas: number; positivos: number; negativos: number }>();
  for (const r of rows) {
    const g = by.get(r.locality_key!) ?? { key: r.locality_key!, name: r.locality_raw ?? r.locality_key!, registros: 0, capturas: 0, visitas: 0, positivos: 0, negativos: 0 };
    g.registros++;
    if (r.type === 'captura') {
      g.capturas++;
      if (r.exam_result === 'positivo') g.positivos++;
      if (r.exam_result === 'negativo') g.negativos++;
    }
    if (r.type === 'visita') g.visitas++;
    if (r.locality_raw && r.locality_raw < g.name) g.name = r.locality_raw;
    by.set(r.locality_key!, g);
  }
  return [...by.values()].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase(), 'pt-BR'));
}

const GEO_TYPES = ['localidade', 'area', 'rota'];

export function mapFeatures(s: Snapshot, f: Filters) {
  // Áreas, localidades e rotas fazem parte do desenho do mapa: só a escolha de camadas as afeta.
  const geo = s.rec.filter((r) => GEO_TYPES.includes(r.type) && (!f.layers?.length || f.layers.includes(r.type)));
  const points = select(s.rec, { ...f, locality: undefined, q: undefined }).filter((r) => !GEO_TYPES.includes(r.type));
  const rows = [...geo, ...points].slice(0, 20000);
  const features = [];
  for (const r of rows) {
    const geometry = r.geometry ?? (r.lat != null && r.lng != null ? { type: 'Point', coordinates: [r.lng, r.lat] } : null);
    if (!geometry) continue;
    features.push({
      type: 'Feature',
      geometry,
      properties: {
        rid: r.rid, origin: r.origin, type: r.type, name: r.name, locality_key: r.locality_key, locality_raw: r.locality_raw, visit_date: r.visit_date,
        search_result: r.search_result, exam_result: r.exam_result, triatomine_count: r.triatomine_count, species: r.species, channel: r.channel, environment: r.environment, is_boundary: !!r.is_boundary,
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

export function facets(s: Snapshot) {
  const by = new Map<string, number>();
  for (const r of s.rec) if (r.type === 'captura' && r.species) by.set(r.species, (by.get(r.species) ?? 0) + 1);
  return { species: [...by].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)) };
}

const SORTABLE = new Set(['channel', 'environment', 'type', 'name', 'locality_raw', 'visit_date', 'search_result', 'exam_result', 'triatomine_count', 'species', 'origin']);

export function records(s: Snapshot, f: Filters, o: { page: number; pageSize: number; sort?: string; dir?: string }) {
  const base: Filters = { ...f, layers: f.layers?.length ? f.layers : ['captura', 'visita', 'pit'] };
  const rows = select(s.rec, base);
  const sort = (o.sort && SORTABLE.has(o.sort) ? o.sort : 'visit_date') as keyof SnapshotRec;
  const sign = o.dir === 'asc' ? 1 : -1;
  const sorted = [...rows].sort((a, b) => {
    const x = a[sort] as string | number | null;
    const y = b[sort] as string | number | null;
    if ((x === null) !== (y === null)) return x === null ? 1 : -1; // nulos sempre por último
    if (x !== null && y !== null && x !== y) return (x < y ? -1 : 1) * sign;
    return a.rid < b.rid ? -1 : a.rid > b.rid ? 1 : 0;
  });
  const start = (o.page - 1) * o.pageSize;
  return {
    total: rows.length,
    page: o.page,
    pageSize: o.pageSize,
    rows: sorted.slice(start, start + o.pageSize).map((r) => ({
      rid: r.rid, origin: r.origin, type: r.type, name: r.name, locality_raw: r.locality_raw, visit_date: r.visit_date, exam_date: r.exam_date,
      search_result: r.search_result, exam_result: r.exam_result, triatomine_count: r.triatomine_count, stage: r.stage, sex: r.sex, species: r.species,
      property_ref: null, pit_ref: null, channel: r.channel, environment: r.environment, lat: r.lat, lng: r.lng, duplicate_of: r.duplicate_of, notes: null,
    })),
  };
}

/** Atende as mesmas URLs `/api/...` que o painel usa quando está ligado ao servidor. */
export function handle(s: Snapshot, url: string): unknown {
  const u = new URL(url, 'http://local');
  const p = u.searchParams;
  const f = parseFilters(p);
  switch (u.pathname) {
    case '/api/summary':
      return summary(s, f);
    case '/api/chart':
      return chart(s, f, p.get('mode') === 'exame' ? 'exame' : 'busca', p.get('sort') === 'total' ? 'total' : 'nome', p.get('hideEmpty') === 'true');
    case '/api/facets':
      return facets(s);
    case '/api/localities':
      return localities(s, f);
    case '/api/map':
      return mapFeatures(s, f);
    case '/api/records':
      return records(s, f, { page: Math.max(Number(p.get('page')) || 1, 1), pageSize: Math.min(Math.max(Number(p.get('pageSize')) || 25, 1), 100), sort: p.get('sort') ?? undefined, dir: p.get('dir') ?? undefined });
    case '/api/boundary':
      return s.boundary ? { geojson: s.boundary.geojson, source: s.boundary.source } : { geojson: null, source: null };
    case '/api/imports':
      return [];
    default:
      throw new Error(`Rota não disponível no painel compartilhado: ${u.pathname}`);
  }
}

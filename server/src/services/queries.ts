import type { Db } from '../db.js';
import type { ParseReport } from '../parsing/index.js';
import { getActiveImport } from './importer.js';

export interface Filters {
  from?: string;
  to?: string;
  locality?: string;
  layers?: string[];
  search?: string[];
  exam?: string[];
  channel?: string[];
  q?: string;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const TYPES = ['localidade', 'visita', 'captura', 'pit', 'area', 'rota', 'outro'];
const SEARCH = ['com_captura', 'sem_captura', 'nao_informado'];
const EXAM = ['positivo', 'negativo', 'pendente', 'nao_realizado', 'nao_informado'];

const list = (v: unknown): string[] | undefined => (typeof v === 'string' && v ? v.split(',').filter(Boolean) : undefined);

export function parseFilters(query: Record<string, unknown>): Filters {
  const f: Filters = {};
  if (typeof query.from === 'string' && ISO.test(query.from)) f.from = query.from;
  if (typeof query.to === 'string' && ISO.test(query.to)) f.to = query.to;
  if (typeof query.locality === 'string' && query.locality) f.locality = query.locality;
  f.layers = list(query.layers)?.filter((x) => TYPES.includes(x));
  f.search = list(query.search)?.filter((x) => SEARCH.includes(x));
  f.exam = list(query.exam)?.filter((x) => EXAM.includes(x));
  f.channel = list(query.channel)?.filter((x) => ['captura', 'pit'].includes(x));
  if (typeof query.q === 'string' && query.q.trim()) f.q = query.q.trim().slice(0, 80);
  return f;
}

/** Visão unificada: registros do arquivo ativo + visitas manuais. */
function recSql(activeId: number | null): string {
  const file = activeId
    ? `SELECT 'f' || id AS rid, 'arquivo' AS origin, type, name, locality_key, locality_raw, visit_date, exam_date, search_result, exam_result,
        triatomine_count, stage, sex, species, lat, lng, property_ref, pit_ref, channel, environment, address, geometry, is_boundary, duplicate_of, NULL AS notes
       FROM features WHERE import_id = ${activeId} AND excluded = 0 UNION ALL `
    : '';
  const manual = `SELECT 'm' || id AS rid, 'manual' AS origin, 'visita' AS type, NULL AS name, locality_key, locality_raw, visit_date, NULL AS exam_date, search_result, 'nao_informado' AS exam_result,
        NULL AS triatomine_count, NULL AS stage, NULL AS sex, NULL AS species, lat, lng, NULL AS property_ref, NULL AS pit_ref, NULL AS channel, NULL AS environment, NULL AS address, NULL AS geometry, 0 AS is_boundary, NULL AS duplicate_of, notes
       FROM manual_visits WHERE voided_at IS NULL`;
  return `WITH rec AS (${file}${manual})`;
}

function where(f: Filters, params: (string | number)[], opts: { skipLocality?: boolean } = {}): string {
  const w: string[] = [];
  const add = (cond: string, ...vals: (string | number)[]) => {
    w.push(cond);
    params.push(...vals);
  };
  if (f.from) add('visit_date >= ?', f.from);
  if (f.to) add('visit_date <= ?', f.to);
  if (f.locality && !opts.skipLocality) add('locality_key = ?', f.locality);
  const inList = (col: string, vals?: string[]) => {
    if (vals?.length) add(`${col} IN (${vals.map(() => '?').join(',')})`, ...vals);
  };
  inList('type', f.layers);
  inList('search_result', f.search);
  inList('exam_result', f.exam);
  inList('channel', f.channel);
  if (f.q) {
    w.push("(name LIKE ? OR locality_raw LIKE ? OR species LIKE ? OR property_ref LIKE ?)");
    const like = `%${f.q.replace(/[%_]/g, '')}%`;
    params.push(like, like, like, like);
  }
  return w.length ? ` WHERE ${w.join(' AND ')}` : '';
}

function ctx(db: Db) {
  const active = getActiveImport(db);
  const report = active?.report_json ? (JSON.parse(active.report_json) as ParseReport) : null;
  const hasManual = ((db.prepare('SELECT COUNT(*) AS n FROM manual_visits WHERE voided_at IS NULL').get() as { n: number }).n ?? 0) > 0;
  return { active, report, hasManual, sql: recSql(active?.id ?? null) };
}

export interface Kpi {
  value: number | null;
  status: 'confirmado' | 'ausente';
  note: string;
  unit: string;
}

export function getSummary(db: Db, f: Filters) {
  const { active, report, hasManual, sql } = ctx(db);
  const params: (string | number)[] = [];
  const w = where(f, params);
  const rows = db.prepare(`${sql} SELECT type, search_result, exam_result, origin, triatomine_count, locality_key FROM rec${w}`).all(...params) as {
    type: string; search_result: string; exam_result: string; origin: string; triatomine_count: number | null; locality_key: string | null;
  }[];
  const byType = report?.counts.byType;
  const has = (t: 'visita' | 'captura' | 'pit' | 'localidade') => (byType ? byType[t] > 0 : false);
  const seen = report?.seenFields;

  const loc = new Set(rows.filter((r) => r.locality_key).map((r) => r.locality_key));
  const count = (fn: (r: (typeof rows)[number]) => boolean) => rows.filter(fn).length;
  const kpi = (value: number, confirmed: boolean, unit: string, absentNote: string, okNote = ''): Kpi =>
    confirmed ? { value, status: 'confirmado', note: okNote, unit } : { value: null, status: 'ausente', note: absentNote, unit };

  const captureRows = rows.filter((r) => r.type === 'captura');
  const withQty = captureRows.filter((r) => r.triatomine_count !== null);
  const examFieldPresent = !!seen?.resultado_exame;
  const examNote = 'O arquivo não traz o resultado do exame; o dado não está disponível (não é zero).';
  const examCount = (v: string[]) => captureRows.filter((r) => v.includes(r.exam_result)).length;

  return {
    versao: active
      ? { id: active.id, numero: active.version, arquivo: active.filename, ativadoEm: active.activated_at }
      : null,
    kpis: {
      localidades: kpi(loc.size, loc.size > 0 || has('localidade'), 'localidades', 'Nenhuma localidade identificada.'),
      visitas: kpi(count((r) => r.type === 'visita'), has('visita') || hasManual, 'visitas', 'Nenhuma visita registrada no arquivo nem manualmente.'),
      comCaptura: kpi(count((r) => r.search_result === 'com_captura'), has('captura') || has('visita') || hasManual, 'registros', 'Sem registros de captura ou visita.'),
      semCaptura: kpi(
        count((r) => r.search_result === 'sem_captura'),
        !!seen?.resultado_busca || hasManual,
        'buscas',
        'O arquivo não informa buscas sem captura. A ausência de ponto não significa busca negativa; registre visitas sem captura manualmente.',
      ),
      examePositivo: kpi(examCount(['positivo']), examFieldPresent, 'registros de captura', examNote),
      exameNegativo: kpi(examCount(['negativo']), examFieldPresent, 'registros de captura', examNote),
      examePendente: kpi(examCount(['pendente', 'nao_realizado']), examFieldPresent, 'registros de captura', examNote),
      exameNaoInformado: kpi(examCount(['nao_informado']), has('captura'), 'registros de captura', 'Sem registros de captura.'),
      pits: kpi(count((r) => r.type === 'pit'), has('pit'), 'PITs', 'O arquivo não contém PITs.'),
      triatomineos: kpi(
        withQty.reduce((a, r) => a + (r.triatomine_count ?? 0), 0),
        withQty.length > 0,
        'triatomíneos',
        'O arquivo não informa a quantidade de triatomíneos.',
        captureRows.length > withQty.length ? `${captureRows.length - withQty.length} registro(s) sem quantidade informada não entram na soma.` : '',
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

export function getChart(db: Db, f: Filters, mode: 'busca' | 'exame', sort: 'nome' | 'total', hideEmpty: boolean) {
  const { sql } = ctx(db);
  const cats = mode === 'busca' ? BUSCA_CATS : EXAME_CATS;
  const col = mode === 'busca' ? 'search_result' : 'exam_result';
  const types = mode === 'busca' ? ['captura', 'visita'] : ['captura'];
  const params: (string | number)[] = [];
  // O filtro de localidade não reduz o eixo: o clique no gráfico escolhe a localidade e os demais painéis a seguem.
  const w = where({ ...f, layers: undefined }, params, { skipLocality: true });
  const typeCond = `type IN (${types.map(() => '?').join(',')})`;
  const full = w ? `${w} AND ${typeCond}` : ` WHERE ${typeCond}`;
  const rows = db.prepare(`${sql} SELECT COALESCE(locality_key, '') AS k, MIN(locality_raw) AS name, ${col} AS cat, COUNT(*) AS n FROM rec${full} GROUP BY 1, 3`).all(...params, ...types) as {
    k: string; name: string | null; cat: string; n: number;
  }[];
  const known = db.prepare(`${sql} SELECT DISTINCT locality_key AS k, locality_raw AS name FROM rec WHERE locality_key IS NOT NULL AND type = 'localidade' OR (locality_key IS NOT NULL AND type IN ('captura','visita','pit'))`).all() as { k: string; name: string }[];

  const names = new Map<string, string>();
  for (const k of known) if (!names.has(k.k)) names.set(k.k, k.name);
  for (const r of rows) if (r.k && r.name && !names.has(r.k)) names.set(r.k, r.name);
  const data = new Map<string, Record<string, number>>();
  const ensure = (k: string) => data.get(k) ?? (data.set(k, {}), data.get(k)!);
  if (!hideEmpty) for (const k of names.keys()) ensure(k);
  for (const r of rows) ensure(r.k)[r.cat] = r.n;
  let keys = [...data.keys()];
  const total = (k: string) => Object.values(data.get(k)!).reduce((a, b) => a + b, 0);
  keys = keys.sort(sort === 'total' ? (a, b) => total(b) - total(a) || (names.get(a) ?? '').localeCompare(names.get(b) ?? '', 'pt-BR') : (a, b) => (names.get(a) ?? 'zzz').localeCompare(names.get(b) ?? 'zzz', 'pt-BR'));
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

export function getLocalities(db: Db, f: Filters = {}) {
  const { sql } = ctx(db);
  const params: (string | number)[] = [];
  // O filtro de localidade não se aplica aqui: a lista serve para escolher a localidade.
  const w = where({ ...f, locality: undefined, layers: undefined, q: undefined }, params);
  const full = w ? `${w} AND locality_key IS NOT NULL` : ' WHERE locality_key IS NOT NULL';
  return db
    .prepare(
      `${sql} SELECT locality_key AS key, MIN(locality_raw) AS name, COUNT(*) AS registros,
        SUM(type = 'captura') AS capturas, SUM(type = 'visita') AS visitas,
        SUM(type = 'captura' AND exam_result = 'positivo') AS positivos,
        SUM(type = 'captura' AND exam_result = 'negativo') AS negativos
       FROM rec${full} GROUP BY locality_key ORDER BY name COLLATE NOCASE`,
    )
    .all();
}

export function getMapFeatures(db: Db, f: Filters) {
  const { sql } = ctx(db);
  const params: (string | number)[] = [];
  // Camadas geométricas (localidade/área/rota) aparecem sempre que a camada estiver ligada; filtros de data/resultado só se aplicam aos registros.
  const w = where({ ...f, locality: undefined, q: undefined }, params);
  const rows = db
    .prepare(`${sql} SELECT rid, origin, type, name, locality_key, locality_raw, visit_date, search_result, exam_result, triatomine_count, species, channel, environment, lat, lng, geometry, is_boundary FROM rec${w} LIMIT 20000`)
    .all(...params) as Record<string, unknown>[];
  const features = [];
  for (const r of rows) {
    let geometry: unknown = r.geometry ? JSON.parse(r.geometry as string) : null;
    if (!geometry && r.lat != null && r.lng != null) geometry = { type: 'Point', coordinates: [r.lng, r.lat] };
    if (!geometry) continue;
    const props = { ...r };
    delete props.geometry;
    delete props.lat;
    delete props.lng;
    features.push({ type: 'Feature', geometry, properties: { ...props, is_boundary: !!props.is_boundary } });
  }
  return { type: 'FeatureCollection', features };
}

const SORTABLE = new Set(['channel', 'environment', 'type', 'name', 'locality_raw', 'visit_date', 'search_result', 'exam_result', 'triatomine_count', 'species', 'origin']);

export function getRecords(db: Db, f: Filters, opts: { page: number; pageSize: number; sort?: string; dir?: string; includeAddress: boolean }) {
  const { sql } = ctx(db);
  const params: (string | number)[] = [];
  const base: Filters = { ...f, layers: f.layers?.length ? f.layers : ['captura', 'visita', 'pit'] };
  const w = where(base, params);
  const total = (db.prepare(`${sql} SELECT COUNT(*) AS n FROM rec${w}`).get(...params) as { n: number }).n;
  const sort = opts.sort && SORTABLE.has(opts.sort) ? opts.sort : 'visit_date';
  const dir = opts.dir === 'asc' ? 'ASC' : 'DESC';
  const cols = `rid, origin, type, name, locality_raw, visit_date, exam_date, search_result, exam_result, triatomine_count, stage, sex, species, property_ref, pit_ref, channel, environment, lat, lng, duplicate_of, notes${opts.includeAddress ? ', address' : ''}`;
  const rows = db
    .prepare(`${sql} SELECT ${cols} FROM rec${w} ORDER BY ${sort} IS NULL, ${sort} ${dir}, rid LIMIT ? OFFSET ?`)
    .all(...params, opts.pageSize, (opts.page - 1) * opts.pageSize);
  return { total, page: opts.page, pageSize: opts.pageSize, rows };
}

export function getAllRecordsForExport(db: Db, f: Filters, includeAddress: boolean) {
  return getRecords(db, f, { page: 1, pageSize: 100000, sort: 'locality_raw', dir: 'asc', includeAddress }).rows as Record<string, unknown>[];
}

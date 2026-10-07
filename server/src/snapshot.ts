import { createHash } from 'node:crypto';
import { parseKmlOrKmz } from './parsing/index.js';
import type { FieldMapping, NormalizedFeature } from './parsing/index.js';
import type { Snapshot, SnapshotRec } from '../../web/src/static/engine.js';

export type { Snapshot } from '../../web/src/static/engine.js';

export interface SnapshotOptions {
  mapping?: FieldMapping;
  /** exclui as cópias detectadas. Padrão: só quando todas as cópias estão em outras pastas (ex.: Resultados/Positivos/Negativos). */
  excludeRepeats?: boolean;
  /** casas decimais das coordenadas (5 ≈ 1 m) */
  precision?: number;
  boundary?: { geojson: unknown; source: string } | null;
  mapas?: { brasil: unknown; ceara: unknown };
  now?: Date;
}

const round = (n: number, p: number) => Math.round(n * 10 ** p) / 10 ** p;

function roundGeometry(g: NonNullable<NormalizedFeature['geometry']>, p: number) {
  const pt = (c: [number, number]): [number, number] => [round(c[0], p), round(c[1], p)];
  if (g.type === 'Point') return { type: 'Point', coordinates: pt(g.coordinates) };
  if (g.type === 'LineString') return { type: 'LineString', coordinates: g.coordinates.map(pt) };
  return { type: 'Polygon', coordinates: g.coordinates.map((ring) => ring.map(pt)) };
}

/**
 * Gera o conjunto de dados do painel compartilhável. Remove o que é restrito:
 * endereço, número do imóvel/residência, identificador de origem (etiqueta) e os valores brutos do arquivo.
 */
export function buildSnapshot(bytes: Uint8Array, filename: string, opts: SnapshotOptions = {}): Snapshot {
  const { features, report } = parseKmlOrKmz(bytes, opts.mapping ?? {});
  const precision = opts.precision ?? 5;
  const allCross = report.duplicates.length > 0 && report.duplicates.every((d) => d.crossFolder);
  const exclude = opts.excludeRepeats ?? allCross;
  const kept = features.map((f, i) => ({ f, i })).filter(({ f }) => !(exclude && f.duplicateOf !== null));

  const rec: SnapshotRec[] = kept.map(({ f, i }) => ({
    rid: `f${i + 1}`,
    origin: 'arquivo',
    type: f.type,
    name: f.name || null,
    locality_key: f.localityKey,
    locality_raw: f.localityRaw,
    visit_date: f.visitDate,
    exam_date: f.examDate,
    search_result: f.searchResult,
    exam_result: f.examResult,
    triatomine_count: f.triatomineCount,
    stage: f.stage,
    sex: f.sex,
    species: f.species,
    lat: f.lat === null ? null : round(f.lat, precision),
    lng: f.lng === null ? null : round(f.lng, precision),
    channel: f.channel,
    environment: f.environment,
    property_count: f.propertyCount,
    zone: f.zone,
    pit_ref: f.type === 'pit' ? f.pitRef : null, // nome da unidade do PIT (não é endereço)
    geometry: f.geometry ? roundGeometry(f.geometry, precision) : null,
    is_boundary: f.isBoundary,
    duplicate_of: f.duplicateOf,
  }));

  // Pendências: o que a equipe deve conferir no KML de origem (sem endereço, imóvel nem identificadores restritos).
  const pendencias: Snapshot['sobre']['pendencias'] = [];
  const hasExamField = !!report.seenFields.resultado_exame;
  for (const { f } of kept) {
    const label = [f.type === 'captura' ? 'Captura' : f.type === 'pit' ? 'PIT' : f.type === 'visita' ? 'Visita' : null, f.name || f.species].filter(Boolean).join(' · ') || `Registro ${f.index}`;
    const add = (problema: string) => pendencias.push({ indice: f.index + 1, registro: label, localidade: f.localityRaw, data: f.visitDate, problema });
    const codes = new Set(f.issues.map((i) => i.code));
    if (codes.has('exame_antes_da_captura')) add('Data do exame anterior à data de captura (confira as datas)');
    if (codes.has('localidade_nao_reconhecida') && ['captura', 'visita', 'pit'].includes(f.type)) add(`Localidade "${f.localityRaw ?? '?'}" não existe entre as áreas do mapa (confira a grafia)`);
    if (codes.has('data_invalida')) add('Data inválida');
    if (codes.has('fora_da_area')) add('Coordenada fora da região esperada (latitude/longitude podem estar trocadas)');
    if (f.type === 'captura') {
      if (hasExamField && f.examResult === 'nao_informado') add('Sem resultado de exame');
      if (!f.visitDate && !codes.has('data_invalida')) add('Sem data de captura');
      if (!f.species) add('Espécie não identificada pelo nome do registro');
    }
  }

  // Localidades com registros, mas sem área desenhada em "Area das Localidades" (uma pendência por localidade).
  const polyKeys = new Set(features.filter((f) => f.type === 'localidade' && f.geometry?.type === 'Polygon' && f.localityKey).map((f) => f.localityKey));
  if (polyKeys.size > 0) {
    const flagged = new Set(pendencias.filter((p) => p.problema.startsWith('Localidade "')).map((p) => p.localidade));
    const seenKeys = new Set<string>();
    for (const { f } of kept) {
      if (!['captura', 'visita', 'pit'].includes(f.type) || !f.localityKey || polyKeys.has(f.localityKey) || seenKeys.has(f.localityKey) || flagged.has(f.localityRaw)) continue;
      seenKeys.add(f.localityKey);
      pendencias.push({ indice: f.index + 1, registro: `Localidade ${f.localityRaw}`, localidade: f.localityRaw, data: null, problema: 'A localidade tem registros, mas não tem área desenhada na pasta "Area das Localidades"' });
    }
  }
  pendencias.sort((a, b) => a.indice - b.indice);

  const byCode = new Map<string, { mensagem: string; quantidade: number }>();
  for (const i of report.issues) {
    if (i.severity === 'info') continue;
    const e = byCode.get(i.code) ?? { mensagem: i.message, quantidade: 0 };
    e.quantidade++;
    byCode.set(i.code, e);
  }
  const now = opts.now ?? new Date();
  return {
    formato: 1,
    geradoEm: now.toISOString(),
    arquivo: filename,
    arquivoSha256: createHash('sha256').update(bytes).digest('hex'),
    ativadoEm: now.toISOString(),
    byType: report.counts.byType,
    seenFields: report.seenFields as unknown as Record<string, boolean>,
    rec,
    boundary: opts.boundary ?? null,
    ...(opts.mapas && (opts.mapas.brasil || opts.mapas.ceara) ? { mapas: opts.mapas } : {}),
    sobre: {
      registrosLidos: features.length,
      duplicatasExcluidas: features.length - kept.length,
      avisos: [...byCode].map(([codigo, v]) => ({ codigo, mensagem: v.mensagem, quantidade: v.quantidade })),
      camposDescartados: report.droppedPersonalFields,
      pendencias: pendencias.slice(0, 1000),
      camposRestritosRemovidos: ['Endereço', 'Número do imóvel/residência', 'Identificador de origem (nº da etiqueta)', 'Valores brutos do arquivo original'],
    },
  };
}

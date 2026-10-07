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
    sobre: {
      registrosLidos: features.length,
      duplicatasExcluidas: features.length - kept.length,
      avisos: [...byCode].map(([codigo, v]) => ({ codigo, mensagem: v.mensagem, quantidade: v.quantidade })),
      camposDescartados: report.droppedPersonalFields,
      camposRestritosRemovidos: ['Endereço', 'Número do imóvel/residência', 'Identificador de origem (nº da etiqueta)', 'Valores brutos do arquivo original'],
    },
  };
}

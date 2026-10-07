import { canonicalFor, parseCount, parseDate, parseExamResult, parseSearchResult, PERSONAL_FIELDS } from './fields.js';
import { pointInPolygon, representativePoint } from './geo.js';
import { levenshtein, normalizeKey, normalizeName } from './text.js';
import type {
  CanonicalField,
  FeatureType,
  FieldMapping,
  Geometry,
  Issue,
  NormalizedFeature,
  ParseReport,
  ParseResult,
  RawKml,
  RawPlacemark,
  SeenFields,
} from './types.js';

const BOUNDARY_RE = /(^|\s)(limite|municipio|municipal|contorno)(\s|$)|^croata$/;
const BBOX_PLAUSIBLE = { minLon: -75, maxLon: -30, minLat: -35, maxLat: 6 }; // Brasil, com folga

function folderTypeGuess(folderPath: string[]): FeatureType | null {
  for (let i = folderPath.length - 1; i >= 0; i--) {
    const n = normalizeName(folderPath[i]!);
    if (/\bpits?\b/.test(n)) return 'pit';
    if (/captur/.test(n)) return 'captura';
    if (/visita|busca|pesquisa/.test(n)) return 'visita';
    if (/rota|trajeto|percurso/.test(n)) return 'rota';
    if (/localidade|comunidade|povoado|sitio/.test(n)) return 'localidade';
    if (/area|poligono|limite|municipio/.test(n)) return 'area';
  }
  return null;
}

function isTypeFolderName(name: string): boolean {
  const n = normalizeName(name);
  return /\bpits?\b|captur|visita|busca|pesquisa|rota|trajeto|percurso|^localidades?$|^comunidades?$|^areas?$|^poligonos?$|^pontos?$/.test(n);
}

interface Resolved {
  structured: Record<string, string>;
  dropped: string[];
  unmapped: string[];
  canon: Partial<Record<CanonicalField, string>>;
  originalValues: Record<string, string>;
}

function resolveFields(pm: RawPlacemark, mapping: FieldMapping): Resolved {
  const canon: Partial<Record<CanonicalField, string>> = {};
  const dropped: string[] = [];
  const unmapped: string[] = [];
  const originalValues: Record<string, string> = {};
  const all: [string, string][] = [...Object.entries(pm.structured), ...Object.entries(pm.fromDescription)];
  const keptStructured: Record<string, string> = {};
  const userMap = mapping.fields ?? {};
  for (const [k, v] of all) {
    const userCanon = Object.entries(userMap).find(([uk]) => normalizeKey(uk) === normalizeKey(k))?.[1];
    if (!userCanon && PERSONAL_FIELDS.has(normalizeKey(k))) {
      dropped.push(k);
      continue;
    }
    const c = userCanon ?? canonicalFor(k);
    originalValues[k] = v;
    if (c === 'ignorar') continue;
    if (c) {
      if (!(c in canon) || (canon[c] === '' && v !== '')) canon[c] = v;
    } else if (v !== '') unmapped.push(k);
    if (k in pm.structured) keptStructured[k] = v;
  }
  return { structured: keptStructured, dropped, unmapped, canon, originalValues };
}

function classify(pm: RawPlacemark, geom: Geometry | null, r: Resolved, mapping: FieldMapping): FeatureType {
  const byFolder = mapping.folders;
  if (byFolder) {
    const full = pm.folderPath.join(' / ');
    for (const key of [full, ...[...pm.folderPath].reverse()]) {
      const hit = Object.entries(byFolder).find(([fk]) => normalizeName(fk) === normalizeName(key));
      if (hit) return hit[1];
    }
  }
  if (geom?.type === 'LineString') return 'rota';
  const guess = folderTypeGuess(pm.folderPath);
  if (geom?.type === 'Polygon') return guess === 'localidade' ? 'localidade' : 'area';
  if (guess) return guess;
  const c = r.canon;
  if (c.resultado_exame || c.quantidade || c.fase || c.sexo || c.especie) return 'captura';
  if (c.pit) return 'pit';
  if (c.resultado_busca) return 'visita';
  return 'outro';
}

export function parseToFeatures(raw: RawKml, mapping: FieldMapping = {}): ParseResult {
  const issues: Issue[] = [...raw.issues];
  const features: NormalizedFeature[] = [];
  const dropped = new Set<string>();
  const unmapped = new Set<string>();
  const seen: SeenFields = { localidade: false, data_visita: false, data_exame: false, resultado_busca: false, resultado_exame: false, quantidade: false };
  const nameByKey = new Map<string, string>();
  const registerLocality = (name: string): string => {
    const key = normalizeName(name);
    if (key && !nameByKey.has(key)) nameByKey.set(key, name.replace(/\s+/g, ' ').trim());
    return key;
  };

  for (const pm of raw.placemarks) {
    const fIssues: Issue[] = [];
    const r = resolveFields(pm, mapping);
    r.dropped.forEach((d) => dropped.add(d));
    r.unmapped.forEach((u) => unmapped.add(u));

    const geom = pm.geometries[0] ?? null;
    if (pm.geometries.length > 1) fIssues.push({ severity: 'info', code: 'multiplas_geometrias', message: 'Placemark com várias geometrias; usamos a primeira como principal.', placemark: pm.index });
    const type = classify(pm, geom, r, mapping);
    const rep = representativePoint(geom);

    if (rep && (rep[0] < BBOX_PLAUSIBLE.minLon || rep[0] > BBOX_PLAUSIBLE.maxLon || rep[1] < BBOX_PLAUSIBLE.minLat || rep[1] > BBOX_PLAUSIBLE.maxLat)) {
      fIssues.push({ severity: 'aviso', code: 'fora_da_area', message: `Coordenada fora da área esperada (${rep[1].toFixed(4)}, ${rep[0].toFixed(4)}). Latitude e longitude podem estar invertidas.`, placemark: pm.index });
    }

    for (const key of Object.keys(r.canon) as CanonicalField[]) {
      if (key in seen && r.canon[key] !== '') (seen as unknown as Record<string, boolean>)[key] = true;
    }

    // Datas
    const dv = parseDate(r.canon.data_visita ?? pm.timestamp);
    if (!dv.valid) fIssues.push({ severity: 'aviso', code: 'data_invalida', message: `Data de visita inválida: "${r.canon.data_visita ?? pm.timestamp}".`, placemark: pm.index });
    const de = parseDate(r.canon.data_exame);
    if (!de.valid) fIssues.push({ severity: 'aviso', code: 'data_invalida', message: `Data de exame inválida: "${r.canon.data_exame}".`, placemark: pm.index });

    // Resultado do exame (dimensão 2)
    const exam = parseExamResult(r.canon.resultado_exame);
    if (!exam.recognized) fIssues.push({ severity: 'aviso', code: 'resultado_exame_desconhecido', message: `Resultado do exame não reconhecido: "${r.canon.resultado_exame}" (tratado como não informado).`, placemark: pm.index });

    // Resultado da busca (dimensão 1). Nunca inferido pela ausência de pontos.
    const sr = parseSearchResult(r.canon.resultado_busca);
    if (!sr.recognized) fIssues.push({ severity: 'aviso', code: 'resultado_busca_desconhecido', message: `Resultado da busca não reconhecido: "${r.canon.resultado_busca}".`, placemark: pm.index });
    let searchResult = sr.value;
    if (type === 'captura' && searchResult === 'nao_informado') searchResult = 'com_captura'; // um registro de captura É uma captura
    if (type === 'captura' && sr.value === 'sem_captura') {
      fIssues.push({ severity: 'aviso', code: 'captura_contraditoria', message: 'Registro de captura marcado como "sem captura"; mantido como informado.', placemark: pm.index });
    }
    if (type !== 'captura' && type !== 'visita') searchResult = 'nao_informado';

    // Localidade
    let localityRaw: string | null = null;
    if (type === 'localidade') localityRaw = r.canon.localidade || pm.name || null;
    else if (r.canon.localidade) localityRaw = r.canon.localidade;
    else {
      const folderName = [...pm.folderPath].reverse().find((f) => !isTypeFolderName(f));
      if (folderName && (type === 'captura' || type === 'visita' || type === 'pit')) {
        localityRaw = folderName;
        fIssues.push({ severity: 'info', code: 'localidade_pela_pasta', message: `Localidade "${folderName}" deduzida do nome da pasta.`, placemark: pm.index });
      }
    }

    const count = parseCount(r.canon.quantidade);
    if (r.canon.quantidade && count === null) fIssues.push({ severity: 'aviso', code: 'quantidade_invalida', message: `Quantidade inválida: "${r.canon.quantidade}".`, placemark: pm.index });

    features.push({
      index: pm.index,
      sourceId: r.canon.id_origem || pm.sourceId,
      type,
      name: pm.name,
      folderPath: pm.folderPath,
      localityRaw,
      localityKey: localityRaw ? registerLocality(localityRaw) : null,
      geometry: geom,
      lat: rep ? rep[1] : null,
      lng: rep ? rep[0] : null,
      visitDate: dv.date,
      examDate: de.date,
      searchResult,
      examResult: type === 'captura' ? exam.value : 'nao_informado',
      triatomineCount: count,
      stage: r.canon.fase || null,
      sex: r.canon.sexo || null,
      species: r.canon.especie || null,
      propertyRef: r.canon.imovel || null,
      pitRef: r.canon.pit || null,
      address: r.canon.endereco || null,
      isBoundary: type === 'area' && (BOUNDARY_RE.test(normalizeName(pm.name)) || pm.folderPath.some((f) => BOUNDARY_RE.test(normalizeName(f)))),
      duplicateOf: null,
      raw: { structured: r.structured, description: pm.fromDescription, originalValues: r.originalValues },
      issues: fIssues,
    });
  }

  // Atribui localidade pela geometria (ponto dentro de polígono de localidade) quando falta.
  const locPolys = features.filter((f) => f.type === 'localidade' && f.geometry?.type === 'Polygon' && f.localityKey);
  for (const f of features) {
    if (f.localityKey || !f.geometry || f.geometry.type !== 'Point' || !['captura', 'visita', 'pit'].includes(f.type)) continue;
    const hit = locPolys.find((p) => pointInPolygon(f.geometry!.coordinates as [number, number], (p.geometry as { coordinates: [number, number][][] }).coordinates));
    if (hit) {
      f.localityKey = hit.localityKey;
      f.localityRaw = nameByKey.get(hit.localityKey!) ?? null;
      f.issues.push({ severity: 'info', code: 'localidade_por_geometria', message: 'Localidade definida pela posição do ponto dentro do polígono.', placemark: f.index });
    }
  }
  for (const f of features) {
    if (!f.localityKey && ['captura', 'visita', 'pit'].includes(f.type)) {
      f.issues.push({ severity: 'aviso', code: 'localidade_nao_reconhecida', message: `Registro "${f.name || f.index}" sem localidade reconhecida.`, placemark: f.index });
    }
  }

  // Possíveis duplicatas (não removemos nada em silêncio).
  const groups = new Map<string, number[]>();
  for (const f of features) {
    if (f.type !== 'captura' && f.type !== 'visita') continue;
    const key = f.sourceId
      ? `id:${f.sourceId}`
      : `c:${f.localityKey ?? ''}|${f.visitDate ?? ''}|${f.propertyRef ?? ''}|${f.lat?.toFixed(5) ?? ''},${f.lng?.toFixed(5) ?? ''}|${f.species ?? ''}|${f.stage ?? ''}|${f.sex ?? ''}`;
    if (!f.sourceId && !f.visitDate && !f.propertyRef && f.lat == null) continue; // sem informação suficiente para afirmar
    groups.set(key, [...(groups.get(key) ?? []), f.index]);
  }
  const duplicates: ParseReport['duplicates'] = [];
  for (const [key, idxs] of groups) {
    if (idxs.length < 2) continue;
    duplicates.push({ key, indexes: idxs });
    const first = idxs[0]!;
    for (const i of idxs.slice(1)) {
      const f = features.find((x) => x.index === i)!;
      f.duplicateOf = first;
      f.issues.push({ severity: 'aviso', code: 'possivel_duplicata', message: `Possível duplicata do registro ${first}.`, placemark: i });
    }
  }

  // Localidades parecidas
  const keys = [...nameByKey.keys()];
  const similar: [string, string][] = [];
  for (let i = 0; i < keys.length; i++)
    for (let j = i + 1; j < keys.length; j++) {
      const a = keys[i]!;
      const b = keys[j]!;
      if (Math.min(a.length, b.length) >= 6 && levenshtein(a, b) <= 1) similar.push([nameByKey.get(a)!, nameByKey.get(b)!]);
    }
  if (similar.length) issues.push({ severity: 'aviso', code: 'localidades_parecidas', message: `${similar.length} par(es) de localidades com nomes muito parecidos; confira se são a mesma.` });

  const byType: Record<FeatureType, number> = { localidade: 0, visita: 0, captura: 0, pit: 0, area: 0, rota: 0, outro: 0 };
  const folderTypes: Record<string, FeatureType> = {};
  for (const f of features) {
    byType[f.type]++;
    const folder = f.folderPath[f.folderPath.length - 1];
    if (folder && !(folder in folderTypes)) folderTypes[folder] = f.type;
    for (const i of f.issues) issues.push(i);
  }
  if (byType.outro > 0) issues.push({ severity: 'aviso', code: 'registros_nao_classificados', message: `${byType.outro} registro(s) não puderam ser classificados. Use o mapeamento de pastas/campos.` });
  if (unmapped.size) issues.push({ severity: 'info', code: 'campos_sem_mapeamento', message: `Campos sem mapeamento (ficam só no registro original): ${[...unmapped].slice(0, 15).join(', ')}.` });
  if (dropped.size) issues.push({ severity: 'info', code: 'campos_pessoais_descartados', message: `Campos com possíveis dados pessoais foram descartados: ${[...dropped].join(', ')}.` });

  const semGeometria = features.filter((f) => !f.geometry).length;
  const report: ParseReport = {
    folders: raw.folders.map((f) => f.join(' / ')),
    counts: {
      placemarks: features.length,
      byType,
      points: features.filter((f) => f.geometry?.type === 'Point').length,
      lines: features.filter((f) => f.geometry?.type === 'LineString').length,
      polygons: features.filter((f) => f.geometry?.type === 'Polygon').length,
      localities: nameByKey.size,
      captureRecords: byType.captura,
      pits: byType.pit,
      semGeometria,
    },
    seenFields: seen,
    unmappedFields: [...unmapped],
    droppedPersonalFields: [...dropped],
    folderTypes,
    localities: [...nameByKey].map(([key, name]) => ({ key, name })),
    similarLocalities: similar,
    duplicates,
    issues,
  };
  return { features, report };
}

import { canonicalFor, normalizeSpecies, parseChannel, parseCount, parseDate, parseEnvironment, parseExamResult, parseSearchResult, parseStageSex, PERSONAL_FIELDS } from './fields.js';
import { pointInPolygon, representativePoint } from './geo.js';
import { LocalityBook, cleanLocalityName, hasStartEndMarker } from './locality.js';
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
    if (/captur|coleta|resultado|positiv|negativ/.test(n)) return 'captura';
    if (/visita|busca|pesquisa/.test(n)) return 'visita';
    if (/rota|trajeto|percurso/.test(n)) return 'rota';
    if (/localidade|comunidade|povoado|sitio/.test(n)) return 'localidade';
    if (/area|poligono|limite|municipio/.test(n)) return 'area';
  }
  return null;
}

function isTypeFolderName(name: string): boolean {
  const n = normalizeName(name);
  return /\bpits?\b|captur|coleta|resultado|positiv|negativ|visita|busca|pesquisa|rota|trajeto|percurso|^localidades?\b|^comunidades?$|^areas?\b|^poligonos?$|^pontos?$/.test(n);
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
  const c = r.canon;
  const specimen = !!(c.resultado_exame || c.quantidade || c.fase_sexo || c.especie || c.canal);
  const guess = folderTypeGuess(pm.folderPath);
  if (geom?.type === 'Polygon') return guess === 'localidade' ? 'localidade' : 'area';
  if (guess === 'pit' && specimen) return 'captura';
  if (guess) return guess;
  if (specimen) return 'captura';
  if (c.pit) return 'pit';
  if (c.resultado_busca) return 'visita';
  return 'outro';
}

const completeness = (f: NormalizedFeature) =>
  [f.visitDate, f.examDate, f.sourceId, f.species, f.stage, f.channel, f.environment, f.examResult !== 'nao_informado' ? 'x' : null].filter(Boolean).length;

export function parseToFeatures(raw: RawKml, mapping: FieldMapping = {}): ParseResult {
  const issues: Issue[] = [...raw.issues];
  const features: NormalizedFeature[] = [];
  const dropped = new Set<string>();
  const unmapped = new Set<string>();
  const seen: SeenFields = { localidade: false, data_visita: false, data_exame: false, resultado_busca: false, resultado_exame: false, quantidade: false };

  // 1) Convenção "Início/Final" em pastas de localidades: só vale se a maioria dos pontos a segue.
  const folderPoints = new Map<string, { total: number; marked: number }>();
  for (const pm of raw.placemarks) {
    if (pm.geometries[0]?.type !== 'Point' || folderTypeGuess(pm.folderPath) !== 'localidade') continue;
    const k = pm.folderPath.join(' / ');
    const e = folderPoints.get(k) ?? { total: 0, marked: 0 };
    e.total++;
    if (hasStartEndMarker(pm.name)) e.marked++;
    folderPoints.set(k, e);
  }
  const markerConvention = (path: string[]) => {
    const e = folderPoints.get(path.join(' / '));
    return !!e && e.marked / e.total >= 0.5;
  };

  // 2) Placemark -> feature (sem localidade resolvida ainda)
  interface Pending {
    f: NormalizedFeature;
    locName: string | null;
    fromRecord: boolean;
  }
  const pending: Pending[] = [];
  for (const pm of raw.placemarks) {
    const fIssues: Issue[] = [];
    const r = resolveFields(pm, mapping);
    r.dropped.forEach((d) => dropped.add(d));
    r.unmapped.forEach((u) => unmapped.add(u));

    const geom = pm.geometries[0] ?? null;
    if (pm.geometries.length > 1) fIssues.push({ severity: 'info', code: 'multiplas_geometrias', message: 'Placemark com várias geometrias; usamos a primeira como principal.', placemark: pm.index });
    let type = classify(pm, geom, r, mapping);
    if (type === 'localidade' && geom?.type === 'Point' && !mapping.folders && markerConvention(pm.folderPath) && !hasStartEndMarker(pm.name)) {
      type = 'outro';
      fIssues.push({ severity: 'info', code: 'ponto_de_referencia', message: `"${pm.name}" não segue o padrão "localidade + código + Início/Final"; tratado como ponto de referência.`, placemark: pm.index });
    }
    const rep = representativePoint(geom);

    if (rep && (rep[0] < BBOX_PLAUSIBLE.minLon || rep[0] > BBOX_PLAUSIBLE.maxLon || rep[1] < BBOX_PLAUSIBLE.minLat || rep[1] > BBOX_PLAUSIBLE.maxLat)) {
      fIssues.push({ severity: 'aviso', code: 'fora_da_area', message: `Coordenada fora da área esperada (${rep[1].toFixed(4)}, ${rep[0].toFixed(4)}). Latitude e longitude podem estar invertidas.`, placemark: pm.index });
    }
    for (const key of Object.keys(r.canon) as CanonicalField[]) {
      if (key in seen && r.canon[key] !== '') (seen as unknown as Record<string, boolean>)[key] = true;
    }

    const dv = parseDate(r.canon.data_visita ?? pm.timestamp);
    if (!dv.valid) fIssues.push({ severity: 'aviso', code: 'data_invalida', message: `Data de captura/visita inválida: "${r.canon.data_visita ?? pm.timestamp}".`, placemark: pm.index });
    const de = parseDate(r.canon.data_exame);
    if (!de.valid) fIssues.push({ severity: 'aviso', code: 'data_invalida', message: `Data de exame inválida: "${r.canon.data_exame}".`, placemark: pm.index });
    if (dv.date && de.date && de.date < dv.date) fIssues.push({ severity: 'aviso', code: 'exame_antes_da_captura', message: `Data do exame (${de.date}) anterior à data de captura (${dv.date}).`, placemark: pm.index });

    const exam = parseExamResult(r.canon.resultado_exame);
    if (!exam.recognized) fIssues.push({ severity: 'aviso', code: 'resultado_exame_desconhecido', message: `Resultado do exame não reconhecido: "${r.canon.resultado_exame}" (tratado como não informado).`, placemark: pm.index });
    else if (r.canon.resultado_exame && !['positivo', 'negativo', 'pendente'].includes(normalizeKey(r.canon.resultado_exame)) && exam.value !== 'nao_informado' && levenshtein(normalizeKey(r.canon.resultado_exame), exam.value) <= 1) {
      fIssues.push({ severity: 'info', code: 'resultado_exame_corrigido', message: `Resultado do exame "${r.canon.resultado_exame}" interpretado como ${exam.value}.`, placemark: pm.index });
    }

    const sr = parseSearchResult(r.canon.resultado_busca);
    if (!sr.recognized) fIssues.push({ severity: 'aviso', code: 'resultado_busca_desconhecido', message: `Resultado da busca não reconhecido: "${r.canon.resultado_busca}".`, placemark: pm.index });
    let searchResult = sr.value;
    if (type === 'captura' && searchResult === 'nao_informado') searchResult = 'com_captura'; // um registro de captura É uma captura
    if (type === 'captura' && sr.value === 'sem_captura') fIssues.push({ severity: 'aviso', code: 'captura_contraditoria', message: 'Registro de captura marcado como "sem captura"; mantido como informado.', placemark: pm.index });
    if (type !== 'captura' && type !== 'visita') searchResult = 'nao_informado';

    let locName: string | null = null;
    let fromRecord = false;
    if (type === 'localidade') locName = r.canon.localidade || (geom?.type === 'Point' ? cleanLocalityName(pm.name) : pm.name) || null;
    else if (r.canon.localidade) {
      locName = r.canon.localidade;
      fromRecord = true;
    }
    else {
      const folderName = [...pm.folderPath].reverse().find((f) => !isTypeFolderName(f));
      if (folderName && (type === 'captura' || type === 'visita' || type === 'pit')) {
        locName = folderName;
        fromRecord = true;
        fIssues.push({ severity: 'info', code: 'localidade_pela_pasta', message: `Localidade "${folderName}" deduzida do nome da pasta.`, placemark: pm.index });
      }
    }

    const count = parseCount(r.canon.quantidade);
    if (r.canon.quantidade && count === null) fIssues.push({ severity: 'aviso', code: 'quantidade_invalida', message: `Quantidade inválida: "${r.canon.quantidade}".`, placemark: pm.index });

    const ss = parseStageSex(r.canon.fase_sexo);
    const channel = parseChannel(r.canon.canal);
    if (r.canon.canal && !channel) fIssues.push({ severity: 'info', code: 'canal_desconhecido', message: `Origem da captura não reconhecida: "${r.canon.canal}".`, placemark: pm.index });
    let species = r.canon.especie || null;
    if (!species && type === 'captura' && pm.name) {
      species = normalizeSpecies(pm.name);
      if (species) fIssues.push({ severity: 'info', code: 'especie_pelo_nome', message: `Espécie "${species}" deduzida do nome do registro ("${pm.name}").`, placemark: pm.index });
    }

    const f: NormalizedFeature = {
      index: pm.index,
      sourceId: r.canon.id_origem || pm.sourceId,
      type,
      name: pm.name,
      folderPath: pm.folderPath,
      localityRaw: null,
      localityKey: null,
      geometry: geom,
      lat: rep ? rep[1] : null,
      lng: rep ? rep[0] : null,
      visitDate: dv.date,
      examDate: de.date,
      searchResult,
      examResult: type === 'captura' ? exam.value : 'nao_informado',
      triatomineCount: count,
      stage: r.canon.fase || ss.stage,
      sex: r.canon.sexo || ss.sex,
      species,
      propertyRef: r.canon.imovel || null,
      pitRef: r.canon.pit || null,
      propertyCount: type === 'localidade' ? parseCount(r.canon.qtd_imoveis) : null,
      zone: r.canon.zona?.trim() || null,
      channel,
      environment: parseEnvironment(r.canon.ambiente),
      address: r.canon.endereco || null,
      isBoundary: type === 'area' && (BOUNDARY_RE.test(normalizeName(pm.name)) || pm.folderPath.some((f) => BOUNDARY_RE.test(normalizeName(f)))),
      duplicateOf: null,
      raw: { structured: r.structured, description: pm.fromDescription, originalValues: r.originalValues },
      issues: fIssues,
    };
    pending.push({ f, locName, fromRecord });
    features.push(f);
  }

  // 3) Localidades: polígonos de localidade são a referência; pontos e registros são resolvidos contra elas.
  const book = new LocalityBook(mapping.localityAliases);
  const locFeatures = pending.filter((p) => p.f.type === 'localidade' && p.locName);
  const polys = locFeatures.filter((p) => p.f.geometry?.type === 'Polygon');
  for (const p of polys) p.f.localityKey = book.add(p.locName!);
  if (book.size === 0) for (const p of locFeatures) p.f.localityKey = book.add(p.locName!);
  const unmatched = new Map<string, string>();
  for (const p of pending) {
    if (!p.locName) continue;
    if (p.f.localityKey) {
      p.f.localityRaw = book.display(p.f.localityKey) ?? p.locName;
      continue;
    }
    const res = book.resolve(p.locName, true);
    p.f.localityKey = res.key;
    p.f.localityRaw = res.name;
    if (res.how === 'semelhante' || res.how === 'parcial' || res.how === 'alias') {
      p.f.issues.push({ severity: 'info', code: 'localidade_corrigida', message: `Localidade "${p.locName}" associada a "${res.name}" (${res.how}).`, placemark: p.f.index });
    } else if (!res.matched && p.fromRecord && polys.length > 0) {
      unmatched.set(res.key, p.locName);
      p.f.issues.push({ severity: 'aviso', code: 'localidade_nao_reconhecida', message: `Localidade "${p.locName}" não existe entre as localidades mapeadas; mantida como nova. Use "Unificar localidades" se for outra grafia.`, placemark: p.f.index });
    }
  }

  // Localidade por posição (ponto dentro de polígono) quando falta
  const locPolys = polys.filter((p) => p.f.localityKey);
  for (const f of features) {
    if (f.localityKey || !f.geometry || f.geometry.type !== 'Point' || !['captura', 'visita', 'pit'].includes(f.type)) continue;
    const hit = locPolys.find((p) => pointInPolygon(f.geometry!.coordinates as [number, number], (p.f.geometry as { coordinates: [number, number][][] }).coordinates));
    if (hit) {
      f.localityKey = hit.f.localityKey;
      f.localityRaw = book.display(hit.f.localityKey!) ?? null;
      f.issues.push({ severity: 'info', code: 'localidade_por_geometria', message: 'Localidade definida pela posição do ponto dentro do polígono.', placemark: f.index });
    }
  }
  for (const f of features) {
    if (!f.localityKey && ['captura', 'visita', 'pit'].includes(f.type)) {
      f.issues.push({ severity: 'aviso', code: 'localidade_nao_reconhecida', message: `Registro "${f.name || f.index}" sem localidade reconhecida.`, placemark: f.index });
    }
  }

  // 4) Possíveis duplicatas (nada é removido em silêncio). A cópia mais completa é a principal.
  // Dois registros são considerados cópia quando, na mesma localidade/imóvel e a menos de ~25 m,
  // todo atributo preenchido nos dois é igual (campo vazio de um lado não conta como diferença).
  const metersApart = (a: NormalizedFeature, b: NormalizedFeature) => {
    if (a.lat == null || b.lat == null || a.lng == null || b.lng == null) return 0;
    const dLat = (a.lat - b.lat) * 111_000;
    const dLng = (a.lng - b.lng) * 111_000 * Math.cos((a.lat * Math.PI) / 180);
    return Math.hypot(dLat, dLng);
  };
  const same = (x: string | null, y: string | null) => !x || !y || normalizeKey(x) === normalizeKey(y);
  const compatible = (a: NormalizedFeature, b: NormalizedFeature) =>
    a.type === b.type &&
    a.localityKey === b.localityKey &&
    same(a.propertyRef, b.propertyRef) &&
    metersApart(a, b) <= 25 &&
    same(a.visitDate, b.visitDate) &&
    same(a.sex, b.sex) &&
    same(a.stage, b.stage) &&
    same(a.channel, b.channel) &&
    same(a.environment, b.environment) &&
    same(a.species, b.species) &&
    same(a.sourceId, b.sourceId) &&
    (a.examResult === 'nao_informado' || b.examResult === 'nao_informado' || a.examResult === b.examResult);
  const cand = features
    .filter((f) => (f.type === 'captura' || f.type === 'visita') && (f.lat != null || f.propertyRef || f.visitDate || f.sourceId))
    .sort((a, b) => completeness(b) - completeness(a) || a.index - b.index);
  const primaries: NormalizedFeature[] = [];
  const dupGroups = new Map<number, number[]>();
  for (const f of cand) {
    const primary = primaries.find((p) => compatible(p, f));
    if (!primary) {
      primaries.push(f);
      continue;
    }
    f.duplicateOf = primary.index;
    dupGroups.set(primary.index, [...(dupGroups.get(primary.index) ?? [primary.index]), f.index]);
    f.issues.push({ severity: 'aviso', code: 'possivel_duplicata', message: `Possível duplicata do registro ${primary.index} (mesma localidade, imóvel, posição e atributos).`, placemark: f.index });
  }
  const folderOf = (i: number) => features.find((x) => x.index === i)!.folderPath.join(' / ');
  const duplicates: ParseReport['duplicates'] = [...dupGroups].map(([first, idxs]) => ({
    key: String(first),
    indexes: idxs,
    crossFolder: new Set(idxs.map(folderOf)).size > 1,
  }));

  // 5) Localidades parecidas (entre as já conhecidas)
  const all = book.entries();
  const similar: [string, string][] = [];
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++) {
      const [a, an] = all[i]!;
      const [b, bn] = all[j]!;
      if (Math.min(a.length, b.length) >= 6 && levenshtein(a, b) <= 1) similar.push([an, bn]);
    }
  if (similar.length) issues.push({ severity: 'aviso', code: 'localidades_parecidas', message: `${similar.length} par(es) de localidades com nomes muito parecidos; confira se são a mesma (use "Unificar localidades").` });

  const byType: Record<FeatureType, number> = { localidade: 0, visita: 0, captura: 0, pit: 0, area: 0, rota: 0, outro: 0 };
  const folderTypes: Record<string, FeatureType> = {};
  for (const f of features) {
    byType[f.type]++;
    const folder = f.folderPath[f.folderPath.length - 1];
    if (folder && !(folder in folderTypes)) folderTypes[folder] = f.type;
    for (const i of f.issues) issues.push(i);
  }
  if (byType.outro > 0) issues.push({ severity: 'aviso', code: 'registros_nao_classificados', message: `${byType.outro} ponto(s) de referência ou registro(s) não classificado(s). Se algum for captura, localidade ou PIT, use o mapeamento de pastas/campos.` });
  if (unmapped.size) issues.push({ severity: 'info', code: 'campos_sem_mapeamento', message: `Campos sem mapeamento (ficam só no registro original): ${[...unmapped].slice(0, 15).join(', ')}.` });
  if (dropped.size) issues.push({ severity: 'info', code: 'campos_pessoais_descartados', message: `Campos com possíveis dados pessoais foram descartados: ${[...dropped].join(', ')}.` });

  const report: ParseReport = {
    folders: raw.folders.map((f) => f.join(' / ')),
    counts: {
      placemarks: features.length,
      byType,
      points: features.filter((f) => f.geometry?.type === 'Point').length,
      lines: features.filter((f) => f.geometry?.type === 'LineString').length,
      polygons: features.filter((f) => f.geometry?.type === 'Polygon').length,
      localities: book.size,
      captureRecords: byType.captura,
      pits: byType.pit,
      semGeometria: features.filter((f) => !f.geometry).length,
    },
    seenFields: seen,
    unmappedFields: [...unmapped],
    droppedPersonalFields: [...dropped],
    folderTypes,
    localities: all.map(([key, name]) => ({ key, name })),
    similarLocalities: similar,
    duplicates,
    unmatchedLocalities: [...unmatched.values()],
    issues,
  };
  return { features, report };
}

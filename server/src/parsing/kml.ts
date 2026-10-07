import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { ImportError } from './kmz.js';
import type { Coord, Geometry, Issue, RawKml, RawPlacemark } from './types.js';
import { decodeEntities, normalizeKey } from './text.js';

const ARRAY_TAGS = new Set([
  'Document',
  'Folder',
  'Placemark',
  'Data',
  'SimpleData',
  'SchemaData',
  'Point',
  'LineString',
  'Polygon',
  'MultiGeometry',
  'LinearRing',
  'innerBoundaryIs',
]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  // Entidades NÃO são expandidas: sem XXE nem "billion laughs".
  processEntities: false,
  htmlEntities: false,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  removeNSPrefix: true,
  isArray: (name) => ARRAY_TAGS.has(name),
});

export function decodeXmlBytes(bytes: Uint8Array, issues: Issue[]): string {
  let text = new TextDecoder('utf-8').decode(bytes);
  const declared = /^\uFEFF?\s*<\?xml[^>]*encoding=["']([^"']+)["']/i.exec(text.slice(0, 200))?.[1]?.toLowerCase();
  if (declared && !['utf-8', 'utf8'].includes(declared)) {
    try {
      text = new TextDecoder(declared).decode(bytes);
      issues.push({ severity: 'info', code: 'encoding_incomum', message: `Arquivo declara codificação ${declared}; foi convertido.` });
    } catch {
      issues.push({ severity: 'aviso', code: 'encoding_incomum', message: `Codificação ${declared} não suportada; lido como UTF-8.` });
    }
  }
  if (text.includes('�')) {
    issues.push({ severity: 'aviso', code: 'encoding_incomum', message: 'Há caracteres inválidos no arquivo; acentos podem aparecer errados.' });
  }
  return text.replace(/^\uFEFF/, '');
}

/** Texto de um nó. As entidades XML padrão (&amp; &lt; &gt; &quot; &apos;) são decodificadas aqui: o parser não as expande (segurança contra XXE). */
function text(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string') return decodeEntities(node);
  if (Array.isArray(node)) return text(node[0]);
  if (typeof node === 'object') {
    const t = (node as Record<string, unknown>)['#text'];
    return typeof t === 'string' ? decodeEntities(t) : '';
  }
  return String(node);
}

function arr<T = unknown>(v: unknown): T[] {
  return v == null ? [] : Array.isArray(v) ? (v as T[]) : [v as T];
}

function parseCoords(s: string): { coords: Coord[]; bad: number } {
  const coords: Coord[] = [];
  let bad = 0;
  for (const tok of s.split(/\s+/).filter(Boolean)) {
    const [lonS, latS] = tok.split(',');
    const lon = Number(lonS);
    const lat = Number(latS);
    if (lonS === '' || latS === undefined || latS === '' || !Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) {
      bad++;
      continue;
    }
    coords.push([lon, lat]);
  }
  return { coords, bad };
}

function readGeometries(pm: Record<string, unknown>, issues: Issue[], idx: number): Geometry[] {
  const out: Geometry[] = [];
  const warnBad = (n: number) => {
    if (n > 0) issues.push({ severity: 'aviso', code: 'coordenada_invalida', message: `${n} coordenada(s) inválida(s) ignorada(s).`, placemark: idx });
  };
  const walk = (node: Record<string, unknown>) => {
    for (const p of arr<Record<string, unknown>>(node['Point'])) {
      const { coords, bad } = parseCoords(text(p['coordinates']));
      warnBad(bad);
      if (coords[0]) out.push({ type: 'Point', coordinates: coords[0] });
    }
    for (const l of arr<Record<string, unknown>>(node['LineString'])) {
      const { coords, bad } = parseCoords(text(l['coordinates']));
      warnBad(bad);
      if (coords.length >= 2) out.push({ type: 'LineString', coordinates: coords });
    }
    for (const poly of arr<Record<string, unknown>>(node['Polygon'])) {
      const rings: Coord[][] = [];
      const outer = arr<Record<string, unknown>>(poly['outerBoundaryIs'])[0];
      const ring = arr<Record<string, unknown>>(outer?.['LinearRing'])[0];
      if (ring) {
        const { coords, bad } = parseCoords(text(ring['coordinates']));
        warnBad(bad);
        if (coords.length >= 4) rings.push(coords);
      }
      for (const inner of arr<Record<string, unknown>>(poly['innerBoundaryIs'])) {
        const r = arr<Record<string, unknown>>(inner['LinearRing'])[0];
        if (r) {
          const { coords } = parseCoords(text(r['coordinates']));
          if (coords.length >= 4) rings.push(coords);
        }
      }
      if (rings.length) out.push({ type: 'Polygon', coordinates: rings });
    }
    for (const mg of arr<Record<string, unknown>>(node['MultiGeometry'])) walk(mg);
  };
  walk(pm);
  if (pm['Track'] || pm['MultiTrack']) {
    issues.push({ severity: 'aviso', code: 'geometria_nao_suportada', message: 'Trilha (gx:Track) não é suportada e foi ignorada.', placemark: idx });
  }
  return out;
}

const BLOCK_END = /<\/(p|div|tr|li|h[1-6]|table)>|<br\s*\/?>/gi;

/** Extrai pares chave/valor de uma descrição HTML (tabela ou "Chave: valor"). */
export function parseDescription(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!html) return out;
  const rows = html.matchAll(/<tr[^>]*>\s*<t[dh][^>]*>([\s\S]*?)<\/t[dh]>\s*<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi);
  const strip = (s: string) => decodeEntities(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  for (const m of rows) {
    const k = strip(m[1] ?? '');
    const v = strip(m[2] ?? '');
    if (k && !(k in out)) out[k] = v;
  }
  const plain = decodeEntities(html.replace(BLOCK_END, '\n').replace(/<[^>]+>/g, ' '));
  for (const line of plain.split(/\n+/)) {
    const m = /^\s*([^:=\n]{2,40})\s*[:=]\s*(.+?)\s*$/.exec(line);
    if (m && m[1] && m[2]) {
      const k = m[1].replace(/\s+/g, ' ').trim();
      if (!(k in out)) out[k] = m[2].trim();
    }
  }
  return out;
}

export function parseKml(xml: string, extraIssues: Issue[] = []): RawKml {
  const issues: Issue[] = [...extraIssues];
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new ImportError('xml_dtd_proibido', 'O arquivo usa DOCTYPE/ENTITY, que não é aceito por segurança.');
  }
  if (XMLValidator.validate(xml) !== true) throw new ImportError('xml_invalido', 'O arquivo não é um XML válido.');
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml) as Record<string, unknown>;
  } catch {
    throw new ImportError('xml_invalido', 'O arquivo não é um XML válido.');
  }
  const kml = doc['kml'] as Record<string, unknown> | undefined;
  if (!kml || typeof kml !== 'object') throw new ImportError('kml_invalido', 'O arquivo não parece ser um KML (elemento <kml> ausente).');

  const placemarks: RawPlacemark[] = [];
  const folders: string[][] = [];
  let index = 0;

  const visit = (node: Record<string, unknown>, path: string[]) => {
    for (const pm of arr<Record<string, unknown>>(node['Placemark'])) {
      const i = index++;
      const structured: Record<string, string> = {};
      const ext = arr<Record<string, unknown>>(pm['ExtendedData'])[0];
      for (const d of arr<Record<string, unknown>>(ext?.['Data'])) {
        const k = decodeEntities(String(d['@_name'] ?? '')).trim();
        if (k && !(k in structured)) structured[k] = text(d['value']).trim();
      }
      for (const sd of arr<Record<string, unknown>>(ext?.['SchemaData'])) {
        for (const s of arr<Record<string, unknown>>(sd['SimpleData'])) {
          const k = decodeEntities(String(s['@_name'] ?? '')).trim();
          if (k && !(k in structured)) structured[k] = text(s).trim();
        }
      }
      const description = text(pm['description']);
      const fromDesc = parseDescription(description);
      // Evita duplicar a mesma informação: o estruturado prevalece.
      const structuredKeys = new Set(Object.keys(structured).map(normalizeKey));
      const fromDescription: Record<string, string> = {};
      for (const [k, v] of Object.entries(fromDesc)) if (!structuredKeys.has(normalizeKey(k))) fromDescription[k] = v;

      const when = text(arr<Record<string, unknown>>(pm['TimeStamp'])[0]?.['when']) || text(arr<Record<string, unknown>>(pm['TimeSpan'])[0]?.['begin']);
      const geometries = readGeometries(pm, issues, i);
      if (geometries.length === 0) issues.push({ severity: 'aviso', code: 'sem_coordenadas', message: `Registro "${text(pm['name']) || i}" sem coordenadas.`, placemark: i });

      placemarks.push({
        index: i,
        name: text(pm['name']).trim(),
        folderPath: path,
        geometries,
        structured,
        fromDescription,
        description,
        timestamp: when || null,
        sourceId: (pm['@_id'] as string | undefined) ?? null,
      });
    }
    // <Document> é só um contêiner (seu nome não vira pasta/localidade)
    for (const doc of arr<Record<string, unknown>>(node['Document'])) visit(doc, path);
    for (const container of arr<Record<string, unknown>>(node['Folder'])) {
      const name = text(container['name']).trim() || '(sem nome)';
      const next = [...path, name];
      folders.push(next);
      visit(container, next);
    }
  };
  visit(kml, []);

  if (kml['NetworkLink']) issues.push({ severity: 'aviso', code: 'networklink_ignorado', message: 'NetworkLink ignorado (não buscamos dados externos).' });
  if (placemarks.length === 0) issues.push({ severity: 'erro', code: 'sem_registros', message: 'Nenhum registro (Placemark) encontrado no arquivo.' });
  return { placemarks, folders, issues };
}

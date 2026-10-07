import { ImportError, extractKmlFromKmz, looksLikeXml, looksLikeZip, DEFAULT_LIMITS, type ArchiveLimits } from './kmz.js';
import { decodeXmlBytes, parseKml } from './kml.js';
import { parseToFeatures } from './normalize.js';
import type { FieldMapping, Issue, ParseResult } from './types.js';

export * from './types.js';
export { ImportError } from './kmz.js';
export { normalizeName } from './text.js';

/** Interpreta bytes de um KML ou KMZ. Lança ImportError para arquivos inválidos. */
export function parseKmlOrKmz(bytes: Uint8Array, mapping: FieldMapping = {}, limits: ArchiveLimits = DEFAULT_LIMITS): ParseResult {
  if (bytes.length === 0) throw new ImportError('arquivo_vazio', 'O arquivo está vazio.');
  if (bytes.length > limits.maxFileBytes) throw new ImportError('arquivo_grande', 'O arquivo excede o tamanho máximo permitido.');
  const issues: Issue[] = [];
  let kmlBytes: Uint8Array;
  if (looksLikeZip(bytes)) {
    kmlBytes = extractKmlFromKmz(bytes, limits).kml;
  } else if (looksLikeXml(bytes)) {
    kmlBytes = bytes;
  } else {
    throw new ImportError('formato_invalido', 'O conteúdo não é um KML nem um KMZ.');
  }
  const xml = decodeXmlBytes(kmlBytes, issues);
  const raw = parseKml(xml, issues);
  return parseToFeatures(raw, mapping);
}

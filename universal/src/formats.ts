/** Formatos de arquivo conhecidos: a lista que o seletor de arquivo, a mensagem de erro e a prévia usam. A leitura de cada um está em parse.ts. */
export interface FormatDef {
  exts: string[];
  label: string;
  /** o conteúdo é texto: permite escolher a codificação na prévia */
  textual?: boolean;
  /** tem separador de colunas */
  delimited?: boolean;
  /** aceito no seletor só para dar uma orientação (não é lido) */
  legacy?: boolean;
}

export const FORMATS: FormatDef[] = [
  { exts: ['csv', 'tsv', 'txt'], label: 'CSV', textual: true, delimited: true },
  { exts: ['xlsx'], label: 'XLSX' },
  { exts: ['json'], label: 'JSON', textual: true },
  { exts: ['geojson'], label: 'GeoJSON', textual: true },
  { exts: ['kml'], label: 'KML', textual: true },
  { exts: ['kmz'], label: 'KMZ' },
  { exts: ['pdf'], label: 'PDF' },
  { exts: ['docx'], label: 'DOCX' },
  { exts: ['doc'], label: 'DOC', legacy: true },
];

const find = (ext: string) => FORMATS.find((f) => f.exts.includes(ext.toLowerCase()));
export const acceptAttr = (): string => FORMATS.flatMap((f) => f.exts.map((e) => `.${e}`)).join(',');
export const supportedList = (): string => FORMATS.filter((f) => !f.legacy).map((f) => f.label).join(', ');
export const isTextual = (ext: string): boolean => !!find(ext)?.textual;
export const isDelimited = (ext: string): boolean => !!find(ext)?.delimited;

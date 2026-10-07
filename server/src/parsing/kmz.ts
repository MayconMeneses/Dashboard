import { unzipSync } from 'fflate';

export class ImportError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface ArchiveLimits {
  maxFileBytes: number;
  maxEntries: number;
  maxUncompressedBytes: number;
  maxRatio: number;
}

export const DEFAULT_LIMITS: ArchiveLimits = {
  maxFileBytes: 25 * 1024 * 1024,
  maxEntries: 200,
  maxUncompressedBytes: 100 * 1024 * 1024,
  maxRatio: 200,
};

const FORBIDDEN_EXT = /\.(exe|dll|bat|cmd|com|scr|msi|sh|ps1|vbs|js|jar|php|py|so|dylib)$/i;

export function looksLikeZip(buf: Uint8Array): boolean {
  return buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 3 || buf[2] === 5);
}

function head(buf: Uint8Array, n = 512): string {
  return new TextDecoder('latin1').decode(buf.subarray(0, n));
}

export function looksLikeXml(buf: Uint8Array): boolean {
  const s = head(buf).replace(/^(\uFEFF|\u00EF\u00BB\u00BF)/, '').trimStart();
  return s.startsWith('<?xml') || s.startsWith('<kml') || s.startsWith('<');
}

function isUnsafePath(name: string): boolean {
  const n = name.replace(/\\/g, '/');
  return n.startsWith('/') || /^[a-zA-Z]:/.test(n) || n.split('/').includes('..') || n.includes('\0');
}

/**
 * Abre um KMZ com limites: número de entradas, tamanho descompactado total
 * (declarado no cabeçalho do ZIP, verificado ANTES de descompactar), razão de
 * compressão, caminhos suspeitos e extensões executáveis.
 * Retorna o KML principal (doc.kml ou o primeiro .kml).
 */
export function extractKmlFromKmz(buf: Uint8Array, limits: ArchiveLimits = DEFAULT_LIMITS): { kml: Uint8Array; entryName: string } {
  let total = 0;
  let entries = 0;
  const wanted: string[] = [];
  const names: { name: string; size: number }[] = [];
  try {
    unzipSync(buf, {
      filter(file) {
        entries++;
        if (entries > limits.maxEntries) throw new ImportError('kmz_muitas_entradas', 'O KMZ tem arquivos demais.');
        if (isUnsafePath(file.name)) throw new ImportError('kmz_caminho_invalido', 'O KMZ contém caminhos inválidos.');
        if (FORBIDDEN_EXT.test(file.name)) throw new ImportError('kmz_arquivo_proibido', `O KMZ contém um arquivo não permitido: ${file.name}.`);
        total += file.originalSize;
        if (total > limits.maxUncompressedBytes) throw new ImportError('kmz_muito_grande', 'O conteúdo descompactado do KMZ é grande demais.');
        if (file.size > 0 && file.originalSize / file.size > limits.maxRatio && file.originalSize > 1024 * 1024) {
          throw new ImportError('kmz_razao_suspeita', 'O KMZ tem taxa de compressão suspeita.');
        }
        names.push({ name: file.name, size: file.originalSize });
        const isKml = /\.kml$/i.test(file.name) && !file.name.endsWith('/');
        if (isKml) wanted.push(file.name);
        return false; // só decidimos depois; nada é descompactado nesta passada
      },
    });
  } catch (e) {
    if (e instanceof ImportError) throw e;
    throw new ImportError('kmz_invalido', 'Não foi possível abrir o KMZ. O arquivo pode estar corrompido.');
  }
  if (wanted.length === 0) throw new ImportError('kmz_sem_kml', 'O KMZ não contém nenhum arquivo .kml.');
  const main = wanted.find((n) => n.toLowerCase() === 'doc.kml') ?? wanted.sort((a, b) => a.length - b.length)[0]!;
  let out: Record<string, Uint8Array>;
  try {
    out = unzipSync(buf, { filter: (f) => f.name === main });
  } catch {
    throw new ImportError('kmz_invalido', 'Não foi possível abrir o KMZ. O arquivo pode estar corrompido.');
  }
  const kml = out[main];
  if (!kml) throw new ImportError('kmz_sem_kml', 'O KMZ não contém nenhum arquivo .kml.');
  return { kml, entryName: main };
}

import { parquetMetadata, parquetReadObjects } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';
import type { Cell, Row, Table } from './types.js';

const MAX_ROWS = 200_000;
const fmt = (n: number) => new Intl.NumberFormat('pt-BR').format(n);

/** Valor lido do Parquet → célula do painel. Inteiro de 64 bits vira número quando cabe (senão texto); estruturas viram JSON; binário vira marca. */
function celula(v: unknown): Cell {
  if (v == null) return null;
  if (typeof v === 'bigint') return Number.isSafeInteger(Number(v)) ? Number(v) : v.toString();
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' || typeof v === 'boolean') return v;
  if (v instanceof Uint8Array || v instanceof ArrayBuffer) return '[binário]';
  try {
    return JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));
  } catch {
    return String(v);
  }
}

/**
 * Lê um arquivo Parquet inteiro na memória (nada sai do computador) como uma tabela. Lê no máximo `maxRows` linhas e avisa das restantes.
 * Geometrias de GeoParquet (WKB) não são desenhadas: a coluna aparece como “[binário]”.
 */
export async function parquetToTable(name: string, bytes: Uint8Array, maxRows = MAX_ROWS): Promise<Table> {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  let total: number;
  let geo = false;
  try {
    const meta = parquetMetadata(buf);
    total = Number(meta.num_rows);
    geo = !!meta.key_value_metadata?.some((k) => k.key === 'geo');
  } catch {
    throw new Error('Arquivo Parquet inválido ou corrompido.');
  }
  let objs: Record<string, unknown>[];
  try {
    objs = await parquetReadObjects({ file: buf, compressors, rowEnd: Math.min(total, maxRows) });
  } catch (e) {
    throw new Error(`Não foi possível ler o arquivo Parquet: ${e instanceof Error ? e.message : 'formato não suportado'}.`);
  }
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const o of objs.slice(0, 200))
    for (const k of Object.keys(o)) {
      if (seen.has(k)) continue;
      seen.add(k);
      columns.push(k);
    }
  const rows: Row[] = objs.map((o) => Object.fromEntries(columns.map((c) => [c, celula(o[c])])));
  const truncated = Math.max(0, total - rows.length);
  const notes = [`Parquet lido na memória do seu computador: ${fmt(total)} linha(s), ${columns.length} coluna(s).`];
  if (truncated) notes.push(`O arquivo tem ${fmt(total)} linhas; só as primeiras ${fmt(rows.length)} foram lidas. As ${fmt(truncated)} restantes ficaram de fora dos números e gráficos.`);
  if (geo) notes.push('Arquivo GeoParquet: as geometrias (WKB) não são desenhadas no mapa; a coluna aparece como “[binário]”.');
  return { name, columns, rows, notes, stats: { dropped: 0, truncated } };
}

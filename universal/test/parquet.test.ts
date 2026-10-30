// Leitura de Parquet (hyparquet, 100% local): arquivos gerados no teste com hyparquet-writer; valores calculados à mão.
import { parquetWriteBuffer } from 'hyparquet-writer';
import { describe, expect, it } from 'vitest';
import { parquetToTable } from '../src/parquet.js';
import { parseFile } from '../src/parse.js';
import { profileTable } from '../src/profile.js';
import { kpis } from '../src/suggest.js';

const bytes = (codec?: string) =>
  new Uint8Array(
    parquetWriteBuffer({
      ...(codec ? { codec } : {}),
      columnData: [
        { name: 'uf', data: ['SP', 'RJ', 'MG', 'SP', 'RJ', 'MG', 'SP', 'RJ', 'MG', 'SP', 'RJ', 'MG'], type: 'STRING' },
        { name: 'valor', data: [10.5, 20, null, 5, 7, 9, 1, 2, 3, 4, 5, 6], type: 'DOUBLE' },
        { name: 'qtd', data: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], type: 'INT32' },
        { name: 'grande', data: [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n, 10n, 11n, 9_000_000_000_000_000_000n], type: 'INT64' },
        { name: 'ativo', data: [true, false, true, true, false, true, true, false, true, true, false, true], type: 'BOOLEAN' },
      ],
    } as never),
  );

describe('Parquet', () => {
  it('lê colunas e valores; nulo continua nulo (não vira zero); inteiro de 64 bits vira número, ou texto se não couber', async () => {
    const t = await parquetToTable('dados', bytes());
    expect(t.columns).toEqual(['uf', 'valor', 'qtd', 'grande', 'ativo']);
    expect(t.rows).toHaveLength(12);
    expect(t.rows[0]).toMatchObject({ uf: 'SP', valor: 10.5, qtd: 1, grande: 1, ativo: true });
    expect(t.rows[2]!.valor).toBeNull();
    expect(typeof t.rows[11]!.grande).toBe('string');
    expect(t.rows[11]!.grande).toBe('9000000000000000000');
  });
  it('sem compressão e com a compressão padrão dão o mesmo resultado', async () => {
    const a = await parquetToTable('a', bytes('UNCOMPRESSED'));
    const b = await parquetToTable('b', bytes());
    expect(a.rows).toEqual(b.rows);
  });
  it('passa pelo caminho normal de arquivos: perfil, soma sem os nulos (10,5+20+5+7+9+1+2+3+4+5+6 = 72,5) e indicador', async () => {
    const ds = await parseFile('dados.parquet', bytes());
    const t = ds.tables[0]!;
    expect(ds.info!.format).toBe('parquet');
    const p = profileTable(t);
    expect(p.find((c) => c.name === 'valor')!.sum).toBeCloseTo(72.5, 9);
    expect(p.find((c) => c.name === 'valor')!.missing).toBe(1);
    expect(kpis(t, p).some((k) => k.label.startsWith('Total de'))).toBe(true);
  });
  it('limite de linhas: lê só o começo e avisa das restantes', async () => {
    const t = await parquetToTable('dados', bytes(), 5);
    expect(t.rows).toHaveLength(5);
    expect(t.stats!.truncated).toBe(7);
    expect((t.notes ?? []).join(' ')).toMatch(/só as primeiras 5/);
  });
  it('arquivo que não é Parquet é recusado com mensagem clara', async () => {
    await expect(parquetToTable('x', new TextEncoder().encode('isto não é parquet'))).rejects.toThrow(/inválido ou corrompido/);
    await expect(parseFile('x.parquet', new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).rejects.toThrow(/Parquet/);
  });
  it('arquivo cortado no meio (sem o rodapé) é recusado', async () => {
    const b = bytes();
    await expect(parquetToTable('x', b.subarray(0, Math.floor(b.length / 2)))).rejects.toThrow(/Parquet/);
  });
});

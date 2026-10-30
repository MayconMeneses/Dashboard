// ZIP com tamanho declarado falso (KMZ, DOCX, XLSX): o limite vale para o que é entregue de verdade, não para o que o arquivo diz (dados sintéticos).
import { readFileSync } from 'node:fs';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { docxToMatrix } from '../src/docx.js';
import { parseFile } from '../src/parse.js';
import { conferirTamanhosDeclarados, lerEntradaLimitada } from '../src/zipSeguro.js';

/** Troca, no ZIP, o tamanho descompactado declarado (cabeçalho local e diretório central) por `falso`. */
function mentir(zip: Uint8Array, falso: number): Uint8Array {
  const z = new Uint8Array(zip);
  const dv = new DataView(z.buffer);
  for (let i = 0; i + 30 < z.length; i++) {
    const sig = dv.getUint32(i, true);
    if (sig === 0x04034b50) dv.setUint32(i + 22, falso, true);
    if (sig === 0x02014b50) dv.setUint32(i + 24, falso, true);
  }
  return z;
}
const MB = 1024 * 1024;
const espacos = (n: number) => new Uint8Array(n).fill(32);

describe('lerEntradaLimitada', () => {
  it('devolve o conteúdo exato de uma entrada pequena e null se não existe', () => {
    const z = zipSync({ 'a.txt': strToU8('olá'), 'b.txt': strToU8('mundo') });
    expect(new TextDecoder().decode(lerEntradaLimitada(z, (n) => n === 'b.txt', MB)!)).toBe('mundo');
    expect(lerEntradaLimitada(z, (n) => n === 'c.txt', MB)).toBeNull();
  });
  it('entrada sem compressão (armazenada) também funciona', () => {
    const z = zipSync({ 'a.txt': [strToU8('sem compressão'), { level: 0 }] });
    expect(new TextDecoder().decode(lerEntradaLimitada(z, () => true, MB)!)).toBe('sem compressão');
  });
  it('conteúdo honesto acima do limite é recusado', () => {
    const z = zipSync({ 'doc.kml': espacos(20 * MB) }, { level: 9 });
    expect(() => lerEntradaLimitada(z, () => true, 5 * MB)).toThrow(/passa de 5 MB/);
  }, 60000);
  it('tamanho declarado falso (diz 100 bytes, entrega 120 MB) é recusado depressa', () => {
    const z = mentir(zipSync({ 'doc.kml': espacos(120 * MB) }, { level: 9 }), 100);
    const t0 = Date.now();
    expect(() => lerEntradaLimitada(z, () => true, 50 * MB)).toThrow(/passa de 50 MB/);
    expect(Date.now() - t0).toBeLessThan(3000);
  }, 60000);
  it('outras entradas, mesmo gigantes, nunca são descompactadas', () => {
    const z = zipSync({ 'doc.kml': strToU8('<kml/>'), 'enorme.bin': espacos(200 * MB) }, { level: 9 });
    const t0 = Date.now();
    expect(new TextDecoder().decode(lerEntradaLimitada(z, (n) => n === 'doc.kml', MB)!)).toBe('<kml/>');
    expect(Date.now() - t0).toBeLessThan(1500);
  }, 60000);
});

describe('arquivos reais que usam o ZIP', () => {
  it('KMZ que mente sobre o tamanho é recusado (antes, era descompactado inteiro)', async () => {
    const z = mentir(zipSync({ 'doc.kml': espacos(120 * MB) }, { level: 9 }), 100);
    await expect(parseFile('mentira.kmz', z)).rejects.toThrow(/passa de 50 MB/);
  }, 60000);
  it('KMZ legítimo continua abrindo', async () => {
    const kml = '<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>A</name><Point><coordinates>-40,-4</coordinates></Point></Placemark></Document></kml>';
    const ds = await parseFile('ok.kmz', zipSync({ 'doc.kml': strToU8(kml) }));
    expect(ds.tables[0]!.rows).toHaveLength(1);
  });
  it('DOCX que mente sobre o tamanho do documento é recusado', () => {
    const xml = '<w:document xmlns:w="w"><w:body>' + ' '.repeat(100 * MB) + '</w:body></w:document>';
    const z = mentir(zipSync({ 'word/document.xml': strToU8(xml) }, { level: 9 }), 100);
    expect(() => docxToMatrix(z)).toThrow(/passa de 60 MB/);
  }, 60000);
});

describe('XLSX', () => {
  const base = () => unzipSync(new Uint8Array(readFileSync(new URL('./fixtures/planilha.xlsx', import.meta.url))));
  it('planilha legítima continua abrindo', async () => {
    const ds = await parseFile('planilha.xlsx', new Uint8Array(readFileSync(new URL('./fixtures/planilha.xlsx', import.meta.url))));
    expect(ds.tables.length).toBeGreaterThan(0);
  });
  it('parte de 70 MB (acima do limite de 60 MB) é recusada na hora; com 150 MB a leitura antiga travava por mais de um minuto e falhava', async () => {
    const b = base();
    const folha = Object.keys(b).find((n) => n.startsWith('xl/worksheets/sheet'))!;
    const grande = espacos(70 * MB);
    grande.set(b[folha]!, 0);
    const z = zipSync({ ...b, [folha]: grande }, { level: 9 });
    const t0 = Date.now();
    await expect(parseFile('grande.xlsx', z)).rejects.toThrow(/Arquivo recusado/);
    expect(Date.now() - t0).toBeLessThan(5000);
  }, 60000);
  it('conferirTamanhosDeclarados: soma acima do total também é recusada', () => {
    const z = zipSync({ 'a.bin': espacos(3 * MB), 'b.bin': espacos(3 * MB) }, { level: 9 });
    expect(() => conferirTamanhosDeclarados(z, 4 * MB, 5 * MB)).toThrow(/no total/);
    expect(() => conferirTamanhosDeclarados(z, 4 * MB, 10 * MB)).not.toThrow();
  });
});

// Fase 7: a lista de formatos é uma só (seletor de arquivo, mensagem de erro e prévia) e todo formato listado é lido por parseFile.
import { describe, expect, it } from 'vitest';
import { acceptAttr, FORMATS, isDelimited, isTextual, supportedList } from '../src/formats.js';
import { parseFile } from '../src/parse.js';

describe('formatos', () => {
  it('todo formato listado tem leitura em parseFile (nenhum cai em “não suportado”)', async () => {
    for (const ext of FORMATS.filter((f) => !f.legacy).flatMap((f) => f.exts)) {
      const msg = await parseFile(`x.${ext}`, new Uint8Array([32])).then(() => '', (e: Error) => e.message);
      expect(msg, ext).not.toMatch(/não suportado\. Use/);
    }
  });
  it('formato fora da lista cita os formatos aceitos a partir da mesma lista', async () => {
    const msg = await parseFile('x.zzz', new Uint8Array([1])).then(() => '', (e: Error) => e.message);
    expect(msg).toContain(supportedList());
    expect(supportedList()).toContain('PDF');
    expect(supportedList()).toContain('DOCX');
  });
  it('o seletor aceita tudo o que está na lista e a prévia usa as mesmas marcas', () => {
    for (const f of FORMATS) for (const e of f.exts) expect(acceptAttr()).toContain(`.${e}`);
    expect(isTextual('csv')).toBe(true);
    expect(isTextual('xlsx')).toBe(false);
    expect(isDelimited('tsv')).toBe(true);
    expect(isDelimited('json')).toBe(false);
  });
});

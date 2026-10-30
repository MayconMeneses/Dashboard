// Fase 8: segurança de release e exportação (leitura dos arquivos de empacotamento como texto; dados sintéticos).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { FORMATS } from '../src/formats.js';
import { FUNDO_PADRAO_ATE, migrateState, parseProject, serializeProject } from '../src/project.js';
import { buildXlsx } from '../src/xlsx.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const ler = (p: string) => readFileSync(join(RAIZ, p), 'utf8');
const pkg = JSON.parse(ler('package.json')) as { version: string };
const desk = JSON.parse(ler('desktop/package.json')) as { painelVersao: string; build: { fileAssociations: { ext: string[] }[] } };

describe('atualização automática do painel', () => {
  it('o título do painel é o que o programa instalado exige ao baixar uma atualização', () => {
    const exige = /includes\('(<title>[^']+)'\)/.exec(ler('desktop/main.cjs'))?.[1];
    expect(exige, 'main.cjs deve conferir o <title> do arquivo baixado').toBeDefined();
    expect(ler('index.html')).toContain(exige!);
  });
  it('a versão do painel embutido no instalador acompanha a do painel (senão o instalado “atualizaria” para trás)', () => {
    expect(desk.painelVersao).toBe(pkg.version);
  });
  it('o manifesto de atualização publicado não é alterado por esta branch sem decisão (versão <= painel)', () => {
    const m = JSON.parse(ler('atualizacao/versao.json')) as { versao: string };
    const n = (v: string) => v.split('.').map(Number);
    const [a, b] = [n(m.versao), n(pkg.version)];
    const cmp = a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!;
    expect(cmp, `manifesto ${m.versao} vs painel ${pkg.version}: publicar é decisão do dono`).toBeLessThanOrEqual(0);
  });
});

describe('lista de formatos do programa de desktop', () => {
  const todos = FORMATS.flatMap((f) => f.exts).sort();
  it('o diálogo “Abrir arquivo” do Electron conhece todos os formatos', () => {
    const lista = /const EXT = \[([^\]]+)\]/.exec(ler('desktop/main.cjs'))?.[1] ?? '';
    const exts = [...lista.matchAll(/'([a-z]+)'/g)].map((m) => m[1]!).sort();
    expect(exts).toEqual(todos);
  });
  it('associações de arquivo do instalador: só formatos conhecidos; txt e doc ficam de fora de propósito (seriam capturados para todo o Windows)', () => {
    const assoc = desk.build.fileAssociations.flatMap((a) => a.ext).sort();
    expect(assoc.filter((e) => !todos.includes(e))).toEqual([]);
    expect(todos.filter((e) => !assoc.includes(e))).toEqual(['doc', 'txt']);
  });
});

describe('preferências de projetos de versões anteriores', () => {
  const estado = { basemap: 'esri' as const, filters: { uf: 'SP' } };
  it('projeto salvo pela 0.7.5 com Esri: abre sem fundo e avisa', () => {
    const r = migrateState(estado, '0.7.5');
    expect(r.estado.basemap).toBe('none');
    expect(r.estado.filters).toEqual({ uf: 'SP' });
    expect(r.migrado.join(' ')).toMatch(/Esri/);
  });
  it('sem versão gravada conta como antigo', () => {
    expect(migrateState(estado, '').estado.basemap).toBe('none');
  });
  it('projeto da versão atual com Esri escolhida continua com Esri', () => {
    const r = migrateState(estado, FUNDO_PADRAO_ATE);
    expect(r.estado.basemap).toBe('esri');
    expect(r.migrado).toEqual([]);
  });
  it('sem fundo continua sem fundo e nada é avisado', () => {
    expect(migrateState({ basemap: 'none' }, '0.7.0')).toEqual({ estado: { basemap: 'none' }, migrado: [] });
  });
  it('a migração acontece ao abrir o arquivo do projeto', () => {
    const txt = serializeProject({ salvoEm: '2026-01-01', painel: '0.7.5', origem: { arquivo: 'a.csv' }, leitura: {}, estado });
    const p = parseProject(txt);
    expect(p.estado.basemap).toBe('none');
    expect(p.migrado?.length).toBe(1);
  });
});

describe('exportação segura', () => {
  it('Excel: texto que parece fórmula é gravado como texto, nunca como fórmula', () => {
    const perigosos = ['=HYPERLINK("http://exemplo.invalido","x")', '+1+1', '-2+3', '@SUM(1)', '=cmd|\' /C calc\'!A0'];
    const zip = unzipSync(buildXlsx([{ name: 'Dados', columns: ['texto'], rows: perigosos.map((p) => [p]) }]));
    const xml = strFromU8(zip['xl/worksheets/sheet1.xml']!);
    expect(xml).not.toMatch(/<f[ >]/);
    expect((xml.match(/t="inlineStr"/g) ?? []).length).toBe(perigosos.length + 1); // + cabeçalho
    expect(xml).toContain('&quot;');
  });
});

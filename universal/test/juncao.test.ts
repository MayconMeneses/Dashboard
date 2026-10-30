// Fase 7: junção entre tabelas, vários arquivos, persistência da junção e contagem de pontos por polígono (dados sintéticos; valores calculados à mão).
import { describe, expect, it } from 'vitest';
import { applyJoins, analyzeJoin, joinTables, mergeDatasets, stripJoined } from '../src/join/join.js';
import type { JoinSpec } from '../src/join/join.js';
import { countPointsIn } from '../src/join/spatial.js';
import type { Geometry } from '../src/geo/geometry.js';
import type { Dataset, Row, Table } from '../src/types.js';

const T = (name: string, columns: string[], rows: Row[], extra: Partial<Table> = {}): Table => ({ name, columns, rows, ...extra });

// vendas: a chave 0456 aparece 2 vezes; 0999 não existe nos bairros; uma chave vazia
const vendas = () =>
  T('vendas', ['id', 'cod', 'valor'], [
    { id: 'v1', cod: '0123', valor: 100 },
    { id: 'v2', cod: '0456', valor: 200 },
    { id: 'v3', cod: '0456', valor: 50 },
    { id: 'v4', cod: '0999', valor: 70 },
    { id: 'v5', cod: null, valor: 10 },
  ]);
// bairros: chaves únicas; 0777 só existe aqui; uma chave vazia
const bairros = () =>
  T('bairros', ['cod', 'pop', 'nome'], [
    { cod: '0123', pop: 1000, nome: 'A' },
    { cod: '0456', pop: 2000, nome: 'B' },
    { cod: '0777', pop: 3000, nome: 'C' },
    { cod: null, pop: 1, nome: 'N' },
  ]);
const spec = (o: Partial<JoinSpec> = {}): JoinSpec => ({ kind: 'chave', left: 'vendas', right: 'bairros', leftKey: 'cod', rightKey: 'cod', how: 'left', ...o });

describe('análise da junção (muitos para um)', () => {
  const a = analyzeJoin(vendas(), bairros(), spec());
  it('cardinalidade e contagens', () => {
    expect(a.cardinality).toBe('N:1');
    expect(a.matched).toBe(3); // v1, v2, v3
    expect(a.unmatchedLeft).toBe(2); // v4 (0999) e v5 (vazia)
    expect(a.unmatchedRight).toBe(1); // 0777
    expect(a.nullLeft).toBe(1);
    expect(a.nullRight).toBe(1);
    expect(a.resultRows).toBe(5);
    expect(a.examplesLeft).toEqual(['0999']);
    expect(a.examplesRight).toEqual(['0777']);
  });
  it('avisa que a medida do lado “um” se repete e somar superestima', () => {
    expect(a.warnings.join(' ')).toMatch(/“pop” se repete em até 2 linhas/);
    expect(a.blockers).toEqual([]);
  });
  it('junção interna só tem as linhas com par', () => {
    expect(analyzeJoin(vendas(), bairros(), spec({ how: 'inner' })).resultRows).toBe(3);
  });
});

describe('análise da junção (um para muitos e muitos para muitos)', () => {
  const esq = () => T('vendas', ['id', 'cod', 'valor'], [{ id: 'v1', cod: '0123', valor: 100 }, { id: 'v2', cod: '0777', valor: 200 }]);
  const dir = () => T('bairros', ['cod', 'pop'], [{ cod: '0123', pop: 1000 }, { cod: '0777', pop: 3000 }, { cod: '0777', pop: 3500 }]);
  it('1:N multiplica linhas e infla a medida da esquerda (soma 500 em vez de 300)', () => {
    const a = analyzeJoin(esq(), dir(), spec());
    expect(a.cardinality).toBe('1:N');
    expect(a.resultRows).toBe(3);
    expect(a.warnings.join(' ')).toMatch(/“valor” se repete em até 2 linhas/);
    const j = joinTables(esq(), dir(), spec());
    expect(j.rows.reduce((s, r) => s + (r.valor as number), 0)).toBe(500);
    expect((j.notes ?? []).join(' ')).toMatch(/“valor” se repete/);
  });
  it('N:N é apontado como multiplicação', () => {
    const e2 = T('vendas', ['cod', 'valor'], [{ cod: '1', valor: 1 }, { cod: '1', valor: 2 }]);
    const d2 = T('bairros', ['cod', 'pop'], [{ cod: '1', pop: 5 }, { cod: '1', pop: 6 }]);
    const a = analyzeJoin(e2, d2, spec());
    expect(a.cardinality).toBe('N:N');
    expect(a.resultRows).toBe(4);
    expect(a.warnings.join(' ')).toMatch(/muitos para muitos/);
  });
  it('tabela com formas não pode ser multiplicada (polígonos empilhados)', () => {
    const poly: Geometry = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] };
    const comFormas = T('vendas', ['id_geom', 'cod'], [{ id_geom: 'g1', cod: '0777' }], { geo: { lat: 'x', lon: 'y', id: 'id_geom' }, shapes: { g1: poly } });
    const a = analyzeJoin(comFormas, dir(), spec());
    expect(a.blockers.join(' ')).toMatch(/formas/);
  });
});

describe('regras da chave', () => {
  it('compara como texto: 456 (número) casa com “456”', () => {
    const e = T('a', ['k'], [{ k: '456' }]);
    const d = T('b', ['k', 'v'], [{ k: 456, v: 1 }]);
    expect(analyzeJoin(e, d, spec({ left: 'a', right: 'b', leftKey: 'k', rightKey: 'k' })).matched).toBe(1);
  });
  it('zeros à esquerda: não corrige sozinho, só sugere', () => {
    const e = T('a', ['k'], [{ k: '0123' }]);
    const d = T('b', ['k', 'v'], [{ k: 123, v: 1 }]);
    const a = analyzeJoin(e, d, spec({ left: 'a', right: 'b', leftKey: 'k', rightKey: 'k' }));
    expect(a.matched).toBe(0);
    expect(a.hints.join(' ')).toMatch(/zeros à esquerda/);
  });
  it('chave vazia nunca casa com chave vazia', () => {
    const j = joinTables(vendas(), bairros(), spec());
    const v5 = j.rows.find((r) => r.id === 'v5')!;
    expect(v5.pop).toBeNull();
  });
  it('espaços nas pontas não impedem o par', () => {
    const e = T('a', ['k'], [{ k: ' 7 ' }]);
    const d = T('b', ['k', 'v'], [{ k: '7', v: 1 }]);
    expect(analyzeJoin(e, d, spec({ left: 'a', right: 'b', leftKey: 'k', rightKey: 'k' })).matched).toBe(1);
  });
});

describe('resultado da junção', () => {
  it('junção à esquerda mantém todas as linhas e preenche os pares', () => {
    const j = joinTables(vendas(), bairros(), spec());
    expect(j.rows).toHaveLength(5);
    expect(j.rows.find((r) => r.id === 'v2')).toMatchObject({ pop: 2000, nome: 'B' });
    expect(j.rows.find((r) => r.id === 'v4')!.pop).toBeNull();
    expect(j.columns).toEqual(['id', 'cod', 'valor', 'pop', 'nome']);
  });
  it('coluna repetida ganha o nome da tabela da direita e a chave da direita não duplica', () => {
    const d = T('bairros', ['cod', 'valor'], [{ cod: '0123', valor: 9 }]);
    const j = joinTables(vendas(), d, spec());
    expect(j.columns).toEqual(['id', 'cod', 'valor', 'valor (bairros)']);
  });
  it('junção interna descarta as linhas sem par', () => {
    expect(joinTables(vendas(), bairros(), spec({ how: 'inner' })).rows.map((r) => r.id)).toEqual(['v1', 'v2', 'v3']);
  });
  it('mantém as formas da esquerda', () => {
    const poly: Geometry = { type: 'Point', coordinates: [1, 2] };
    const e = T('vendas', ['id_geom', 'cod'], [{ id_geom: 'g1', cod: '0123' }], { geo: { lat: 'x', lon: 'y', id: 'id_geom' }, shapes: { g1: poly } });
    const j = joinTables(e, bairros(), spec());
    expect(j.shapes).toEqual({ g1: poly });
    expect(j.geo?.id).toBe('id_geom');
  });
  it('recusa tabela organizada (tidy) e de texto', () => {
    const tidy = { ...vendas(), tidy: { period: 'a', entity: 'b', label: 'c', value: 'd' } };
    expect(analyzeJoin(tidy, bairros(), spec()).blockers.join(' ')).toMatch(/organizada/);
    expect(analyzeJoin({ ...vendas(), noCharts: true }, bairros(), spec()).blockers.join(' ')).toMatch(/só de texto/);
  });
  it('coluna inexistente vira impedimento, não erro', () => {
    expect(analyzeJoin(vendas(), bairros(), spec({ leftKey: 'nada' })).blockers.join(' ')).toMatch(/não existe/);
  });
});

describe('vários arquivos', () => {
  const ds = (nome: string, tabelas: Table[]): Dataset => ({ fileName: nome, tables: tabelas, info: { format: 'csv', bytes: 10, sha256: 'h-' + nome, rowsRead: tabelas.reduce((s, t) => s + t.rows.length, 0), rowsDropped: 0, truncated: 0, notes: [] } });
  it('nomes de tabela únicos e previsíveis; fontes e linhas somadas', () => {
    const m = mergeDatasets([ds('vendas.csv', [vendas()]), ds('bairros.xlsx', [T('Plan1', ['a'], [{ a: 1 }]), T('Plan2', ['a'], [{ a: 2 }])])]);
    expect(m.tables.map((t) => t.name)).toEqual(['vendas', 'bairros › Plan1', 'bairros › Plan2']);
    expect(m.sources!.map((s) => s.sha256)).toEqual(['h-vendas.csv', 'h-bairros.xlsx']);
    expect(m.info!.rowsRead).toBe(5 + 1 + 1);
    expect(m.fileName).toBe('vendas.csv e mais 1 arquivo(s)');
  });
  it('dois arquivos com o mesmo nome não colidem', () => {
    const m = mergeDatasets([ds('dados.csv', [T('dados', ['a'], [{ a: 1 }])]), ds('dados.csv', [T('dados', ['a'], [{ a: 2 }])])]);
    expect(m.tables.map((t) => t.name)).toEqual(['dados', 'dados (2)']);
  });
  it('um arquivo só devolve o mesmo conjunto, sem alterar', () => {
    const d = ds('vendas.csv', [vendas()]);
    expect(mergeDatasets([d])).toBe(d);
  });
});

describe('persistência da junção', () => {
  const base = (): Dataset => ({ fileName: 'x', tables: [vendas(), bairros()], info: { format: 'csv', bytes: 1, rowsRead: 9, rowsDropped: 0, truncated: 0, notes: [] } });
  it('guarda só a especificação e refaz a junção ao abrir', () => {
    const { ds, dropped } = applyJoins(base(), [spec()]);
    expect(dropped).toEqual([]);
    expect(ds.tables).toHaveLength(3);
    const j = ds.tables[2]!;
    expect(j.joined).toEqual(spec());
    expect(j.rows).toHaveLength(5);
    const { ds: limpo, joins } = stripJoined(ds);
    expect(limpo.tables).toHaveLength(2);
    expect(joins).toEqual([spec()]);
  });
  it('fonte ausente: a junção é descartada com o motivo', () => {
    const so = { ...base(), tables: [vendas()] };
    const r = applyJoins(so, [spec()]);
    expect(r.ds.tables).toHaveLength(1);
    expect(r.dropped.join(' ')).toMatch(/“bairros” não está entre os arquivos abertos/);
  });
  it('junção com impedimento não é refeita', () => {
    const r = applyJoins(base(), [spec({ leftKey: 'nada' })]);
    expect(r.ds.tables).toHaveLength(2);
    expect(r.dropped).toHaveLength(1);
  });
});

describe('pontos dentro de polígonos', () => {
  const quad = (x: number, y: number, w: number): Geometry => ({ type: 'Polygon', coordinates: [[[x, y], [x + w, y], [x + w, y + w], [x, y + w], [x, y]]] });
  const buraco: Geometry = { type: 'Polygon', coordinates: [[[10, 10], [14, 10], [14, 14], [10, 14], [10, 10]], [[10, 10], [12, 10], [12, 12], [10, 12], [10, 10]]] };
  const areas = () => T('areas', ['id_geom', 'nome'], [{ id_geom: 'g1', nome: 'A' }, { id_geom: 'g2', nome: 'B' }, { id_geom: 'g3', nome: 'C' }], { geo: { lat: 'la', lon: 'lo', id: 'id_geom' }, shapes: { g1: quad(0, 0, 2), g2: quad(4, 4, 2), g3: buraco } });
  const pontos = () => T('pontos', ['n', 'latitude', 'longitude'], [
    { n: 1, latitude: 1, longitude: 1 },
    { n: 2, latitude: 0.5, longitude: 1.5 },
    { n: 3, latitude: 5, longitude: 5 },
    { n: 4, latitude: 9, longitude: 9 },
    { n: 5, latitude: 11, longitude: 11 }, // dentro do buraco de C
    { n: 6, latitude: 13, longitude: 13 }, // no corpo de C
    { n: 7, latitude: null, longitude: null },
  ], { geo: { lat: 'latitude', lon: 'longitude' } });
  const sp = (left: string): JoinSpec => ({ kind: 'pontos', left, right: 'pontos', leftKey: '', rightKey: '', how: 'left' });
  it('conta por polígono (A=2, B=1, C=1: o ponto no buraco não conta)', () => {
    const r = countPointsIn(areas(), pontos());
    expect(r.counts).toEqual({ g1: 2, g2: 1, g3: 1 });
    expect(r.outside).toBe(2); // ponto 4 e o ponto no buraco de C
    expect(r.invalid).toBe(1); // ponto 7 sem coordenada
  });
  it('a tabela resultante ganha a coluna com a contagem e mantém as formas', () => {
    const j = joinTables(areas(), pontos(), sp('areas'));
    expect(j.columns).toEqual(['id_geom', 'nome', 'Pontos em pontos']);
    expect(j.rows.map((r) => r['Pontos em pontos'])).toEqual([2, 1, 1]);
    expect(j.shapes).toBeDefined();
  });
  it('sem formas na tabela da esquerda é impedimento', () => {
    expect(analyzeJoin(pontos(), pontos(), sp('pontos')).blockers.join(' ')).toMatch(/polígonos/);
  });
});

import { describe, expect, it } from 'vitest';
import { addMetricColumns, applyRenames, compareTables, migrateColumn, parseProject, reconcileState, serializeProject } from '../src/project.js';
import type { Table } from '../src/types.js';

const t: Table = { name: 't', columns: ['Município', 'Notificados', 'Pop'], rows: [{ Município: 'A', Notificados: 10, Pop: 1000 }, { Município: 'B', Notificados: 5, Pop: null }], geo: undefined };

describe('renomear campos e métricas por linha', () => {
  it('renomeia colunas nas linhas e na estrutura organizada', () => {
    const o = applyRenames({ ...t, tidy: { period: 'Município', entity: 'Notificados', label: 'Pop', value: 'Pop' } }, { Município: 'Cidade', Pop: 'População' });
    expect(o.columns).toEqual(['Cidade', 'Notificados', 'População']);
    expect(o.rows[0]).toEqual({ Cidade: 'A', Notificados: 10, População: 1000 });
    expect(o.tidy).toMatchObject({ period: 'Cidade', value: 'População' });
    expect(applyRenames(t, {})).toBe(t);
    expect(applyRenames(t, { Inexistente: 'X' })).toBe(t);
  });
  it('métrica por linha vira coluna nova e deixa sem dado onde falta insumo; agregada não vira coluna', () => {
    const m = addMetricColumns(t, [{ id: '1', name: 'Taxa', formula: '[Notificados] / [Pop] * 1000' }, { id: '2', name: 'Soma', formula: 'SUM([Notificados])' }, { id: '3', name: 'Ruim', formula: '[Nada] * 2' }]);
    expect(m.columns).toEqual(['Município', 'Notificados', 'Pop', 'Taxa']);
    expect(m.rows.map((r) => r['Taxa'])).toEqual([10, null]);
  });
  it('migra filtros, tipos, junções, período e fórmulas ao renomear', () => {
    const s = migrateColumn({ forced: { Pop: 'text' }, filters: { Pop: '1' }, merges: { Pop: { a: 'b' } }, dateRange: { col: 'Pop', from: '2024-01-01' }, metrics: [{ id: '1', name: 'x', formula: '[Pop] * 2' }] }, 'Pop', 'População');
    expect(s.forced).toEqual({ 'População': 'text' });
    expect(s.filters).toEqual({ 'População': '1' });
    expect(s.dateRange!.col).toBe('População');
    expect(s.metrics![0]!.formula).toBe('[População] * 2');
  });
});

describe('projeto: salvar, abrir e reaplicar a um arquivo atualizado', () => {
  it('descarta o que depende de colunas que não existem mais e diz o que foi descartado', () => {
    const { state, dropped } = reconcileState({ filters: { Município: 'A', Antiga: 'x' }, forced: { Pop: 'text' }, dateRange: { col: 'Data', from: '2024-01-01' }, metrics: [{ id: '1', name: 'ok', formula: '[Pop] * 2' }, { id: '2', name: 'quebra', formula: '[Sumiu] * 2' }] }, ['Município', 'Notificados', 'Pop']);
    expect(state.filters).toEqual({ Município: 'A' });
    expect(state.forced).toEqual({ Pop: 'text' });
    expect(state.dateRange).toEqual({});
    expect(state.metrics!.map((m) => m.name)).toEqual(['ok']);
    expect(dropped.join(' | ')).toMatch(/filtro da coluna “Antiga”.*período da coluna “Data”.*métrica “quebra”/);
  });
  it('serializa e valida o arquivo de projeto', () => {
    const txt = serializeProject({ salvoEm: '2026-10-08', painel: '0.7.0', origem: { arquivo: 'a.xlsx', sha256: 'abc' }, leitura: { encoding: 'UTF-8' }, estado: { filters: { A: 'x' } } });
    const p = parseProject(txt);
    expect(p.origem.arquivo).toBe('a.xlsx');
    expect(p.estado.filters).toEqual({ A: 'x' });
    expect(() => parseProject('não é json')).toThrow(/JSON inválido/);
    expect(() => parseProject('{"tipo":"outro"}')).toThrow(/não é um projeto/);
    expect(() => parseProject(JSON.stringify({ tipo: 'dashboard-universal-projeto', versao: 9, estado: {} }))).toThrow(/mais nova/);
    expect(() => parseProject(JSON.stringify({ tipo: 'dashboard-universal-projeto', versao: 1 }))).toThrow(/sem as configurações/);
  });
});

describe('comparar versões do arquivo', () => {
  it('mostra linhas, colunas, somas e categorias novas ou removidas', () => {
    const cats = (n: string[]) => n.map((c, i) => ({ cidade: c, v: i + 1 }));
    const a: Table = { name: 'a', columns: ['cidade', 'v', 'velha'], rows: [...cats(['A', 'B', 'C', 'A', 'B', 'C', 'A', 'B', 'C', 'A']), ].map((r) => ({ ...r, velha: 1 })) };
    const b: Table = { name: 'b', columns: ['cidade', 'v', 'nova'], rows: [...cats(['A', 'B', 'D', 'A', 'B', 'D', 'A', 'B', 'D', 'A', 'B', 'D']), ].map((r) => ({ ...r, nova: 1 })) };
    const d = compareTables(a, b);
    expect(d.rows).toEqual({ before: 10, after: 12 });
    expect(d.columnsAdded).toEqual(['nova']);
    expect(d.columnsRemoved).toEqual(['velha']);
    expect(d.sums[0]).toMatchObject({ col: 'v', before: 55, after: 78 });
    expect(d.newValues).toEqual([{ col: 'cidade', values: ['D'] }]);
    expect(d.goneValues).toEqual([{ col: 'cidade', values: ['C'] }]);
  });
});

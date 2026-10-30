// Busca de texto, período rápido e ordem dos gráficos: lógica pura (valores calculados à mão).
import { describe, expect, it } from 'vitest';
import { filtrarPorTexto, normalizar, periodoAtual, periodoRapido } from '../src/app/busca.js';
import { aplicarOrdem, moverUma, soltarSobre } from '../src/app/ordem.js';
import type { Row } from '../src/types.js';

const rows: Row[] = [
  { cidade: 'Fortaleza', uf: 'Ceará', valor: 10, data: new Date(Date.UTC(2024, 2, 15)) },
  { cidade: 'São Paulo', uf: 'SP', valor: 20, data: null },
  { cidade: 'Sobral', uf: 'Ceará', valor: 30, data: new Date(Date.UTC(2023, 11, 1)) },
];
const cols = ['cidade', 'uf', 'valor', 'data'];

describe('busca de texto', () => {
  it('ignora acento e caixa', () => {
    expect(normalizar('Ceará')).toBe('ceara');
    expect(filtrarPorTexto(rows, cols, 'CEARA')).toHaveLength(2);
    expect(filtrarPorTexto(rows, cols, 'sao paulo').map((r) => r.cidade)).toEqual(['São Paulo']);
  });
  it('várias palavras: todas precisam aparecer (na mesma linha, em qualquer coluna)', () => {
    expect(filtrarPorTexto(rows, cols, 'ceara sobral').map((r) => r.cidade)).toEqual(['Sobral']);
    expect(filtrarPorTexto(rows, cols, 'ceara paulo')).toEqual([]);
  });
  it('acha número e data nos dois formatos (aaaa-mm-dd e dd/mm/aaaa)', () => {
    expect(filtrarPorTexto(rows, cols, '15/03/2024').map((r) => r.cidade)).toEqual(['Fortaleza']);
    expect(filtrarPorTexto(rows, cols, '2023-12-01').map((r) => r.cidade)).toEqual(['Sobral']);
    expect(filtrarPorTexto(rows, cols, '20').map((r) => r.cidade)).toContain('São Paulo');
  });
  it('termo vazio ou só espaços devolve as mesmas linhas, sem copiar', () => {
    expect(filtrarPorTexto(rows, cols, '')).toBe(rows);
    expect(filtrarPorTexto(rows, cols, '   ')).toBe(rows);
  });
  it('célula vazia não casa com nada', () => {
    expect(filtrarPorTexto(rows, cols, 'null')).toEqual([]);
  });
});

describe('período rápido (a partir da data mais recente dos dados)', () => {
  const max = Date.UTC(2024, 5, 15); // 15/06/2024
  it('30 e 90 dias contam o próprio dia final', () => {
    expect(periodoRapido('30d', max)).toEqual({ from: '2024-05-17', to: '2024-06-15' });
    expect(periodoRapido('90d', max)).toEqual({ from: '2024-03-18', to: '2024-06-15' });
  });
  it('12 meses, este ano e ano anterior', () => {
    expect(periodoRapido('12m', max)).toEqual({ from: '2023-06-16', to: '2024-06-15' });
    expect(periodoRapido('ano', max)).toEqual({ from: '2024-01-01', to: '2024-06-15' });
    expect(periodoRapido('anoAnt', max)).toEqual({ from: '2023-01-01', to: '2023-12-31' });
    expect(periodoRapido('tudo', max)).toEqual({});
  });
  it('o seletor reconhece o modelo ativo e cai em “personalizado” fora deles', () => {
    expect(periodoAtual({}, max)).toBe('tudo');
    expect(periodoAtual(periodoRapido('90d', max), max)).toBe('90d');
    expect(periodoAtual({ from: '2024-02-01', to: '2024-02-10' }, max)).toBe('custom');
  });
});

describe('ordem dos gráficos', () => {
  const specs = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
  it('aplica a ordem salva; gráficos novos vão depois, na ordem original', () => {
    expect(aplicarOrdem(specs, ['c', 'a']).map((s) => s.id)).toEqual(['c', 'a', 'b', 'd']);
    expect(aplicarOrdem(specs, ['x', 'd', 'b']).map((s) => s.id)).toEqual(['d', 'b', 'a', 'c']);
    expect(aplicarOrdem(specs, [])).toBe(specs);
  });
  it('mover uma posição; nas pontas não faz nada', () => {
    expect(moverUma(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(moverUma(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b']);
    expect(moverUma(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c']);
    expect(moverUma(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c']);
  });
  it('soltar sobre outro cartão: antes (metade de cima) ou depois (metade de baixo)', () => {
    expect(soltarSobre(['a', 'b', 'c', 'd'], 'd', 'b', false)).toEqual(['a', 'd', 'b', 'c']);
    expect(soltarSobre(['a', 'b', 'c', 'd'], 'a', 'c', true)).toEqual(['b', 'c', 'a', 'd']);
    expect(soltarSobre(['a', 'b'], 'a', 'a', true)).toEqual(['a', 'b']);
    expect(soltarSobre(['a', 'b'], 'z', 'a', true)).toEqual(['a', 'b']);
  });
});

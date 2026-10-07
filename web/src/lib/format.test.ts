import { describe, expect, it } from 'vitest';
import { filtersToQuery, formatBytes, formatDate, formatNumber } from './format';

describe('format', () => {
  it('formata data ISO sem deslocar o dia por fuso', () => {
    expect(formatDate('2026-04-10')).toBe('10/04/2026');
    expect(formatDate(null)).toBe('—');
  });
  it('mostra "—" para número desconhecido e não para zero', () => {
    expect(formatNumber(null)).toBe('—');
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(1234)).toBe('1.234');
  });
  it('serializa filtros para a querystring', () => {
    const q = filtersToQuery({ from: '2026-01-01', locality: 'vila a', layers: ['captura', 'pit'], search: [], exam: ['positivo'], channel: ['pit'], species: ['Triatoma brasiliensis'], environment: ['intra'] }, { page: 2 });
    expect(new URLSearchParams(q).get('layers')).toBe('captura,pit');
    expect(new URLSearchParams(q).get('exam')).toBe('positivo');
    expect(new URLSearchParams(q).get('channel')).toBe('pit');
    expect(new URLSearchParams(q).get('species')).toBe('Triatoma brasiliensis');
    expect(new URLSearchParams(q).get('environment')).toBe('intra');
    expect(new URLSearchParams(q).get('page')).toBe('2');
    expect(q).not.toContain('search=');
  });
  it('formata tamanhos', () => {
    expect(formatBytes(2048)).toBe('2 KB');
  });
});

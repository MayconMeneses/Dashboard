import { describe, expect, it } from 'vitest';
import { compileFormula, evalAggregate, evalRow, FormulaError } from '../src/formula.js';

const rows = [
  { Situação: 'Confirmados', Total: 30, Pop: '1.000' },
  { Situação: 'Notificados', Total: 100, Pop: '1.000' },
  { Situação: 'Confirmados', Total: 20, Pop: null },
];

describe('fórmulas de métricas próprias', () => {
  it('respeita precedência, parênteses, negativos e números regionais', () => {
    expect(evalRow(compileFormula('[Total] * 2 + 1'), rows[0]!)).toBe(61);
    expect(evalRow(compileFormula('([Total] + 10) * 2'), rows[0]!)).toBe(80);
    expect(evalRow(compileFormula('-[Total] + 5'), rows[0]!)).toBe(-25);
    expect(evalRow(compileFormula('[Total] / [Pop] * 100000'), rows[0]!)).toBe(3000); // "1.000" = mil
    expect(evalRow(compileFormula('ROUND([Total] / 7, 2)'), rows[0]!)).toBe(4.29);
    expect(evalRow(compileFormula('ABS(0 - 3)'), rows[0]!)).toBe(3);
  });
  it('vazio e divisão por zero dão "sem dado" (null), nunca zero', () => {
    expect(evalRow(compileFormula('[Total] / [Pop]'), rows[2]!)).toBeNull();
    expect(evalRow(compileFormula('[Total] / 0'), rows[0]!)).toBeNull();
  });
  it('agregações: SUM, SUMIF, COUNTIF, AVG, razão entre situações', () => {
    expect(evalAggregate(compileFormula('SUM([Total])'), rows)).toBe(150);
    expect(evalAggregate(compileFormula('SUMIF([Total], [Situação], "Confirmados")'), rows)).toBe(50);
    expect(evalAggregate(compileFormula('COUNTIF([Situação], "Confirmados")'), rows)).toBe(2);
    expect(evalAggregate(compileFormula('AVG([Total])'), rows)).toBe(50);
    expect(evalAggregate(compileFormula('COUNT()'), rows)).toBe(3);
    expect(evalAggregate(compileFormula('SUMIF([Total],[Situação],"Confirmados") / SUMIF([Total],[Situação],"Notificados") * 100'), rows)).toBe(50);
    expect(evalAggregate(compileFormula('SUMIF([Total],[Situação],"Nenhum")'), rows)).toBeNull();
  });
  it('classifica a fórmula e lista as colunas usadas', () => {
    const a = compileFormula('SUM([Total]) / COUNT()');
    expect(a.aggregate).toBe(true);
    expect(a.columns).toEqual(['Total']);
    expect(compileFormula('[Total] * 2').aggregate).toBe(false);
  });
  it('erros claros e em português', () => {
    const msg = (s: string, cols?: string[]) => {
      try {
        compileFormula(s, cols);
        return '';
      } catch (e) {
        expect(e).toBeInstanceOf(FormulaError);
        return (e as Error).message;
      }
    };
    expect(msg('')).toMatch(/Escreva a fórmula/);
    expect(msg('[Total] +')).toMatch(/terminou antes/);
    expect(msg('[Total')).toMatch(/Falta fechar o colchete/);
    expect(msg('FOO([A])')).toMatch(/Função desconhecida/);
    expect(msg('[Total] $ 2')).toMatch(/Caractere não permitido/);
    expect(msg('SUM([A]) / [B]')).toMatch(/dentro de uma dessas funções/);
    expect(msg('[Totl] * 2', ['Total', 'Pop'])).toMatch(/Coluna não encontrada: \[Totl\]/);
    expect(msg('SUMIF([A],[B])')).toMatch(/espera 3 argumento/);
    expect(msg('(1 + 2')).toMatch(/“\)”/);
  });
});

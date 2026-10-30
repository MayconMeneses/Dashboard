// Fase 4: papel semântico das colunas, agregação correta de percentuais, explicações e linhagem (dados 100% sintéticos).
import { describe, expect, it } from 'vitest';
import { profileTable } from '../src/profile.js';
import { aggFor, explainColumns, filterEffects, lineageOf, semanticProfile } from '../src/analytics/semantic.js';
import { chartData, suggestCharts } from '../src/suggest.js';
import type { Row, Table } from '../src/types.js';

const UFS = ['SP', 'RJ', 'MG', 'BA'];
function tabela(): Table {
  const rows: Row[] = Array.from({ length: 24 }, (_, i) => ({
    cep: String(10000000 + i * 7919),
    uf: UFS[i % 4]!,
    taxa: `${50 + (i % 5) * 10}%`,
    vendas: 100 + i * 10,
    valor: `R$ ${(1000 + i * 25).toLocaleString('pt-BR')},00`,
    ativo: i % 2 ? 'sim' : 'não',
    quando: `2024-0${1 + (i % 6)}-15`,
  }));
  return { name: 't', columns: ['cep', 'uf', 'taxa', 'vendas', 'valor', 'ativo', 'quando'], rows };
}
const sem = (t = tabela(), forced = {}) => Object.fromEntries(semanticProfile(t, profileTable(t, forced), forced).map((s) => [s.name, s]));

describe('papel semântico', () => {
  it('classifica cada coluna e guarda a regra que decidiu', () => {
    const s = sem();
    expect(s.uf!.role).toBe('dimension');
    expect(s.vendas!.role).toBe('measure');
    expect(s.vendas!.additive).toBe(true);
    expect(s.ativo!.role).toBe('flag');
    expect(s.quando!.role).toBe('time');
    for (const c of Object.values(s)) expect(c.reasons.length).toBeGreaterThan(0);
  });
  it('percentual e taxa não são somáveis; dinheiro é', () => {
    const s = sem();
    expect(s.taxa!.unit).toBe('percent');
    expect(s.taxa!.additive).toBe(false);
    expect(aggFor(s.taxa)).toBe('mean');
    expect(s.valor!.unit).toBe('currency');
    expect(aggFor(s.valor)).toBe('sum');
  });
  it('código numérico (CEP) é identificador, não medida', () => {
    const s = sem();
    expect(s.cep!.role).toBe('identifier');
    expect(s.cep!.additive).toBe(false);
  });
  it('marca a correção manual de tipo', () => {
    const s = sem(tabela(), { vendas: 'category' });
    expect(s.vendas!.manual).toBe(true);
    expect(s.vendas!.role).toBe('dimension');
    expect(s.vendas!.reasons[0]).toContain('definido por você');
  });
});

describe('recomendação', () => {
  it('média, e não soma, para coluna de percentual por categoria', () => {
    const t = tabela();
    const specs = suggestCharts(t, profileTable(t), 3);
    const sp = specs.find((s) => s.kind === 'hbar' && s.y === 'taxa');
    expect(sp, 'gráfico de taxa por categoria precisa existir').toBeDefined();
    if (sp) {
      expect(sp.agg).toBe('mean');
      expect(sp.description).toContain('Média');
      const d = chartData(t, sp);
      // cada UF recebe linhas de taxa entre 50% e 90%: a média nunca passa de 90, a soma passaria de 100
      expect(Math.max(...d.values)).toBeLessThanOrEqual(90);
    }
    // nenhum gráfico recomendado soma uma coluna de percentual
    for (const s of specs.filter((x) => x.y === 'taxa' && x.kind !== 'bar')) expect(s.agg).not.toBe('sum');
  });
  it('código numérico (CEP) não vira medida em nenhum gráfico', () => {
    const t = tabela();
    const specs = suggestCharts(t, profileTable(t), 3);
    expect(specs.filter((x) => x.x === 'cep' || x.y === 'cep' || x.series?.includes('cep'))).toEqual([]);
  });
  it('cada gráfico traz as razões das colunas que usa', () => {
    const t = tabela();
    const specs = suggestCharts(t, profileTable(t), 3);
    const comUf = specs.find((s) => s.x === 'uf');
    expect(comUf?.reasons?.some((r) => r.startsWith('“uf”'))).toBe(true);
  });
  it('é determinístico: mesma entrada, mesma saída', () => {
    const t = tabela();
    const a = JSON.stringify(suggestCharts(t, profileTable(t), 3));
    const b = JSON.stringify(suggestCharts(t, profileTable(t), 3));
    expect(a).toBe(b);
  });
  it('explainColumns ignora colunas desconhecidas e repetidas', () => {
    const s = semanticProfile(tabela(), profileTable(tabela()));
    expect(explainColumns(['uf', 'uf', undefined, 'nao-existe'], s)).toHaveLength(1);
  });
});

describe('filtro e linhagem', () => {
  it('mostra só as colunas que o filtro mudou', () => {
    const t = tabela();
    const filtrada: Table = { ...t, rows: t.rows.filter((r) => r.uf === 'SP') };
    const ef = filterEffects(profileTable(t), profileTable(filtrada));
    const uf = ef.find((e) => e.name === 'uf')!;
    expect(uf.uniqueFull).toBe(4);
    expect(uf.uniqueView).toBe(1);
    expect(uf.filledView).toBeLessThan(uf.filledFull);
  });
  it('sem filtro não há efeito', () => {
    const t = tabela();
    expect(filterEffects(profileTable(t), profileTable(t))).toEqual([]);
  });
  it('linhagem descreve renomeação, tipo, unidade e junção; sem nada, diz que veio do arquivo', () => {
    const st = { renames: { Vendas: 'vendas' }, forced: { vendas: 'integer' as const }, units: { vendas: 'un' }, merges: { uf: { sp: 'SP', SP: 'SP' } }, metrics: [] };
    expect(lineageOf('vendas', st)).toEqual(['Renomeada de “Vendas”.', 'Tipo corrigido por você para integer.', 'Unidade informada por você: un.']);
    expect(lineageOf('uf', st)).toEqual(['1 grafia(s) unificada(s): “sp” → “SP”.']);
    expect(lineageOf('outra', st)).toEqual(['Lida do arquivo sem alteração.']);
  });
});

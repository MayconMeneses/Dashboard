import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { parseFile } from '../src/parse.js';
import { profileTable } from '../src/profile.js';
import { chartData, kpis, qualityAlerts, suggestCharts } from '../src/suggest.js';
import { compatibleStyles } from '../src/shapes.js';

const p = (t: string) => `<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
const cell = (t: string, o: { span?: number; vm?: 'restart' | 'cont' } = {}) => `<w:tc><w:tcPr>${o.span ? `<w:gridSpan w:val="${o.span}"/>` : ''}${o.vm ? `<w:vMerge${o.vm === 'restart' ? ' w:val="restart"' : ''}/>` : ''}</w:tcPr>${p(t)}</w:tc>`;
const tr = (cells: string) => `<w:tr>${cells}</w:tr>`;
const docx = (body: string) => zipSync({ 'word/document.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="x"><w:body>${body}</w:body></w:document>`) });

// dois quadros fictícios, um ano por linha, sem coluna Ano; o primeiro tem rótulo mesclado na vertical
const doc = () =>
  docx(
    p('Este documento trata do município de Exemplo.') +
      p('Quadro das localidades em 2024, 2025 e 2026.') +
      `<w:tbl>${tr(cell('LOCALIDADES', { span: 4 }))}${tr(cell('Cidade X', { vm: 'restart' }) + cell('Trabalhadas') + cell('Positivas') + cell('Dispersão'))}${tr(cell('', { vm: 'cont' }) + cell('40') + cell('10') + cell('25'))}${tr(cell('', { vm: 'cont' }) + cell('50') + cell('20') + cell('40'))}${tr(cell('', { vm: 'cont' }) + cell('60') + cell('15') + cell('25'))}</w:tbl>` +
      p('Quadro das unidades em 2024, 2025 e 2026.') +
      `<w:tbl>${tr(cell('UNIDADES DOMICILIARES', { span: 3 }))}${tr(cell('Meta') + cell('Pesquisadas') + cell('Cobertura'))}${tr(cell('2.698') + cell('1.920') + cell('71,16%'))}${tr(cell('2698') + cell('2006') + cell('74,35%'))}${tr(cell('2.698') + cell('1.259') + cell('46,66%'))}</w:tbl>`,
  );

describe('quadros de relatório em Word', () => {
  it('não altera números do texto (1.920 continua 1.920, 08 continua 08)', async () => {
    const d = await parseFile('r.docx', doc());
    const t = d.tables.find((x) => x.columns.includes('Pesquisadas'))!;
    expect(t.rows[0]!.Pesquisadas).toBe('1.920');
  });
  it('preenche o rótulo mesclado na vertical e dá nome à coluna', async () => {
    const d = await parseFile('r.docx', doc());
    const t = d.tables.find((x) => x.columns.includes('Trabalhadas'))!;
    expect(t.columns).toContain('Município');
    expect(t.rows.map((r) => r['Município'])).toEqual(['Cidade X', 'Cidade X', 'Cidade X']);
  });
  it('cria a coluna Ano a partir do título e junta os quadros por Ano', async () => {
    const d = await parseFile('r.docx', doc());
    const j = d.tables[0]!;
    expect(j.name).toMatch(/quadro geral por Ano/);
    expect(j.rows.map((r) => r.Ano)).toEqual(['2024', '2025', '2026']);
    expect(j.columns).toEqual(expect.arrayContaining(['Trabalhadas', 'Pesquisadas', 'Cobertura']));
    expect(j.rows[1]!.Pesquisadas).toBe('2006');
    const outro = d.tables.find((x) => x.name.includes('bloco 2'))!;
    expect(outro.notes!.join(' ')).toMatch(/Coluna “Ano” criada/);
  });
  it('trata Ano como período (não como medida) e % como número com unidade', async () => {
    const j = (await parseFile('r.docx', doc())).tables[0]!;
    const prof = profileTable(j);
    const ano = prof.find((c) => c.name === 'Ano')!;
    expect(ano.period).toBe(true);
    expect(ano.type).toBe('category');
    const cob = prof.find((c) => c.name === 'Cobertura')!;
    expect(cob.type).toBe('number');
    expect(cob.percent).toBe(true);
    expect(prof.find((c) => c.name === 'Pesquisadas')!.sum).toBe(1920 + 2006 + 1259);
  });
  it('gera linhas por período, indicadores com variação e confere a taxa', async () => {
    const j = (await parseFile('r.docx', doc())).tables[0]!;
    const prof = profileTable(j);
    const specs = suggestCharts(j, prof);
    const multi = specs.filter((s) => s.kind === 'multi');
    expect(multi.length).toBeGreaterThanOrEqual(1);
    expect(multi.every((s) => s.period)).toBe(true);
    // colunas com a taxa em linha por cima (Cobertura = Pesquisadas ÷ Meta × 100)
    const combo = multi.find((s) => s.lineSeries?.includes('Cobertura'))!;
    expect(combo.series).toEqual(['Meta', 'Pesquisadas']);
    const cols = multi.flatMap((s) => [...(s.series ?? []), ...(s.lineSeries ?? [])]);
    expect(cols).toEqual(expect.arrayContaining(['Trabalhadas', 'Pesquisadas', 'Cobertura']));
    // variedade: rosca, colunas empilhadas, variação e radar
    expect(specs.some((s) => s.kind === 'part' && !s.part!.all)).toBe(true);
    expect(specs.some((s) => s.kind === 'part' && s.part!.all && s.style === 'stacked')).toBe(true);
    expect(specs.some((s) => s.kind === 'change')).toBe(true);
    const d = chartData(j, combo);
    expect(d.datasets!.map((x) => !!x.line)).toEqual([false, false, true]);
    const rosca = chartData(j, specs.find((s) => s.kind === 'part' && !s.part!.all)!);
    expect(rosca.values.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    expect(compatibleStyles({ ordered: true, series: 3, labels: 3, positive: true })[0]!.style).toBe('line');
    expect(compatibleStyles({ ordered: true, series: 3, labels: 3, positive: true, preferBars: true })[0]!.style).toBe('bar');
    const k = kpis(j, prof);
    expect(k[0]!.label).toBe('Períodos');
    expect(k.some((x) => /Pesquisadas|Trabalhadas|Positivas/.test(x.label) && /→/.test(x.hint ?? ''))).toBe(true);
    const al = qualityAlerts(j, prof).map((a) => a.text).join('\n');
    expect(al).toMatch(/“Cobertura” confere com “Pesquisadas” ÷ “Meta” × 100/);
  });
});

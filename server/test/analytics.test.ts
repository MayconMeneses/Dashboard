import { describe, expect, it } from 'vitest';
import { analytics, stageSexCategory } from '../../web/src/static/analytics.js';
import type { SnapshotRec } from '../../web/src/static/engine.js';

let n = 0;
const rec = (o: Partial<SnapshotRec>): SnapshotRec => ({
  rid: `f${++n}`, origin: 'arquivo', type: 'captura', name: null, locality_key: 'vila a', locality_raw: 'Vila A', visit_date: null, exam_date: null,
  search_result: 'com_captura', exam_result: 'nao_informado', triatomine_count: null, stage: null, sex: null, species: null, lat: null, lng: null,
  channel: null, environment: null, geometry: null, is_boundary: false, duplicate_of: null, property_count: null, zone: null, pit_ref: null, ...o,
});

const DATA: SnapshotRec[] = [
  rec({ type: 'localidade', name: 'Vila A', property_count: 50 }),
  rec({ type: 'localidade', name: 'Vila A (fim)', property_count: null }),
  rec({ type: 'localidade', locality_key: 'sitio b', locality_raw: 'Sítio B', property_count: 10 }),
  rec({ type: 'pit', name: 'PIT 01', pit_ref: 'UBS A', zone: 'Rural' }),
  rec({ species: 'Triatoma brasiliensis', exam_result: 'positivo', visit_date: '2026-06-10', exam_date: '2026-06-20', channel: 'pit', environment: 'intra', stage: 'Adulto', sex: 'Fêmea' }),
  rec({ species: 'Triatoma brasiliensis', exam_result: 'negativo', visit_date: '2026-07-01', exam_date: '2026-07-20', channel: 'captura', environment: 'peri', stage: 'Ninfa' }),
  rec({ species: 'Panstrongylus lutzi', exam_result: 'negativo', visit_date: '2026-07-15', exam_date: '2026-07-10', channel: 'captura', environment: 'intra', stage: 'Adulto', sex: 'Macho' }),
  rec({ locality_key: 'sitio b', locality_raw: 'Sítio B', species: 'Triatoma brasiliensis', visit_date: '2026-07-20', channel: 'pit', environment: 'intra_peri', stage: 'Ninfa e adulto', sex: 'Macho e Fêmea' }),
  rec({ locality_key: 'sitio b', locality_raw: 'Sítio B' }), // sem data, sem espécie, sem tudo
];

describe('análises', () => {
  const a = analytics(DATA, {});
  it('resumo: positividade só entre registros com resultado', () => {
    expect(a.resumo).toEqual({ capturas: 5, comResultado: 3, positivos: 1, negativos: 2, positividade: 33.3, imoveis: 60, localidadesComImoveis: 2 });
  });
  it('por localidade, com imóveis (maior valor da localidade) e capturas por 100 imóveis', () => {
    const v = a.porLocalidade.find((x) => x.key === 'vila a')!;
    expect(v).toMatchObject({ total: 3, positivo: 1, negativo: 2, imoveis: 50, capturasPor100Imoveis: 6 });
    const s = a.porLocalidade.find((x) => x.key === 'sitio b')!;
    expect(s).toMatchObject({ total: 2, imoveis: 10, capturasPor100Imoveis: 20 });
  });
  it('por espécie inclui "Não identificada"', () => {
    expect(a.porEspecie.map((x) => [x.especie, x.total])).toEqual([['Triatoma brasiliensis', 3], ['Panstrongylus lutzi', 1], ['Não identificada', 1]]);
  });
  it('linha do tempo por mês e contagem sem data', () => {
    expect(a.linhaDoTempo).toEqual([
      { mes: '2026-06', capturas: 1, positivos: 1, negativos: 0, semResultado: 0, campanha: 0, pit: 1, semOrigem: 0 },
      { mes: '2026-07', capturas: 3, positivos: 0, negativos: 2, semResultado: 1, campanha: 2, pit: 1, semOrigem: 0 },
    ]);
    expect(a.semDataCaptura).toBe(1);
  });
  it('origem, ambiente, fase/sexo e espécie × ambiente', () => {
    expect(a.porOrigem.map((x) => [x.chave, x.total])).toEqual([['captura', 2], ['pit', 2], ['nao_informado', 1]]);
    expect(a.porAmbiente.map((x) => [x.chave, x.total])).toEqual([['intra', 2], ['peri', 1], ['intra_peri', 1], ['nao_informado', 1]]);
    expect(Object.fromEntries(a.faseSexo.map((x) => [x.categoria, x.total]))).toEqual({ 'Fêmea': 1, Ninfa: 1, Macho: 1, 'Ninfa e adulto': 1, 'Não informado': 1 });
    expect(a.especieAmbiente[0]).toMatchObject({ especie: 'Triatoma brasiliensis', intra: 1, peri: 1, intra_peri: 1, total: 3 });
  });
  it('tempo até o resultado: faixas, mediana e exame antes da captura', () => {
    const t = a.tempoAteResultado;
    expect(t.comAsDuasDatas).toBe(3);
    expect(t.semDataDoExame).toBe(2);
    expect(t.minDias).toBe(-5);
    expect(t.medianaDias).toBe(10);
    expect(Object.fromEntries(t.faixas.map((x) => [x.faixa, x.total]))).toMatchObject({ 'Exame antes da captura (conferir)': 1, '8 a 14 dias': 1, '15 a 21 dias': 1 });
  });
  it('PITs sem endereço', () => {
    expect(a.pits).toEqual([{ nome: 'PIT 01', unidade: 'UBS A', zona: 'Rural', localidade: 'Vila A', localityKey: 'vila a' }]);
  });
  it('filtros cruzados: cada gráfico ignora o próprio filtro', () => {
    const f = analytics(DATA, { species: ['Panstrongylus lutzi'], locality: 'sitio b', from: '2026-07-01', to: '2026-07-31' });
    expect(f.resumo.capturas).toBe(0); // todos os filtros juntos: nada em "Sítio B" com essa espécie
    expect(f.porEspecie.map((x) => x.especie)).toContain('Triatoma brasiliensis'); // sem o filtro de espécie
    expect(f.porLocalidade.map((x) => x.key)).toEqual(['vila a']); // sem o filtro de localidade (mas com espécie e período)
    expect(f.linhaDoTempo).toEqual([]); // sem o filtro de período, mas localidade e espécie continuam valendo
    const g = analytics(DATA, { species: ['Triatoma brasiliensis'], from: '2026-07-01', to: '2026-07-31' });
    expect(g.linhaDoTempo.map((x) => x.mes)).toEqual(['2026-06', '2026-07']); // o período não restringe a linha do tempo
  });
  it('fase/sexo', () => {
    expect(stageSexCategory({ stage: 'Adulto', sex: null })).toBe('Adulto');
    expect(stageSexCategory({ stage: null, sex: null })).toBe('Não informado');
  });
});

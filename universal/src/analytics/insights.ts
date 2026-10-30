import type { ChartSpec } from '../types.js';
import { br } from './format.js';
import { SeriesData } from './chartData.js';

/** Frase de destaque calculada a partir dos próprios dados do gráfico. */
export function insightFor(spec: ChartSpec, d: SeriesData): string {
  if (spec.kind === 'change' && d.values.length) {
    const hi = d.values[0]!;
    const lo = d.values[d.values.length - 1]!;
    return `Maior aumento: ${d.labels[0]} (${hi >= 0 ? '+' : ''}${br(hi)}%); maior queda: ${d.labels[d.labels.length - 1]} (${br(lo)}%).`;
  }
  if (spec.kind === 'profile' && d.datasets) return `Cada eixo é um indicador; 100% é o maior valor daquele indicador entre os períodos. Quem chega mais perto da borda teve o melhor (maior) resultado naquele indicador.`;
  if (spec.kind === 'part' && spec.part?.all && d.datasets) {
    const [a, r] = d.datasets;
    const share = d.labels.map((l, i) => ({ l, s: a!.values[i]! + r!.values[i]! > 0 ? (a!.values[i]! / (a!.values[i]! + r!.values[i]!)) * 100 : Number.NaN })).filter((x) => !Number.isNaN(x.s));
    return share.length ? `Parte de “${a!.label}” no total: ${share.map((x) => `${x.l} ${br(x.s)}%`).join(', ')}.` : 'Sem dados.';
  }
  if (spec.kind === 'part' && spec.part && d.values.length === 2) {
    const tot = d.values[0]! + d.values[1]!;
    return `${br(d.values[0]!)} de ${br(tot)} (${br(tot ? (d.values[0]! / tot) * 100 : 0)}%) são “${spec.part.part}”; o restante (${br(d.values[1]!)}) não.`;
  }
  const valid = (a: number[]) => a.map((v, i) => [v, i] as const).filter(([v]) => !Number.isNaN(v));
  const nanCount = d.datasets ? d.datasets.reduce((a, s) => a + s.values.filter((v) => Number.isNaN(v)).length, 0) : d.values.filter((v) => Number.isNaN(v)).length;
  const gap = nanCount ? ` Há ${nanCount} ponto(s) sem dado, que não foram tratados como zero.` : '';
  if (d.datasets && spec.period && d.labels.length >= 2) {
    const ch = d.datasets.map((s) => {
      const pts = valid(s.values);
      const f = pts[0];
      const l = pts[pts.length - 1];
      return f && l && f[1] !== l[1] ? { l: s.label, f: f[0], v: l[0], pct: f[0] ? ((l[0] - f[0]) / Math.abs(f[0])) * 100 : Number.NaN } : null;
    }).filter((x): x is NonNullable<typeof x> => x != null);
    const a = d.labels[0]!;
    const z = d.labels[d.labels.length - 1]!;
    if (ch.length) return `De ${a} a ${z}: ${ch.map((c) => `${c.l} ${br(c.f)} → ${br(c.v)}${Number.isNaN(c.pct) ? '' : ` (${c.pct >= 0 ? '+' : ''}${br(c.pct)}%)`}`).join('; ')}.${gap}`;
  }
  if (d.datasets) {
    const tot = d.datasets.map((s) => ({ l: s.label, v: s.values.filter((x) => !Number.isNaN(x)).reduce((a, b) => a + b, 0), peak: valid(s.values).sort((a, b) => b[0] - a[0])[0] }));
    tot.sort((a, b) => b.v - a.v);
    const all = tot.reduce((a, b) => a + b.v, 0) || 1;
    const lead = tot[0]!;
    const pk = lead.peak ? ` Maior valor: ${br(lead.peak[0])} em ${d.labels[lead.peak[1]]}.` : '';
    return `Maior total: ${lead.l} (${br(lead.v)}, ${br((lead.v / all) * 100)}% da soma das séries).${pk}${gap}`;
  }
  const v = valid(d.values);
  if (!v.length) return 'Sem valores para este gráfico.';
  const sorted = [...v].sort((a, b) => b[0] - a[0]);
  const total = v.reduce((a, [x]) => a + x, 0);
  const top = sorted[0]!;
  const low = sorted[sorted.length - 1]!;
  if (spec.kind === 'line' || (spec.keepOrder && spec.kind !== 'donut')) {
    const first = v[0]!;
    const last = v[v.length - 1]!;
    const delta = first[0] ? ` De ${d.labels[first[1]]} a ${d.labels[last[1]]}: ${last[0] >= first[0] ? '+' : ''}${br(((last[0] - first[0]) / first[0]) * 100)}%.` : '';
    return `Pico: ${br(top[0])} em ${d.labels[top[1]]}; mínimo: ${br(low[0])} em ${d.labels[low[1]]}.${delta}${gap}`;
  }
  // média não se soma: “% do total” só faz sentido para soma e contagem
  const nome = spec.agg === 'ratio' ? 'taxa geral' : spec.agg === 'mean' ? 'média' : spec.agg === 'median' ? 'mediana' : spec.agg === 'min' ? 'mínimo' : spec.agg === 'max' ? 'máximo' : '';
  if (nome) return `Maior ${nome}: ${d.labels[top[1]]} (${br(top[0])}); menor: ${d.labels[low[1]]} (${br(low[0])}).${gap}`;
  return `Maior: ${d.labels[top[1]]} (${br(top[0])}, ${br((top[0] / (total || 1)) * 100)}% do total ${br(total)}); menor: ${d.labels[low[1]]} (${br(low[0])}).${gap}`;
}

export const HOWTO_SHAPE: Record<string, string> = {
  line: 'A linha liga os períodos em ordem; subida = aumento, descida = queda. Compare a forma das linhas.',
  bar: 'Cada coluna é um valor; quanto mais alta, maior o número.',
  hbar: 'Cada barra é um item, do maior para o menor; quanto mais longa, maior o número.',
  stacked: 'Cada coluna é um total dividido em cores; o tamanho de cada cor é a parte daquela série.',
  area: 'Área preenchida sob a linha; quando empilhada, a espessura de cada faixa é a parte daquela série.',
  percent: 'Todas as colunas têm a mesma altura (100%); cada cor mostra a proporção da série, não o volume.',
  heatmap: 'Cada célula é um valor; quanto mais escura, maior. Células listradas = sem dado (não é zero). Clique num título para filtrar.',
  radar: 'Cada eixo é um item; cada polígono é uma série. Quanto mais longe do centro, maior o valor.',
  small: 'Um gráfico pequeno por série, todos na mesma escala vertical: compare a forma e a altura entre eles.',
  pareto: 'Barras do maior para o menor e linha de % acumulado: mostra quantos itens somam a maior parte do total.',
  donut: 'Cada fatia é a parte do total; fatias maiores = mais registros.',
};

export const HOW_TO: Record<string, string> = {
  part: 'A rosca mostra um todo dividido em duas partes: a fatia colorida é a parte destacada e a outra é o que sobra do total. Troque o período no seletor.',
  bar: 'Cada barra é um valor; quanto mais alta, maior o número.',
  hbar: 'Cada barra é um item, do maior para o menor; quanto mais longa, maior o número.',
  donut: 'Cada fatia é a parte do total; fatias maiores = mais registros.',
  line: 'A linha liga os períodos em ordem; subida = aumento, descida = queda.',
  hist: 'Cada barra é uma faixa de valores; a altura é quantos registros caem nela.',
  stacked: 'Cada barra é dividida em cores; o tamanho de cada cor é a parte daquela categoria.',
  scatter: 'Cada ponto é um registro; pontos subindo da esquerda para a direita indicam que as duas colunas crescem juntas.',
  multi: 'Barras lado a lado comparam as colunas em cada linha do arquivo.',
  profile: 'Cada eixo é um indicador, normalizado pelo maior valor dele entre os períodos (100%). Cada período é um polígono: quanto maior a área, maiores os indicadores.',
  change: 'Cada barra é a variação percentual do primeiro ao último período; para a direita = aumento, para a esquerda = queda.',
  map: 'Cada ponto é um registro com coordenadas; aproxime para ver detalhes.',
  pivot: 'Veja a descrição acima.',
};

export function rateInsight(r: { labels: string[]; values: number[]; name: string }): string {
  const v = r.values.map((x, i) => [x, i] as const).filter(([x]) => !Number.isNaN(x));
  if (!v.length) return '';
  const s = [...v].sort((a, b) => b[0] - a[0]);
  const f = (n: number) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(n);
  return `${r.name}: maior em ${r.labels[s[0]![1]]} (${f(s[0]![0])}%), menor em ${r.labels[s[s.length - 1]![1]]} (${f(s[s.length - 1]![0])}%).`;
}

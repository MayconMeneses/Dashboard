import { toNumber } from '../profile.js';
import type { ChartSpec, ColProfile, Table } from '../types.js';
import { findRelations } from './quality.js';
import { aggFor, explainColumns, semanticProfile } from './semantic.js';
import { suggestTidy } from './tidy.js';

/** Sugere gráficos conforme os tipos de coluna; `level` 1 = enxuto … 3 = completo. */
export function suggestCharts(t: Table, prof: ColProfile[], level = 2): ChartSpec[] {
  if (t.noCharts) return [];
  if (t.tidy) return suggestTidy(t, level);
  const out: ChartSpec[] = [];
  const sem = semanticProfile(t, prof);
  const semOf = (name: string) => sem.find((s) => s.name === name);
  const labelOk = (p: ColProfile) => (p.type === 'category' || p.type === 'text' || p.type === 'id') && p.filled === t.rows.length && p.unique === t.rows.length;
  const labelCol = t.rows.length >= 2 && t.rows.length <= 40 ? (prof.find((p) => p.period && labelOk(p)) ?? (t.rows.length >= 3 ? prof.find(labelOk) : undefined)) : undefined;
  const period = !!labelCol?.period;
  const cats = prof.filter((p) => p.type === 'category' && p.unique >= 2 && p.unique < p.filled).sort((a, b) => a.unique - b.unique);
  // código numérico (CEP, CPF, IBGE…) não é medida: somar, tirar média ou fazer histograma dele não tem significado
  const nums = prof.filter((p) => (p.type === 'number' || p.type === 'integer') && p.unique > 1 && semOf(p.name)?.role !== 'identifier');
  const dates = prof.filter((p) => p.type === 'date');
  const bools = prof.filter((p) => p.type === 'boolean');
  const lat = prof.find((p) => p.type === 'lat');
  const lon = prof.find((p) => p.type === 'lon');
  const how = (name: string) => (aggFor(semOf(name)) === 'mean' ? { agg: 'mean' as const, word: 'Média' } : { agg: 'sum' as const, word: 'Soma' });
  let n = 0;
  const id = (k: string) => `${k}-${n++}`;

  if (lat && lon) out.push({ id: id('map'), kind: 'map', title: 'Mapa dos registros', description: `Cada ponto é um registro com coordenadas (${lat.filled} de ${t.rows.length}).`, score: 95 });

  for (const d of dates.slice(0, 2)) {
    out.push({ id: id('line'), kind: 'line', x: d.name, agg: 'count', title: `Registros por mês – ${d.name}`, description: 'Quantidade de registros em cada mês; meses sem registro aparecem como zero.', score: 90 });
    const m = nums[0];
    if (m && level >= 3) out.push({ id: id('line'), kind: 'line', x: d.name, y: m.name, agg: how(m.name).agg, title: `${m.name} por mês`, description: `${how(m.name).word} de “${m.name}” em cada mês.`, score: 60 });
  }
  cats.slice(0, level === 1 ? 2 : level === 2 ? 4 : 6).forEach((c, i) => {
    out.push({ id: id('cat'), kind: 'pivot', style: 'hbar', x: c.name, agg: 'count', title: `Registros por ${c.name}`, description: `Quantos registros há para cada valor de “${c.name}” (até 25 valores mais frequentes).`, score: 85 - i * 5 });
  });
  for (const b of bools.slice(0, 2)) out.push({ id: id('bool'), kind: 'pivot', style: 'donut', x: b.name, agg: 'count', title: `${b.name}`, description: 'Distribuição Sim/Não.', score: 70 });
  if (labelCol) {
    nums.filter((m) => m.filled >= 2).slice(0, level === 1 ? 3 : level === 2 ? 6 : 10).forEach((m, i) => {
      out.push({ id: id('lab'), kind: 'bar', x: labelCol.name, y: m.name, agg: 'sum', keepOrder: true, ...(period ? { period } : {}), title: `${m.name} por ${labelCol.name}`, description: `Valor de “${m.name}” em cada linha de “${labelCol.name}”, na ordem do arquivo. Linha sem valor fica sem barra (não é zero).`, score: 88 - i });
    });
  }
  if (labelCol && period) periodCharts(t, prof, labelCol, nums, level, out, id);
  else if (labelCol) {
    // agrupa colunas de mesma ordem de grandeza para compará-las lado a lado
    const groups = new Map<number, ColProfile[]>();
    for (const m of nums.filter((x) => x.filled >= 2 && (x.max ?? 0) > 0)) {
      const k = Math.floor(Math.log10(m.max!));
      groups.set(k, [...(groups.get(k) ?? []), m]);
    }
    [...groups.values()].filter((g) => g.length >= 2).slice(0, level === 1 ? 1 : 3).forEach((g, i) => {
      const cols = g.slice(0, 4);
      out.push({ id: id('multi'), kind: 'multi', x: labelCol.name, series: cols.map((c) => c.name), keepOrder: true, title: `Comparativo: ${cols.map((c) => c.name).join(' × ')}`, description: `Colunas de ordem de grandeza parecida, lado a lado por “${labelCol.name}”. Linha sem valor fica sem barra (não é zero).`, score: 92 - i });
    });
  }
  if (t.rows.length >= 12) nums.slice(0, level === 1 ? 1 : level === 2 ? 3 : 5).forEach((m, i) => {
    out.push({ id: id('hist'), kind: 'hist', x: m.name, title: `Distribuição de ${m.name}`, description: `Quantos registros caem em cada faixa de “${m.name}”.`, score: 75 - i * 5 });
  });
  const c0 = cats.find((c) => c.unique <= 25);
  if (c0 && nums[0] && level >= 2) out.push({ id: id('catnum'), kind: 'hbar', x: c0.name, y: nums[0].name, agg: how(nums[0].name).agg, title: `${nums[0].name} por ${c0.name}`, description: `${how(nums[0].name).word} de “${nums[0].name}” para cada valor de “${c0.name}”.`, score: 80 });
  const c1 = cats.find((c) => c.name !== c0?.name && c.unique <= 8);
  if (c0 && c1 && c0.unique <= 15 && level >= 3) {
    out.push({ id: id('stack'), kind: 'pivot', style: 'stacked', x: c0.name, seriesBy: c1.name, agg: 'count', title: `${c0.name} × ${c1.name}`, description: `Quantos registros há em cada combinação de “${c0.name}” e “${c1.name}”.`, score: 55 });
    if (c0.unique >= 4 && c1.unique >= 3) out.push({ id: id('heat'), kind: 'pivot', style: 'heatmap', lockStyle: true, x: c0.name, seriesBy: c1.name, agg: 'count', title: `Mapa de calor: ${c0.name} × ${c1.name}`, description: `Mesma contagem, em cores: quanto mais escura a célula, mais registros.`, score: 50 });
  }

  if (level >= 2) {
    const pair = bestCorrelation(t, nums.filter((c) => c.unique > 2));
    if (pair) out.push({ id: id('sc'), kind: 'scatter', x: pair.a, y: pair.b, title: `${pair.a} × ${pair.b}`, description: `Cada ponto é um registro. Correlação de Pearson ${pair.r.toFixed(2).replace('.', ',')} (${Math.abs(pair.r) >= 0.7 ? 'forte' : 'moderada'}); correlação não prova causa.`, score: 65 });
  }

  const inMulti = new Set(out.filter((c) => c.kind === 'multi').flatMap((c) => [...(c.series ?? []), ...(c.lineSeries ?? [])]));
  const final = level >= 3 ? out : out.filter((c) => !(c.id.startsWith('lab') && c.y && inMulti.has(c.y)));
  const limit = period ? (level === 1 ? 6 : level === 2 ? 18 : 26) : level === 1 ? 4 : level === 2 ? 9 : 15;
  return final.sort((a, b) => b.score - a.score).slice(0, limit).map((c) => ({ ...c, reasons: explainColumns([c.x, c.y, c.seriesBy, ...(c.series ?? [])], sem) }));
}

export function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) ** 2;
    syy += (ys[i]! - my) ** 2;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
}

/** Par de colunas numéricas com maior |correlação| (≥ 0,5), usando só linhas em que ambas têm valor. */
export function bestCorrelation(t: Table, nums: ColProfile[]): { a: string; b: string; r: number } | null {
  let best: { a: string; b: string; r: number } | null = null;
  const cols = nums.slice(0, 8);
  for (let i = 0; i < cols.length; i++) {
    for (let j = i + 1; j < cols.length; j++) {
      const xs: number[] = [];
      const ys: number[] = [];
      for (const r of t.rows) {
        const a = toNumber(r[cols[i]!.name] ?? null);
        const b = toNumber(r[cols[j]!.name] ?? null);
        if (a != null && b != null) {
          xs.push(a);
          ys.push(b);
        }
      }
      if (xs.length < 8) continue;
      const r = pearson(xs, ys);
      if (Math.abs(r) >= 0.5 && (!best || Math.abs(r) > Math.abs(best.r))) best = { a: cols[i]!.name, b: cols[j]!.name, r };
    }
  }
  return best;
}

/** O clique vira filtro só quando o rótulo é valor real da coluna; as faixas do histograma são calculadas e não existem nas linhas. */
export const clickFilters = (s: ChartSpec) => !!s.x && s.kind !== 'part' && s.kind !== 'profile' && s.kind !== 'change' && s.kind !== 'hist';

/**
 * Quadro com um período por linha (ex.: anos): colunas agrupadas por padrão, com linha de percentual por cima quando
 * há uma taxa que sai das colunas; roscas e colunas empilhadas para “parte do todo”; barras de variação; radar do perfil.
 */
export function periodCharts(t: Table, prof: ColProfile[], label: ColProfile, nums: ColProfile[], level: number, out: ChartSpec[], id: (k: string) => string) {
  const x = label.name;
  const usable = nums.filter((c) => c.filled >= 2 && (c.max ?? 0) > 0);
  const rels = findRelations(t, prof).filter((r) => r.bad.length === 0);
  const nCombo = level === 1 ? 2 : level === 2 ? 4 : 6;
  const used = new Set<string>();
  rels.slice(0, nCombo).forEach((r, i) => {
    used.add(r.p);
    used.add(r.a);
    used.add(r.b);
    out.push({
      id: id('combo'), kind: 'multi', x, series: [r.b, r.a], lineSeries: [r.p], keepOrder: true, period: true,
      title: `${r.b} e ${r.a}, com ${r.p} (linha)`,
      description: `Colunas: valores de cada “${x}”. Linha (eixo da direita, %): “${r.p}”, que é “${r.a}” ÷ “${r.b}” × 100.`,
      score: 95 - i,
    });
  });
  rels.slice(0, level === 1 ? 1 : 3).forEach((r, i) => {
    out.push({ id: id('partall'), kind: 'part', x, part: { whole: r.b, part: r.a, all: true }, keepOrder: true, period: true, style: 'stacked', lockStyle: true, title: `${r.a} dentro de ${r.b}, por ${x}`, description: `Cada coluna é o total de “${r.b}” dividido entre “${r.a}” e o restante.`, score: 89 - i });
    if (level >= 2) out.push({ id: id('part'), kind: 'part', x, part: { whole: r.b, part: r.a }, title: `${r.a} em relação a ${r.b}`, description: `Rosca de um ${x} (escolha no seletor): a fatia colorida é “${r.a}”; a outra é o restante de “${r.b}”.`, score: 81 - i });
  });
  const rest = usable.filter((c) => !used.has(c.name));
  const groups = new Map<string, ColProfile[]>();
  for (const m of rest) {
    const k = m.percent ? 'pct' : String(Math.floor(Math.log10(m.max!)));
    groups.set(k, [...(groups.get(k) ?? []), m]);
  }
  const chunks = [...groups.entries()].flatMap(([k, g]) => g.reduce<ColProfile[][]>((acc, c, i) => (i % 4 ? acc[acc.length - 1]!.push(c) : acc.push([c]), acc), []).map((cols) => ({ k, cols })));
  chunks.slice(0, level === 1 ? 1 : level === 2 ? 6 : 10).forEach(({ k, cols }, i) => {
    out.push({
      id: id('multi'), kind: 'multi', x, series: cols.map((c) => c.name), keepOrder: true, period: true,
      title: `${cols.map((c) => c.name).join(' × ')}${k === 'pct' ? ' (%)' : ''}`,
      description: `Colunas por “${x}”${k === 'pct' ? ', todas em percentual' : ', de ordem de grandeza parecida para dividir o mesmo eixo'}. Ponto sem valor fica sem coluna (não é zero).`,
      score: 91 - i,
    });
  });
  const varying = usable.filter((c) => c.unique > 1);
  if (level >= 2 && varying.length >= 3 && t.rows.length >= 2) out.push({ id: id('change'), kind: 'change', x, indicators: varying.map((c) => c.name), title: `O que mais mudou do primeiro ao último ${x} (%)`, description: 'Variação percentual de cada indicador entre o primeiro e o último período.', score: 90 });
  const radarCols = varying.filter((c) => !c.percent).slice(0, 8);
  if (level >= 2 && radarCols.length >= 3 && t.rows.length >= 2 && t.rows.length <= 6) out.push({ id: id('profile'), kind: 'profile', x, indicators: radarCols.map((c) => c.name), title: `Perfil dos indicadores por ${x}`, description: 'Radar: cada eixo é um indicador, em % do maior valor dele entre os períodos.', score: 83 });
}

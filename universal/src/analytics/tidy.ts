import { VALUE_COL } from '../grid.js';
import { toNumber } from '../profile.js';
import { compatibleStyles } from '../shapes.js';
import type { Alert, ChartSpec, Kpi, Row, Table } from '../types.js';
import { fmtNum } from './format.js';
import { NONE, sumBy, pivotData } from './chartData.js';
import { rateOptions } from './rates.js';

/** Fatos principais de uma tabela organizada (situação e agravo dominantes). */
export function tidyFacts(t: Table) {
  const td = t.tidy!;
  const situ = td.situation ? sumBy(t, td.situation) : [];
  const mainSit = situ[0]?.[0];
  const rowsMain = mainSit ? t.rows.filter((r) => r[td.situation!] === mainSit) : t.rows;
  const agr = new Map<string, number>();
  if (td.agravo) for (const r of rowsMain) {
    const v = toNumber(r[VALUE_COL] ?? null);
    if (v != null && r[td.agravo] != null) agr.set(String(r[td.agravo]), (agr.get(String(r[td.agravo])) ?? 0) + v);
  }
  const agrList = [...agr.entries()].sort((a, b) => b[1] - a[1]);
  return { mainSit, mainAgr: agrList[0]?.[0], agrList, situ, periods: [...new Set(t.rows.map((r) => String(r[td.period])))], entities: [...new Set(t.rows.map((r) => String(r[td.entity])))] };
}

/** Aplica as regras de escolha de desenho (shapes.ts) aos gráficos "pivot" que não têm desenho fixo. */
export function applyEngine(t: Table, specs: ChartSpec[]) {
  for (const sp of specs) {
    if (sp.kind !== 'pivot' || sp.rate || sp.lockStyle) continue;
    const d = pivotData(t, sp);
    const rec = compatibleStyles({ ordered: !!sp.keepOrder, series: d.datasets?.length ?? 0, labels: d.labels.length, positive: [...d.values, ...(d.datasets ?? []).flatMap((x) => x.values)].every((v) => Number.isNaN(v) || v >= 0) }).find((o) => o.recommended);
    if (rec) {
      sp.style = rec.style;
      sp.why = rec.why;
    }
  }
}

export function suggestTidy(t: Table, level: number): ChartSpec[] {
  const td = t.tidy!;
  const f = tidyFacts(t);
  const out: ChartSpec[] = [];
  const agrWhere: Record<string, string[]> = td.agravo && f.mainAgr ? { [td.agravo]: [f.mainAgr, NONE] } : {};
  const agrOnly: Record<string, string[]> = td.agravo && f.mainAgr ? { [td.agravo]: [f.mainAgr] } : {};
  const mainWhere: Record<string, string[]> = { ...agrOnly, ...(td.situation && f.mainSit ? { [td.situation]: [f.mainSit] } : {}) };
  const agrTxt = f.mainAgr ? ` de ${f.mainAgr}` : '';
  const sitNames = f.situ.map(([n]) => n);
  const rest = sitNames.filter((n) => n !== f.mainSit);
  const partWhere = (names: string[]) => ({ ...(td.situation ? { [td.situation]: names } : {}) });
  const mp = () => (f.periods.length > 1 ? `Soma dos ${f.entities.length} ${td.entity.toLowerCase()}s` : '');
  void mp;

  if (td.situation && rest.length >= 2) {
    const top = rest.slice(0, 3);
    out.push({
      id: 'tid-evol', kind: 'pivot', style: 'line', x: td.period, seriesBy: td.situation, agg: 'sum', y: td.value, keepOrder: true,
      where: { ...agrWhere, ...partWhere([f.mainSit!, ...top]) },
      title: `Evolução por ${td.period.toLowerCase()}: ${[f.mainSit, ...top].join(', ')}`,
      description: `Para cada ${td.period.toLowerCase()}, soma de todos os ${td.entity.toLowerCase()}s, de cada situação${f.mainAgr ? ` (${f.mainAgr}; indicadores sem agravo informado, como “Em Andamento”, entram como estão no arquivo)` : ''}. “${f.mainSit}” é a maior situação e serve de total de referência.`,
      howTo: 'Cada linha acompanha uma situação ao longo do tempo. Subida = mais casos naquele período; distância entre as linhas mostra quanto do total já foi concluído.', score: 96,
    });
  }
  if (f.mainSit) {
    out.push({
      id: 'tid-rank', kind: 'pivot', style: 'hbar', x: td.entity, agg: 'sum', y: td.value, where: mainWhere,
      title: `${f.mainSit}${agrTxt} por ${td.entity.toLowerCase()} (total do período)`,
      description: `Soma de todos os ${td.period.toLowerCase()}s, do maior para o menor. Valores em branco no arquivo ficam fora da soma (não são zero), então ${td.entity.toLowerCase()}s com meses sem dado aparecem subestimados.`,
      howTo: 'Barras mais longas = mais casos no período. Clique numa barra para filtrar todo o painel só por aquele item.', score: 94,
    });
    out.push({
      id: 'tid-mes-ent', kind: 'pivot', style: 'line', x: td.period, seriesBy: td.entity, agg: 'sum', y: td.value, keepOrder: true, where: mainWhere,
      title: `${f.mainSit}${agrTxt} por ${td.period.toLowerCase()} em cada ${td.entity.toLowerCase()}`,
      description: `Uma linha por ${td.entity.toLowerCase()}, mostrando como o número variou a cada ${td.period.toLowerCase()}. Lacunas na linha são períodos sem dado no arquivo.`,
      howTo: 'Compare a forma das linhas: picos mostram quando cada local teve mais casos. Clique na legenda para esconder/mostrar um item.', score: 90,
    });
  }
  const rateOpts = td.situation ? rateOptions(sitNames) : [];
  if (f.mainSit && rateOpts.length) {
    out.push({
      id: 'tid-pos', kind: 'pivot', style: 'bar', x: td.period, agg: 'sum', y: td.value, keepOrder: true, where: mainWhere,
      rate: { options: rateOpts, agravo: td.agravo && f.mainAgr ? [f.mainAgr, NONE] : undefined },
      title: `${f.mainSit}${agrTxt} por ${td.period.toLowerCase()} e positividade`,
      description: `As colunas comparam o mesmo resultado (${f.mainSit}${agrTxt}) em ${td.period.toLowerCase()}s diferentes. A linha laranja (eixo da direita, em %) é a positividade do mesmo ${td.period.toLowerCase()}. Troque a definição de positividade no seletor do gráfico.`,
      why: 'Dois tipos de informação sobre o mesmo período: quantidade (colunas, eixo da esquerda) e taxa em % (linha, eixo da direita). Juntos mostram se um mês tem muitos casos mas poucos positivos, ou o contrário.',
      howTo: 'Colunas = quantidade (eixo da esquerda). Linha = percentual (eixo da direita). Coluna alta com linha baixa = muitos casos, poucos positivos; coluna baixa com linha alta = poucos casos, mas a maioria positiva. Clique numa coluna para ver só aquele período.', score: 97,
    });
  }
  if (td.situation && rest.length >= 2) {
    out.push({
      id: 'tid-comp', kind: 'pivot', style: 'stacked', x: td.entity, seriesBy: td.situation, agg: 'sum', y: td.value, where: { ...agrWhere, ...partWhere(rest.slice(0, 3)) },
      title: `Situação dos casos por ${td.entity.toLowerCase()}: ${rest.slice(0, 3).join(', ')}`,
      description: `Para cada ${td.entity.toLowerCase()}, quanto foi ${rest.slice(0, 3).join(', ').replace(/, ([^,]*)$/, ' e $1')} no período (soma de todos os ${td.period.toLowerCase()}s).`,
      howTo: 'A barra inteira é o total concluído ou em investigação; as cores mostram a proporção de cada situação. Muita cor de “em andamento” indica fila de casos sem conclusão.', score: 88,
    });
  }
  if (td.agravo && f.agrList.filter(([, v]) => v > 0).length >= 2 && level >= 2) {
    out.push({
      id: 'tid-agr', kind: 'pivot', style: 'stacked', x: td.period, seriesBy: td.agravo, agg: 'sum', y: td.value, keepOrder: true, where: td.situation && f.mainSit ? { [td.situation]: [f.mainSit] } : {},
      rate: rateOpts.length ? { options: rateOpts, agravo: f.mainAgr ? [f.mainAgr, NONE] : undefined } : undefined,
      why: rateOpts.length ? 'Colunas empilhadas dividem cada período entre os agravos, e a linha de positividade mostra a taxa do mesmo período no eixo da direita.' : undefined,
      title: `${f.mainSit ?? 'Total'} por ${td.agravo.toLowerCase()} em cada ${td.period.toLowerCase()}`,
      description: `Soma de todos os ${td.entity.toLowerCase()}s, separada por ${td.agravo.toLowerCase()}. Mostra se um agravo domina e se o perfil muda ao longo do tempo.`,
      howTo: 'Cada barra é um período; as cores dividem o total entre os agravos. Um agravo muito pequeno quase não aparece (veja a tabela).', score: 80,
    });
  }
  if (level >= 3 && td.situation) {
    for (const sname of rest.slice(0, 2)) {
      out.push({
        id: `tid-s-${sname}`, kind: 'pivot', style: 'hbar', x: td.entity, agg: 'sum', y: td.value, where: { ...agrWhere, [td.situation]: [sname] },
        title: `${sname}${agrTxt} por ${td.entity.toLowerCase()}`,
        description: `Soma de todos os ${td.period.toLowerCase()}s da situação “${sname}”.`,
        howTo: 'Barras mais longas = maior número nesta situação.', score: 60,
      });
    }
  }
  // novos tipos de gráfico, escolhidos pelo formato dos dados
  const rec0 = rateOpts[0];
  if (td.situation && rec0 && f.mainSit && level >= 2) {
    const conf = rec0.numerator;
    const concl = rec0.denominator;
    out.push({
      id: 'tid-funil', kind: 'funnel', where: agrWhere, y: td.value, stages: [{ label: f.mainSit, situations: [f.mainSit] }, { label: 'Concluídos', situations: concl }, { label: [...conf].sort((a, b) => a.length - b.length)[0]!, situations: conf }],
      title: `Funil dos casos${agrTxt}: de ${f.mainSit} a ${[...conf].sort((a, b) => a.length - b.length)[0]}`,
      description: `Quantos casos chegam a cada etapa (soma de todos os ${td.period.toLowerCase()}s e ${td.entity.toLowerCase()}s) e que fração da etapa anterior isso representa. “Concluídos” = ${concl.join(' + ')}.`,
      why: 'As situações formam etapas em sequência (notificar, concluir, confirmar): o funil mostra onde os casos “saem” do processo.',
      howTo: 'Cada faixa é uma etapa; quanto mais larga, mais casos. O percentual ao lado do nome é a fração da etapa anterior. A diferença entre notificados e concluídos são os casos ainda em andamento.', score: 86,
    });
    const sizeNames = rest.filter((n) => !conf.includes(n) && !concl.includes(n)).slice(0, 1);
    if (f.entities.length >= 3 && sizeNames.length) out.push({
      id: 'tid-bolhas', kind: 'bubble', rate: { options: rateOpts, agravo: td.agravo && f.mainAgr ? [f.mainAgr, NONE] : undefined }, bubble: { x: [f.mainSit], size: sizeNames, xLabel: `${f.mainSit}${agrTxt}`, sizeLabel: sizeNames[0]! },
      title: `${td.entity}: volume × positividade (tamanho = ${sizeNames[0]})`,
      description: `Cada bolha é um ${td.entity.toLowerCase()}: posição horizontal = ${f.mainSit} no período; vertical = positividade (${rec0.label}); tamanho = ${sizeNames[0]}.`,
      why: `São duas medidas por ${td.entity.toLowerCase()} (volume e taxa) mais uma terceira (tamanho): o gráfico de bolhas é o desenho feito para cruzar três medidas.`,
      howTo: 'Bolhas à direita têm mais casos; bolhas no alto têm maior proporção de confirmados; bolha grande = mais casos ainda em andamento. Clique numa bolha para filtrar o painel.', score: 84,
    });
  }
  if (f.periods.length >= 4 && f.entities.length >= 4 && f.mainSit && level >= 3) out.push({
    id: 'tid-calor', kind: 'pivot', style: 'heatmap', lockStyle: true, x: td.period, seriesBy: td.entity, agg: 'sum', y: td.value, keepOrder: true, where: mainWhere,
    title: `Mapa de calor: ${f.mainSit}${agrTxt} por ${td.entity.toLowerCase()} e ${td.period.toLowerCase()}`,
    description: `Cruza ${td.entity.toLowerCase()} × ${td.period.toLowerCase()}; a cor é proporcional ao valor.`, score: 70,
  });
  applyEngine(t, out);
  return out.sort((a, b) => b.score - a.score).slice(0, level === 1 ? 3 : level === 2 ? 8 : 12);
}

/** Alertas e KPIs específicos de tabelas organizadas. */
export function tidyKpis(t: Table): Kpi[] {
  const td = t.tidy!;
  const f = tidyFacts(t);
  const out: Kpi[] = [];
  const mainRows = t.rows.filter((r) => (!f.mainSit || r[td.situation!] === f.mainSit) && (!f.mainAgr || r[td.agravo!] === f.mainAgr));
  const total = mainRows.reduce((a, r) => a + (toNumber(r[VALUE_COL] ?? null) ?? 0), 0);
  out.push({ label: `${f.mainSit ?? 'Total'}${f.mainAgr ? ' ' + f.mainAgr : ''}`, value: fmtNum(total), hint: `soma de todos os ${td.entity.toLowerCase()}s e ${td.period.toLowerCase()}s` });
  const by = (col: string, rows: Row[]) => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const v = toNumber(r[VALUE_COL] ?? null);
      if (v != null) m.set(String(r[col]), (m.get(String(r[col])) ?? 0) + v);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const ent = by(td.entity, mainRows);
  if (ent[0]) out.push({ label: `Maior ${td.entity.toLowerCase()}`, value: ent[0][0], hint: `${fmtNum(ent[0][1])} no período` });
  const per = by(td.period, mainRows);
  if (per[0]) out.push({ label: `Pico (${td.period.toLowerCase()})`, value: per[0][0], hint: `${fmtNum(per[0][1])}` });
  if (td.situation && f.mainSit) {
    const scoped = t.rows.filter((r) => !td.agravo || r[td.agravo] == null || r[td.agravo] === f.mainAgr);
    const sums = by(td.situation, scoped).filter(([n]) => n !== f.mainSit);
    const base = by(td.situation, scoped).find(([n]) => n === f.mainSit)?.[1] || 1;
    for (const [n, v] of sums.slice(0, 3)) out.push({ label: n, value: fmtNum(v), hint: `${((v / base) * 100).toFixed(1).replace('.', ',')}% de ${f.mainSit}${f.mainAgr ? ' ' + f.mainAgr : ''}` });
  }
  out.push({ label: 'Períodos × itens', value: `${f.periods.length} × ${f.entities.length}`, hint: f.periods.join(', ') });
  return out;
}

export function tidyAlerts(t: Table): Alert[] {
  const td = t.tidy!;
  const out: Alert[] = [];
  const key = (r: Row) => `${r[td.entity]}\u0001${r[td.period]}`;
  const tot = new Map<string, { n: number; nulls: number }>();
  for (const r of t.rows) {
    const e = tot.get(key(r)) ?? { n: 0, nulls: 0 };
    e.n++;
    if (r[VALUE_COL] == null) e.nulls++;
    tot.set(key(r), e);
  }
  const full = new Map<string, string[]>();
  for (const [k, v] of tot) if (v.nulls === v.n) {
    const [ent, per] = k.split('\u0001') as [string, string];
    full.set(ent, [...(full.get(ent) ?? []), per]);
  }
  for (const [ent, pers] of full) out.push({ level: 'aviso', text: `${ent}: sem nenhum dado em ${pers.join(', ')}. Não é zero: os totais e comparações desse item estão subestimados nesses períodos.` });
  // valores em branco isolados
  const isolated = [...tot.entries()].filter(([, v]) => v.nulls > 0 && v.nulls < v.n);
  if (isolated.length) out.push({ level: 'info', text: `${isolated.length} combinação(ões) ${td.entity.toLowerCase()}/${td.period.toLowerCase()} têm só alguns indicadores em branco (ex.: ${isolated[0]![0].replace('\u0001', ' em ')}).` });
  // grafias parecidas
  if (td.agravo) {
    const names = [...new Set(t.rows.map((r) => r[td.agravo!]).filter((v): v is string => typeof v === 'string'))];
    for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
      const a = names[i]!.toLowerCase();
      const b = names[j]!.toLowerCase();
      if (a.length === b.length && a.length > 3 && [...a].filter((c, k) => c !== b[k]).length === 1) out.push({ level: 'aviso', text: `“${names[i]}” e “${names[j]}” parecem o mesmo agravo escrito de duas formas; os gráficos os tratam como diferentes.` });
    }
  }
  if (td.agravo) {
    const ag = [...new Set(t.rows.map((r) => r[td.agravo!]).filter((v): v is string => typeof v === 'string'))];
    const labels = [...new Set(t.rows.map((r) => String(r['Indicador'])))];
    for (const l of labels) {
      const w = l.split(/\s+/);
      const last = w[w.length - 1]!.toLowerCase();
      if (w.length < 2 || ag.some((a) => a.toLowerCase() === last)) continue;
      const near = ag.find((a) => a.length === last.length && [...a.toLowerCase()].filter((c, k) => c !== last[k]).length === 1);
      if (near) out.push({ level: 'aviso', text: `“${l}” parece usar outra grafia de “${near}” (${w.slice(0, -1).join(' ')} ${near}); por isso não foi agrupado com os demais indicadores de ${near}. Vale corrigir no arquivo.` });
    }
  }
  for (const n of t.notes ?? []) out.push({ level: 'info', text: n });
  return out;
}

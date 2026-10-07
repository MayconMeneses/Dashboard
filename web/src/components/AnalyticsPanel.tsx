import { useMemo, useState } from 'react';
import type { Analytics } from '../static/analytics';
import { api } from '../lib/api';
import { COLORS, LABEL, filtersToQuery, formatNumber } from '../lib/format';
import type { Filters } from '../lib/types';
import { useAsync } from '../lib/useAsync';
import { ChartCard } from './ChartCard';
import { BarChart, ComboChart, DonutChart, type Series } from './charts';

const EXAM: [keyof Analytics['porLocalidade'][number] & ('positivo' | 'negativo' | 'pendente' | 'nao_realizado' | 'nao_informado'), string][] = [
  ['positivo', 'Positivo'],
  ['negativo', 'Negativo'],
  ['pendente', 'Pendente'],
  ['nao_realizado', 'Não realizado'],
  ['nao_informado', 'Exame não informado'],
];

const EMPTY: never[] = [];
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const mesLabel = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '—');
const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

const NOTA_EXAME = 'Cores: vermelho = positivo, azul = negativo, âmbar = pendente, cinza = não realizado, cinza claro = exame não informado (em branco no arquivo, nunca tratado como negativo).';

interface Props {
  filters: Filters;
  epoch: number;
  onChange: (f: Filters) => void;
}

export function AnalyticsPanel({ filters, epoch, onChange }: Props) {
  const q = filtersToQuery({ ...filters, layers: [] });
  const { data, loading, error, reload } = useAsync(() => api.get<Analytics>(`/api/analytics?${q}`), [q, epoch]);
  const [allLoc, setAllLoc] = useState(false);
  const [covAll, setCovAll] = useState(false);
  const [posAll, setPosAll] = useState(false);

  const a = data;
  const examSeries = (rows: { positivo: number; negativo: number; pendente: number; nao_realizado: number; nao_informado: number }[]): Series[] =>
    EXAM.map(([k, label]) => ({ label, data: rows.map((r) => r[k]), color: COLORS[k] ?? '#999999' })).filter((s) => s.data.some((v) => v > 0));

  // --- localidades
  const loc = useMemo(() => (a ? (allLoc ? a.porLocalidade : a.porLocalidade.slice(0, 15)) : []), [a, allLoc]);
  const locLabels = useMemo(() => loc.map((l) => l.name), [loc]);
  const locSeries = useMemo(() => examSeries(loc), [loc]);
  const locDim = useMemo(() => (i: number) => !!filters.locality && loc[i]?.key !== filters.locality, [loc, filters.locality]);
  const locPick = useMemo(() => (i: number) => onChange({ ...filters, locality: loc[i]?.key === filters.locality ? undefined : loc[i]?.key }), [loc, filters, onChange]);

  // --- espécies
  const spRows = a?.porEspecie ?? EMPTY;
  const spLabels = useMemo(() => spRows.map((s) => s.especie), [spRows]);
  const spSeries = useMemo(() => examSeries(spRows), [spRows]);
  const spDim = useMemo(() => (i: number) => filters.species.length > 0 && !filters.species.includes(spRows[i]?.especie ?? ''), [spRows, filters.species]);
  const spPick = useMemo(() => (i: number) => { const v = spRows[i]?.especie; if (v && v !== 'Não identificada') onChange({ ...filters, species: toggle(filters.species, v) }); }, [spRows, filters, onChange]);

  // --- linha do tempo
  const tl = a?.linhaDoTempo ?? EMPTY;
  const tlLabels = useMemo(() => tl.map((m) => mesLabel(m.mes)), [tl]);
  const tlSeries = useMemo<Series[]>(
    () => [
      { label: 'Positivo', data: tl.map((m) => m.positivos), color: COLORS.positivo! },
      { label: 'Negativo', data: tl.map((m) => m.negativos), color: COLORS.negativo! },
      { label: 'Sem resultado informado', data: tl.map((m) => m.semResultado), color: COLORS.nao_informado! },
    ],
    [tl],
  );
  const inMonth = (mes: string) => filters.from === `${mes}-01` && filters.to === `${mes}-${String(new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0)).getUTCDate()).padStart(2, '0')}`;
  const tlDim = useMemo(() => (i: number) => !!(filters.from || filters.to) && !(tl[i] && ((!filters.from || `${tl[i]!.mes}-31` >= filters.from) && (!filters.to || `${tl[i]!.mes}-01` <= filters.to))), [tl, filters.from, filters.to]);
  const tlPick = useMemo(() => (i: number) => {
    const m = tl[i]?.mes;
    if (!m) return;
    if (inMonth(m)) onChange({ ...filters, from: undefined, to: undefined });
    else onChange({ ...filters, from: `${m}-01`, to: `${m}-${String(new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate()).padStart(2, '0')}` });
  }, [tl, filters, onChange]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- origem e ambiente
  const orig = a?.porOrigem ?? EMPTY;
  const OR_LABEL: Record<string, string> = { captura: 'Captura em campanha', pit: 'Entregue/atendido no PIT', nao_informado: 'Não informado' };
  const OR_COLOR: Record<string, string> = { captura: '#0f766e', pit: '#7c3aed', nao_informado: '#cbd5e1' };
  const amb = a?.porAmbiente ?? EMPTY;
  const AM_LABEL: Record<string, string> = { intra: 'Intradomicílio', peri: 'Peridomicílio', intra_peri: 'Intra e peridomicílio', nao_informado: 'Não informado' };
  const AM_COLOR: Record<string, string> = { intra: '#2563eb', peri: '#d97706', intra_peri: '#0891b2', nao_informado: '#cbd5e1' };

  // --- fase/sexo
  const fs = a?.faseSexo ?? EMPTY;
  // --- positividade por espécie
  const posRows = spRows.filter((r) => r.positivo + r.negativo > 0);
  // --- positividade por localidade (só localidades com exame)
  const posLoc = useMemo(
    () =>
      a
        ? a.porLocalidade
            .filter((l) => l.positivo + l.negativo > 0)
            .map((l) => ({ ...l, n: l.positivo + l.negativo, taxa: Math.round((l.positivo / (l.positivo + l.negativo)) * 1000) / 10 }))
            .sort((x, y) => y.taxa - x.taxa || y.n - x.n || x.name.localeCompare(y.name, 'pt-BR'))
        : [],
    [a],
  );
  const posLocShown = posAll ? posLoc : posLoc.slice(0, 15);
  // --- comparativo entre meses
  const mesRows = useMemo(
    () =>
      tl.map((m, i) => {
        const exam = m.positivos + m.negativos;
        const prev = i > 0 ? tl[i - 1]!.capturas : null;
        return { ...m, exam, taxa: exam > 0 ? Math.round((m.positivos / exam) * 1000) / 10 : null, variacao: prev ? Math.round(((m.capturas - prev) / prev) * 100) : null };
      }),
    [tl],
  );
  const mesBars = useMemo<Series[]>(() => [{ label: 'Captura em campanha', data: tl.map((m) => m.campanha), color: '#0f766e' }, { label: 'Entregue/atendido no PIT', data: tl.map((m) => m.pit), color: '#7c3aed' }], [tl]);
  const mesLine = useMemo(() => ({ label: 'Positividade (%)', data: mesRows.map((m) => m.taxa), color: COLORS.positivo! }), [mesRows]);
  // --- cobertura
  const cov = useMemo(() => (a ? a.porLocalidade.filter((l) => l.capturasPor100Imoveis !== null).sort((x, y) => (y.capturasPor100Imoveis ?? 0) - (x.capturasPor100Imoveis ?? 0)) : []), [a]);
  const covShown = covAll ? cov : cov.slice(0, 15);

  if (error) return <div className="notice erro" role="alert">{error} <button className="small" onClick={reload}>Tentar de novo</button></div>;
  if (!a) return <div className="skeleton" style={{ height: 240 }} aria-busy={loading} />;
  if (a.resumo.capturas === 0 && !loading) {
    return (
      <section className="card" aria-label="Análises">
        <h2>Análises</h2>
        <div className="notice info">Nenhum registro de captura para os filtros atuais. Limpe os filtros para ver os gráficos.</div>
      </section>
    );
  }

  const t = a.tempoAteResultado;
  const examTable = (rows: ({ positivo: number; negativo: number; pendente: number; nao_realizado: number; nao_informado: number; total: number })[], first: (i: number) => string, head: string) => ({
    head: [head, 'Positivo', 'Negativo', 'Pendente', 'Não realizado', 'Exame não informado', 'Total'],
    rows: rows.map((r, i) => [first(i), r.positivo, r.negativo, r.pendente, r.nao_realizado, r.nao_informado, r.total]),
  });

  const maxHeat = Math.max(1, ...a.especieAmbiente.flatMap((r) => [r.intra, r.peri, r.intra_peri, r.nao_informado]));

  return (
    <section aria-label="Análises" className="stack">
      <div>
        <h2 style={{ marginBottom: 4 }}>Análises</h2>
        <p className="small muted" style={{ margin: 0 }}>
          Todos os gráficos seguem os filtros acima. Cada gráfico ignora o filtro da própria dimensão, para você comparar e trocar a seleção com um clique. Contagens são de <strong>registros de captura</strong> (um registro pode ter mais de um inseto, mas o arquivo não informa a quantidade).
        </p>
      </div>

      <div className="mini-kpis">
        <div className="card"><div className="small muted">Capturas analisadas</div><div className="v">{formatNumber(a.resumo.capturas)}</div></div>
        <div className="card"><div className="small muted">Com resultado de exame</div><div className="v">{formatNumber(a.resumo.comResultado)}</div><div className="small muted">{pct(a.resumo.comResultado, a.resumo.capturas)} das capturas</div></div>
        <div className="card" title="Positivos ÷ (positivos + negativos). Só entra quem tem resultado."><div className="small muted">Positividade entre as examinadas</div><div className="v">{a.resumo.positividade === null ? 'Sem dado' : `${a.resumo.positividade.toLocaleString('pt-BR')}%`}</div><div className="small muted">{a.resumo.positivos} de {a.resumo.comResultado}</div></div>
        <div className="card" title="Dias entre a data de captura e a data do exame"><div className="small muted">Mediana até o resultado</div><div className="v">{t.medianaDias === null ? 'Sem dado' : `${t.medianaDias.toLocaleString('pt-BR')} dias`}</div><div className="small muted">{t.comAsDuasDatas} registros com as duas datas</div></div>
        <div className="card" title="Soma da 'Quantidade de Imóveis' informada nos pontos de localidade do arquivo"><div className="small muted">Imóveis nas localidades</div><div className="v">{a.resumo.imoveis === null ? 'Sem dado' : formatNumber(a.resumo.imoveis)}</div><div className="small muted">{a.resumo.localidadesComImoveis} localidades com esse dado</div></div>
      </div>

      <div className="analytics-grid">
        <ChartCard
          id="capturas-por-localidade"
          title="Capturas por localidade"
          unit="registros de captura"
          how="cada barra é uma localidade; o comprimento é o número de capturas e as cores mostram o resultado do exame. O número no fim da barra é o total."
          hint="Clique em uma barra para filtrar o painel por aquela localidade; clique de novo para desfazer."
          note={<>{NOTA_EXAME} {a.porLocalidade.length > 15 && !allLoc ? `Mostrando as 15 localidades com mais capturas de ${a.porLocalidade.length}.` : ''}</>}
          table={examTable(a.porLocalidade, (i) => a.porLocalidade[i]!.name, 'Localidade')}
          wide
        >
          <BarChart labels={locLabels} series={locSeries} unit="registros de captura" stacked totals dimmed={locDim} onPick={locPick} ariaLabel="Barras horizontais: capturas por localidade e resultado do exame" />
          {a.porLocalidade.length > 15 && <button className="small" onClick={() => setAllLoc((v) => !v)}>{allLoc ? 'Mostrar só as 15 primeiras' : `Mostrar todas as ${a.porLocalidade.length} localidades`}</button>}
        </ChartCard>

        <ChartCard
          id="especies"
          title="Espécies de triatomíneos encontradas"
          unit="registros de captura"
          how="cada barra é uma espécie; as cores mostram o resultado do exame para aquela espécie. A espécie é lida do nome do registro (ex.: “Brasiliensis”, “P. Lutzi”)."
          hint="Clique em uma espécie para filtrar o painel."
          note={<>{NOTA_EXAME} “Não identificada” = registro sem espécie reconhecida no nome.</>}
          table={examTable(spRows, (i) => spRows[i]!.especie, 'Espécie')}
        >
          <BarChart labels={spLabels} series={spSeries} unit="registros de captura" stacked totals dimmed={spDim} onPick={spPick} ariaLabel="Barras horizontais: capturas por espécie e resultado do exame" rowHeight={30} thickness={14} />
        </ChartCard>

        <ChartCard
          id="positividade-por-especie"
          title="Positividade por espécie"
          unit="% de positivos entre as examinadas"
          how="para cada espécie: positivos ÷ (positivos + negativos). Só contam capturas com resultado de exame. O “n” entre parênteses é quantas foram examinadas."
          note="Com poucos exames (n pequeno) o percentual varia muito: 1 positivo em 2 exames dá 50%. Leia junto com o n. Espécies sem nenhum exame não aparecem."
          table={{ head: ['Espécie', 'Positivos', 'Negativos', 'Examinadas (n)', 'Positividade (%)'], rows: posRows.map((r) => [r.especie, r.positivo, r.negativo, r.positivo + r.negativo, Math.round((r.positivo / (r.positivo + r.negativo)) * 1000) / 10]) }}
        >
          {posRows.length === 0 ? <div className="notice info">Nenhuma captura com resultado de exame para estes filtros.</div> : (
            <BarChart
              labels={posRows.map((r) => `${r.especie} (n=${r.positivo + r.negativo})`)}
              series={[{ label: 'Positividade', data: posRows.map((r) => Math.round((r.positivo / (r.positivo + r.negativo)) * 1000) / 10), color: COLORS.positivo! }]}
              unit="% de positivos" percent totals suffix="%"
              extraTooltip={(i) => `${posRows[i]!.positivo} positivo(s) e ${posRows[i]!.negativo} negativo(s)`}
              ariaLabel="Barras horizontais: positividade por espécie" rowHeight={30} thickness={14}
            />
          )}
        </ChartCard>

        <ChartCard
          id="positividade-por-localidade"
          title="Positividade por localidade"
          unit="% de positivos entre as examinadas"
          how="para cada localidade: positivos ÷ (positivos + negativos), só com capturas que têm resultado de exame. O “n” é quantas foram examinadas naquela localidade."
          hint="Clique em uma barra para filtrar por localidade."
          note={<>Cuidado com o n: 1 positivo em 1 exame dá 100%, e isso não significa muito. Localidades sem nenhum exame não aparecem. {posLoc.length > 15 && !posAll ? `Mostrando as 15 com maior positividade de ${posLoc.length}.` : ''}</>}
          table={{ head: ['Localidade', 'Positivos', 'Negativos', 'Examinadas (n)', 'Positividade (%)'], rows: posLoc.map((l) => [l.name, l.positivo, l.negativo, l.n, l.taxa]) }}
        >
          {posLoc.length === 0 ? <div className="notice info">Nenhuma localidade com exame para estes filtros.</div> : (
            <>
              <BarChart
                labels={posLocShown.map((l) => `${l.name} (n=${l.n})`)}
                series={[{ label: 'Positividade', data: posLocShown.map((l) => l.taxa), color: COLORS.positivo! }]}
                unit="% de positivos" percent totals suffix="%"
                dimmed={(i) => !!filters.locality && posLocShown[i]?.key !== filters.locality}
                onPick={(i) => onChange({ ...filters, locality: posLocShown[i]?.key === filters.locality ? undefined : posLocShown[i]?.key })}
                extraTooltip={(i) => `${posLocShown[i]!.positivo} positivo(s) e ${posLocShown[i]!.negativo} negativo(s)`}
                ariaLabel="Barras horizontais: positividade por localidade" rowHeight={24}
              />
              {posLoc.length > 15 && <button className="small" onClick={() => setPosAll((v) => !v)}>{posAll ? 'Mostrar só as 15 primeiras' : `Mostrar todas as ${posLoc.length}`}</button>}
            </>
          )}
        </ChartCard>

        <ChartCard
          id="linha-do-tempo"
          title="Capturas ao longo do tempo"
          unit="registros de captura por mês"
          how="cada coluna é um mês (pela data de captura); as cores mostram o resultado do exame. O número no topo é o total do mês."
          hint="Clique em um mês para filtrar o painel por esse período."
          note={<>Este gráfico mostra todos os meses, mesmo quando há filtro de período (o período escolhido fica em destaque). {a.semDataCaptura > 0 ? `${a.semDataCaptura} registro(s) sem data de captura não aparecem aqui.` : ''}</>}
          table={{ head: ['Mês', 'Positivo', 'Negativo', 'Sem resultado informado', 'Total'], rows: tl.map((m) => [m.mes, m.positivos, m.negativos, m.semResultado, m.capturas]) }}
        >
          <BarChart labels={tlLabels} series={tlSeries} unit="registros de captura" horizontal={false} stacked totals dimmed={tlDim} onPick={tlPick} thickness={26} ariaLabel="Colunas: capturas por mês e resultado do exame" />
        </ChartCard>

        <ChartCard
          id="comparativo-meses"
          title="Comparativo entre meses"
          unit="capturas por mês e % de positivos"
          how="as colunas comparam, mês a mês, as capturas feitas em campanha e as entregues/atendidas em PIT (eixo da esquerda). A linha vermelha é a positividade do mês (eixo da direita)."
          hint="Clique em um mês para filtrar o painel por esse período. No balão, veja a variação em relação ao mês anterior."
          note={<>A positividade do mês só usa capturas com resultado; meses com poucos exames oscilam muito (a linha some quando não há nenhum exame). O mês corrente pode estar incompleto. Veja a variação mensal na tabela.</>}
          table={{ head: ['Mês', 'Campanha', 'PIT', 'Sem origem', 'Total', 'Variação vs mês anterior (%)', 'Examinadas (n)', 'Positivos', 'Positividade (%)'], rows: mesRows.map((m) => [m.mes, m.campanha, m.pit, m.semOrigem, m.capturas, m.variacao, m.exam, m.positivos, m.taxa]) }}
          wide
        >
          <ComboChart
            labels={tlLabels} bars={mesBars} line={mesLine} unit="registros de captura" unitRight="% de positivos"
            dimmed={tlDim} onPick={tlPick}
            extraTooltip={(i) => { const m = mesRows[i]!; return `Total: ${m.capturas}${m.variacao === null ? '' : ` (${m.variacao > 0 ? '+' : ''}${m.variacao}% vs mês anterior)`} · ${m.exam} examinada(s)`; }}
            ariaLabel="Colunas e linha: capturas por mês e origem, com positividade mensal"
          />
        </ChartCard>

        <ChartCard
          id="origem-da-captura"
          title="Origem da captura"
          unit="registros de captura"
          how="mostra como o inseto chegou à vigilância: capturado pelos agentes na campanha ou entregue/atendido em um PIT (Posto de Informação de Triatomíneos). O número no centro é o total."
          hint="Clique em uma fatia para filtrar."
          note={<>Origem lida do campo “Campanha_Captura ou PIT” do arquivo.</>}
          table={{ head: ['Origem', 'Positivo', 'Negativo', 'Pendente', 'Não realizado', 'Exame não informado', 'Total'], rows: orig.map((r) => [OR_LABEL[r.chave] ?? r.chave, r.positivo, r.negativo, r.pendente, r.nao_realizado, r.nao_informado, r.total]) }}
        >
          <DonutChart
            labels={orig.map((r) => OR_LABEL[r.chave]!)} values={orig.map((r) => r.total)} colors={orig.map((r) => OR_COLOR[r.chave]!)} unit="registros"
            centerText={String(orig.reduce((s, r) => s + r.total, 0))} centerSub="capturas"
            dimmed={(i) => filters.channel.length > 0 && !filters.channel.includes(orig[i]!.chave)}
            onPick={(i) => { const k = orig[i]!.chave; if (k !== 'nao_informado') onChange({ ...filters, channel: toggle(filters.channel, k) }); }}
            ariaLabel="Rosca: origem da captura (campanha ou PIT)"
          />
        </ChartCard>

        <ChartCard
          id="ambiente"
          title="Onde o inseto foi encontrado"
          unit="registros de captura"
          how="intradomicílio = dentro da casa; peridomicílio = no entorno (galinheiro, curral, depósitos). O número no centro é o total."
          hint="Clique em uma fatia para filtrar."
          note="Ambiente lido do campo “INTRA ou PERI”. Casas onde houve captura nos dois ambientes aparecem como “Intra e peridomicílio”."
          table={{ head: ['Ambiente', 'Positivo', 'Negativo', 'Pendente', 'Não realizado', 'Exame não informado', 'Total'], rows: amb.map((r) => [AM_LABEL[r.chave] ?? r.chave, r.positivo, r.negativo, r.pendente, r.nao_realizado, r.nao_informado, r.total]) }}
        >
          <DonutChart
            labels={amb.map((r) => AM_LABEL[r.chave]!)} values={amb.map((r) => r.total)} colors={amb.map((r) => AM_COLOR[r.chave]!)} unit="registros"
            centerText={String(amb.reduce((s, r) => s + r.total, 0))} centerSub="capturas"
            dimmed={(i) => filters.environment.length > 0 && !filters.environment.includes(amb[i]!.chave)}
            onPick={(i) => { const k = amb[i]!.chave; if (k !== 'nao_informado') onChange({ ...filters, environment: toggle(filters.environment, k) }); }}
            ariaLabel="Rosca: ambiente da captura (intradomicílio ou peridomicílio)"
          />
        </ChartCard>

        <ChartCard
          id="fase-e-sexo"
          title="Fase e sexo dos triatomíneos"
          unit="registros de captura"
          how="ninfa = inseto jovem; adultos são separados em macho e fêmea. Registros com mais de um tipo aparecem em “Ninfa e adulto” ou “Macho e Fêmea”."
          note="Lido do campo “Ninfa_Macho ou Femea”. “Não informado” = campo em branco."
          table={{ head: ['Categoria', 'Registros'], rows: fs.map((r) => [r.categoria, r.total]) }}
        >
          <BarChart labels={fs.map((r) => r.categoria)} series={[{ label: 'Registros', data: fs.map((r) => r.total), color: '#0f766e' }]} unit="registros de captura" totals ariaLabel="Barras horizontais: fase e sexo" rowHeight={28} thickness={14} />
        </ChartCard>

        <ChartCard
          id="tempo-ate-resultado"
          title="Tempo entre a captura e o resultado do exame"
          unit="registros de captura por faixa de dias"
          how="cada coluna agrupa capturas pelo número de dias entre a data de captura e a data do exame. Colunas mais à direita = resultado mais demorado."
          note={<>Considera só registros com as duas datas ({t.comAsDuasDatas}). {t.semDataDoExame} registro(s) sem data de exame ficam de fora. {t.minDias !== null ? `Mínimo ${t.minDias} dia(s), máximo ${t.maxDias}.` : ''} A faixa “Exame antes da captura” indica data digitada errada: confira no arquivo.</>}
          table={{ head: ['Faixa', 'Registros'], rows: t.faixas.map((f) => [f.faixa, f.total]) }}
        >
          <BarChart labels={t.faixas.map((f) => f.faixa.replace('Exame antes da captura (conferir)', 'Antes da captura'))} series={[{ label: 'Registros', data: t.faixas.map((f) => f.total), color: '#2563eb' }]} unit="registros de captura" horizontal={false} totals thickness={34} ariaLabel="Colunas: dias entre a captura e o resultado do exame" />
        </ChartCard>

        <ChartCard
          id="cobertura"
          title="Capturas por 100 imóveis"
          unit="capturas ÷ imóveis × 100"
          how="compara localidades de tamanhos diferentes: o número de capturas dividido pelo número de imóveis da localidade (informado no arquivo), vezes 100."
          hint="Clique em uma barra para filtrar por localidade."
          note="Só entram localidades com a “Quantidade de Imóveis” informada no arquivo. Valores altos em localidades pequenas podem vir de poucas capturas."
          table={{ head: ['Localidade', 'Capturas', 'Imóveis', 'Capturas por 100 imóveis'], rows: cov.map((l) => [l.name, l.total, l.imoveis, l.capturasPor100Imoveis]) }}
        >
          {cov.length === 0 ? <div className="notice info">Nenhuma localidade com imóveis informados e capturas para estes filtros.</div> : (
            <>
              <BarChart
                labels={covShown.map((l) => l.name)}
                series={[{ label: 'Capturas por 100 imóveis', data: covShown.map((l) => l.capturasPor100Imoveis ?? 0), color: '#7c3aed' }]}
                unit="capturas por 100 imóveis" totals
                dimmed={(i) => !!filters.locality && covShown[i]?.key !== filters.locality}
                onPick={(i) => onChange({ ...filters, locality: covShown[i]?.key === filters.locality ? undefined : covShown[i]?.key })}
                extraTooltip={(i) => `${covShown[i]!.total} captura(s) em ${covShown[i]!.imoveis} imóveis`}
                ariaLabel="Barras horizontais: capturas por 100 imóveis" rowHeight={24}
              />
              {cov.length > 15 && <button className="small" onClick={() => setCovAll((v) => !v)}>{covAll ? 'Mostrar só as 15 primeiras' : `Mostrar todas as ${cov.length}`}</button>}
            </>
          )}
        </ChartCard>

        <ChartCard
          id="especie-x-ambiente"
          title="Espécie × ambiente (mapa de calor)"
          unit="registros de captura"
          how="cada célula é o número de capturas de uma espécie (linha) em um ambiente (coluna). Quanto mais escura a célula, mais capturas."
          hint="Clique em uma célula para filtrar por aquela espécie e ambiente."
          note="Mostra onde cada espécie é mais encontrada: dentro de casa (intra) ou no entorno (peri)."
          table={{ head: ['Espécie', 'Intradomicílio', 'Peridomicílio', 'Intra e peridomicílio', 'Não informado', 'Total'], rows: a.especieAmbiente.map((r) => [r.especie, r.intra, r.peri, r.intra_peri, r.nao_informado, r.total]) }}
          noPng
        >
          <div className="table-wrap">
            <table className="heat">
              <thead><tr><th /><th>Intradomicílio</th><th>Peridomicílio</th><th>Intra e peri</th><th>Não informado</th><th>Total</th></tr></thead>
              <tbody>
                {a.especieAmbiente.map((r) => (
                  <tr key={r.especie}>
                    <th className="sp" scope="row">{r.especie}</th>
                    {(['intra', 'peri', 'intra_peri', 'nao_informado'] as const).map((k) => {
                      const v = r[k];
                      const active = filters.species.includes(r.especie) && filters.environment.includes(k);
                      return (
                        <td
                          key={k} className="cell" tabIndex={k === 'nao_informado' || r.especie === 'Não identificada' ? -1 : 0} role="button"
                          aria-label={`${r.especie}, ${AM_LABEL[k]}: ${v} captura(s)`}
                          style={{ background: v === 0 ? 'transparent' : `color-mix(in srgb, #0f766e ${Math.round(12 + (v / maxHeat) * 78)}%, transparent)`, color: v / maxHeat > 0.55 ? '#fff' : 'inherit', outline: active ? '2px solid var(--focus)' : undefined }}
                          onClick={() => { if (k === 'nao_informado' || r.especie === 'Não identificada') return; onChange(active ? { ...filters, species: filters.species.filter((s) => s !== r.especie), environment: filters.environment.filter((e) => e !== k) } : { ...filters, species: [r.especie], environment: [k] }); }}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}
                        >{v === 0 ? '·' : v}</td>
                      );
                    })}
                    <td style={{ textAlign: 'center', fontWeight: 700 }}>{r.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ChartCard>

        <ChartCard
          id="pits"
          title="Postos de Informação de Triatomíneos (PITs)"
          unit="PITs cadastrados"
          how="lista os PITs do arquivo, com a unidade, a zona (urbana ou rural) e a localidade onde ficam. Os endereços não aparecem."
          hint="Clique em uma linha para filtrar por localidade."
          note="Dados dos pontos da pasta “pits” do KML."
          table={{ head: ['PIT', 'Unidade', 'Zona', 'Localidade'], rows: a.pits.map((p) => [p.nome, p.unidade, p.zona, p.localidade]) }}
          noPng wide
        >
          {a.pits.length === 0 ? <div className="notice info">Nenhum PIT no arquivo.</div> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>PIT</th><th>Unidade</th><th>Zona</th><th>Localidade</th></tr></thead>
                <tbody>
                  {a.pits.map((p) => (
                    <tr key={p.nome} tabIndex={p.localityKey ? 0 : -1} style={{ cursor: p.localityKey ? 'pointer' : 'default' }}
                      onClick={() => p.localityKey && onChange({ ...filters, locality: p.localityKey === filters.locality ? undefined : p.localityKey })}
                      onKeyDown={(e) => e.key === 'Enter' && p.localityKey && onChange({ ...filters, locality: p.localityKey })}>
                      <td>{p.nome}</td><td>{p.unidade ?? '—'}</td><td>{p.zona ?? '—'}</td><td>{p.localidade ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ChartCard>
      </div>
      <p className="small muted" style={{ margin: 0 }}>Rótulos: {LABEL.positivo}, {LABEL.negativo}, {LABEL.pendente}, {LABEL.nao_realizado} e “Exame não informado” referem-se ao resultado do exame dos triatomíneos; não têm relação com o resultado da busca (com/sem captura).</p>
    </section>
  );
}

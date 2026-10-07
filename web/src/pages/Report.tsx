import { useMemo } from 'react';
import { AnalyticsPanel } from '../components/AnalyticsPanel';
import { ChartPanel } from '../components/ChartPanel';
import { activeChips } from '../components/FilterBar';
import { Kpis } from '../components/Kpis';
import { LocalityNamesMap } from '../components/LocalityNamesMap';
import { LocationMaps } from '../components/LocationMaps';
import { MapPanel } from '../components/MapPanel';
import { RecordsAppendix } from '../components/RecordsAppendix';
import { api } from '../lib/api';
import { downloadCsv } from '../components/charts';
import { LABEL, filtersToQuery, formatDate, formatDateTime } from '../lib/format';
import { IS_STATIC, getSnapshot } from '../lib/static';
import type { Filters, Locality, Me, Summary } from '../lib/types';
import { useAsync } from '../lib/useAsync';
import { AboutPage } from './About';

function fromUrl(): Filters {
  const p = new URLSearchParams(window.location.search);
  const list = (k: string) => p.get(k)?.split(',').filter(Boolean) ?? [];
  return { from: p.get('from') ?? undefined, to: p.get('to') ?? undefined, locality: p.get('locality') ?? undefined, layers: [], search: list('search'), exam: list('exam'), channel: list('channel'), species: list('species'), environment: list('environment') };
}

const noop = () => undefined;

/**
 * Relatório completo em uma página só: indicadores, mapas, todos os gráficos, lista de registros e notas.
 * Pensado para impressão / "Salvar como PDF" (o botão abre a janela de impressão do navegador).
 */
export function ReportPage({ me, epoch }: { me: Me; epoch: number }) {
  const filters = useMemo(fromUrl, []);
  const sq = filtersToQuery(filters);
  const summary = useAsync(() => api.get<Summary>(`/api/summary?${sq}`), [sq, epoch]);
  const locs = useAsync(() => api.get<Locality[]>('/api/localities'), [epoch]);
  const chips = activeChips(filters, locs.data ?? []);
  const snap = IS_STATIC ? getSnapshot() : null;
  const v = summary.data?.versao;

  function csvAll() {
    if (!snap) return;
    const rows = snap.rec.filter((r) => ['captura', 'visita', 'pit'].includes(r.type));
    downloadCsv(
      ['localidade', 'tipo', 'registro', 'data_captura', 'data_exame', 'resultado_exame', 'especie', 'fase', 'sexo', 'origem', 'ambiente', 'zona_pit', 'unidade_pit', 'latitude', 'longitude'],
      rows.map((r) => [r.locality_raw, LABEL[r.type] ?? r.type, r.name, r.visit_date, r.exam_date, r.type === 'captura' ? (LABEL[r.exam_result] ?? '') : '', r.species, r.stage, r.sex, r.channel === 'pit' ? 'PIT' : r.channel === 'captura' ? 'Campanha' : '', r.environment ? (LABEL[r.environment] ?? '') : '', r.zone ?? '', r.type === 'pit' ? r.pit_ref ?? '' : '', r.lat, r.lng]),
      'dados-triatomineos-croata',
    );
  }

  return (
    <div className="report">
      <section className="card no-print report-actions" aria-label="Ações do relatório">
        <h2>Relatório completo</h2>
        <p className="small" style={{ margin: 0 }}>
          Esta página reúne <strong>todas as informações do painel</strong> em sequência: indicadores, mapas, todos os gráficos (com “como ler” e avisos), a lista de registros e as notas sobre os dados.
          Para guardar em arquivo, clique em <strong>Baixar PDF</strong> e, na janela que abrir, escolha <em>Salvar como PDF</em> como destino (papel A4, orientação retrato; ative “Gráficos de segundo plano” se existir).
        </p>
        <div className="row">
          <button className="primary" onClick={() => window.print()}>Baixar PDF (imprimir)</button>
          {IS_STATIC && snap && <button onClick={csvAll}>Baixar dados (CSV)</button>}
          {!IS_STATIC && me.permissions.exportar && <a className="btn" href={`/api/export/records.csv?${filtersToQuery({ ...filters, layers: ['captura', 'visita', 'pit'] })}`}>Baixar dados (CSV)</a>}
        </div>
        {chips.length > 0 && <p className="small muted" style={{ margin: 0 }}>O relatório respeita os filtros ativos no painel (veja abaixo). Para um relatório completo, limpe os filtros antes.</p>}
      </section>

      <header className="report-head">
        <h1>Vigilância de triatomíneos – Croatá/CE</h1>
        <p className="small muted" style={{ margin: 0 }}>
          {v ? `Arquivo: ${v.arquivo} · dados de ${formatDateTime(v.ativadoEm)}` : 'Sem arquivo ativo'} · Relatório gerado em {formatDate(new Date().toISOString().slice(0, 10))}
        </p>
        <p className="small muted" style={{ margin: 0 }}>
          Ferramenta de apoio à análise; não substitui os formulários nem os procedimentos oficiais da vigilância. Resultado da busca e resultado do exame são medidas diferentes e nunca são somadas. “Sem dado” = o arquivo não traz a informação (não é zero).
        </p>
        <p className="small" style={{ margin: 0 }}><strong>Filtros aplicados:</strong> {chips.length ? chips.map((c) => c.label).join(' · ') : 'nenhum (todos os registros)'}</p>
      </header>

      <Kpis summary={summary.data} loading={summary.loading} />
      <AnalyticsPanel filters={filters} epoch={epoch} onChange={noop} reportMode />
      <ChartPanel filters={filters} epoch={epoch} selected={filters.locality} onSelect={noop} />
      <LocationMaps filters={filters} epoch={epoch} selected={filters.locality} onSelect={noop} />
      <LocalityNamesMap me={me} />
      <MapPanel me={me} filters={filters} epoch={epoch} selected={filters.locality} onSelect={noop} />
      <RecordsAppendix filters={filters} epoch={epoch} />
      {IS_STATIC && <AboutPage snapshot={snap} />}
    </div>
  );
}

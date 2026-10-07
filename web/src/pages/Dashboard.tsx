import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { filtersToQuery } from '../lib/format';
import type { Filters, Locality, Me, Summary } from '../lib/types';
import { useAsync } from '../lib/useAsync';
import { ChartPanel } from '../components/ChartPanel';
import { DetailPanel } from '../components/DetailPanel';
import { DEFAULT_FILTERS, FilterBar } from '../components/FilterBar';
import { Kpis } from '../components/Kpis';
import { LocationMaps } from '../components/LocationMaps';
import { MapPanel } from '../components/MapPanel';

function fromUrl(): Filters {
  const p = new URLSearchParams(window.location.search);
  const list = (k: string) => p.get(k)?.split(',').filter(Boolean) ?? [];
  return { from: p.get('from') ?? undefined, to: p.get('to') ?? undefined, locality: p.get('locality') ?? undefined, layers: list('layers'), search: list('search'), exam: list('exam'), channel: list('channel'), species: list('species') };
}

export function DashboardPage({ me, epoch, goImport }: { me: Me; epoch: number; goImport: () => void }) {
  const [filters, setFilters] = useState<Filters>(() => ({ ...DEFAULT_FILTERS, ...fromUrl() }));
  const [focus, setFocus] = useState<{ lat: number; lng: number; n: number }>();
  useEffect(() => {
    const qs = filtersToQuery(filters);
    window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
  }, [filters]);

  const sq = filtersToQuery(filters);
  const summary = useAsync(() => api.get<Summary>(`/api/summary?${sq}`), [sq, epoch]);
  const locs = useAsync(() => api.get<Locality[]>('/api/localities'), [epoch]);
  const localities = locs.data ?? [];
  const empty = summary.data && !summary.data.versao && (summary.data.kpis.visitas.status === 'ausente');

  const select = (key: string | undefined) => {
    setFilters((f) => ({ ...f, locality: key }));
    if (key) document.getElementById('detalhe')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };

  if (empty) {
    return (
      <div className="card stack" style={{ maxWidth: 640, margin: '24px auto' }}>
        <h2>Ainda não há dados</h2>
        <p>Envie o arquivo KML/KMZ da campanha para montar o painel. Os dados atuais continuam intactos até você confirmar a ativação.</p>
        {me.permissions.importar ? (
          <button className="primary" onClick={goImport}>Enviar arquivo KML/KMZ</button>
        ) : (
          <p className="muted small">Peça a um analista ou administrador para enviar o arquivo.</p>
        )}
      </div>
    );
  }

  return (
    <div className="stack">
      {summary.error && <div className="notice erro" role="alert">{summary.error} <button className="small" onClick={summary.reload}>Tentar de novo</button></div>}
      <Kpis summary={summary.data} loading={summary.loading} />
      <FilterBar filters={filters} onChange={setFilters} localities={localities} epoch={epoch} />
      <LocationMaps filters={filters} epoch={epoch} selected={filters.locality} onSelect={select} />
      <div className="grid main-grid">
        <ChartPanel filters={filters} epoch={epoch} selected={filters.locality} onSelect={select} />
        <MapPanel me={me} filters={filters} epoch={epoch} selected={filters.locality} onSelect={select} focus={focus} />
      </div>
      <DetailPanel me={me} filters={filters} epoch={epoch} localities={localities} onClear={() => select(undefined)} onFocus={(p) => setFocus({ ...p, n: Date.now() })} />
    </div>
  );
}

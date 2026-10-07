import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { CHANNEL_LABEL, LABEL, filtersToQuery, formatDate, formatNumber } from '../lib/format';
import type { Filters, Locality, Me, RecordRow } from '../lib/types';
import { useAsync } from '../lib/useAsync';

interface Props {
  me: Me;
  filters: Filters;
  epoch: number;
  localities: Locality[];
  onClear: () => void;
  onFocus: (r: { lat: number; lng: number }) => void;
}

const COLS: [string, string][] = [
  ['type', 'Tipo'],
  ['name', 'Registro'],
  ['visit_date', 'Data'],
  ['search_result', 'Busca'],
  ['exam_result', 'Exame'],
  ['species', 'Espécie'],
  ['channel', 'Origem da captura'],
  ['environment', 'Ambiente'],
  ['triatomine_count', 'Qtd'],
  ['origin', 'Origem'],
];

export function DetailPanel({ me, filters, epoch, localities, onClear, onFocus }: Props) {
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ col: string; dir: 'asc' | 'desc' }>({ col: 'visit_date', dir: 'desc' });
  const [q, setQ] = useState('');
  const [showAddr, setShowAddr] = useState(false);
  const f: Filters = { ...filters, q: q || undefined };
  const base = filtersToQuery(f);
  useEffect(() => setPage(1), [base]);
  const query = `${base}&${new URLSearchParams({ page: String(page), pageSize: '20', sort: sort.col, dir: sort.dir, includeAddress: String(showAddr) })}`;
  const { data, loading, error, reload } = useAsync(() => api.get<{ total: number; rows: RecordRow[] }>(`/api/records?${query}`), [query, epoch]);
  const loc = localities.find((l) => l.key === filters.locality);
  const pages = data ? Math.max(1, Math.ceil(data.total / 20)) : 1;
  const csvQ = filtersToQuery({ ...filters, layers: filters.layers.length ? filters.layers : ['captura', 'visita', 'pit'] }, { includeAddress: showAddr });

  return (
    <section className="card sticky-detail" id="detalhe" aria-label="Registros">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>{loc ? `Registros de ${loc.name}` : 'Registros (todas as localidades)'}</h2>
        {loc && (
          <button className="small" onClick={onClear}>
            Desmarcar localidade
          </button>
        )}
      </div>
      <div className="toolbar" style={{ marginTop: 12 }}>
        <label className="field">
          Buscar
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="nome, espécie, imóvel" />
        </label>
        {me.permissions.restrito && (
          <label className="checks">
            <input type="checkbox" checked={showAddr} onChange={(e) => setShowAddr(e.target.checked)} /> Mostrar endereço (restrito)
          </label>
        )}
        {me.permissions.exportar && (
          <a className="btn small" href={`/api/export/records.csv?${csvQ}`}>
            Exportar CSV
          </a>
        )}
        <span className="small muted">{data ? `${formatNumber(data.total)} registro(s)` : ''}</span>
      </div>
      {error && (
        <div className="notice erro" role="alert">
          {error} <button className="small" onClick={reload}>Tentar de novo</button>
        </div>
      )}
      {loading && !data && <div className="skeleton" style={{ height: 160 }} aria-busy="true" />}
      {data && data.rows.length === 0 && <div className="notice info">Nenhum registro para os filtros atuais. Limpe os filtros ou escolha outra localidade.</div>}
      {data && data.rows.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {COLS.map(([c, label]) => (
                  <th key={c} aria-sort={sort.col === c ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <button onClick={() => setSort((s) => ({ col: c, dir: s.col === c && s.dir === 'asc' ? 'desc' : 'asc' }))}>
                      {label}
                      {sort.col === c ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                    </button>
                  </th>
                ))}
                {showAddr && <th>Endereço</th>}
                <th>Localidade</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => {
                const go = () => r.lat != null && r.lng != null && onFocus({ lat: r.lat, lng: r.lng });
                return (
                  <tr key={r.rid} tabIndex={0} onClick={go} onKeyDown={(e) => e.key === 'Enter' && go()} title={r.lat != null ? 'Mostrar no mapa' : 'Sem coordenadas'}>
                    <td>{LABEL[r.type] ?? r.type}</td>
                    <td>{r.name || '—'}{r.duplicate_of != null && <span className="badge pendente" title="Possível duplicata"> duplicata?</span>}</td>
                    <td>{formatDate(r.visit_date)}</td>
                    <td>{r.type === 'captura' || r.type === 'visita' ? <span className={`badge ${r.search_result}`}>{LABEL[r.search_result]}</span> : '—'}</td>
                    <td>{r.type === 'captura' ? <span className={`badge ${r.exam_result}`}>{LABEL[r.exam_result]}</span> : '—'}</td>
                    <td>{r.species || '—'}{r.stage || r.sex ? <span className="muted small"> · {[r.stage, r.sex].filter(Boolean).join(' ')}</span> : null}</td>
                    <td>{r.channel ? CHANNEL_LABEL[r.channel] : '—'}</td>
                    <td>{r.environment ? LABEL[r.environment] : '—'}</td>
                    <td>{r.triatomine_count ?? '—'}</td>
                    <td>{LABEL[r.origin]}</td>
                    {showAddr && <td>{r.address || '—'}</td>}
                    <td>{r.locality_raw || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {data && data.total > 20 && (
        <div className="row" style={{ marginTop: 12 }}>
          <button className="small" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Anterior
          </button>
          <span className="small">
            Página {page} de {pages}
          </span>
          <button className="small" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            Próxima
          </button>
        </div>
      )}
    </section>
  );
}

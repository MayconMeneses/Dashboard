import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { LABEL, filtersToQuery, formatDate } from '../lib/format';
import type { Filters, RecordRow } from '../lib/types';

const MAX = 600;

/** Lista completa de registros (para o relatório). Busca em páginas de 100. */
export function RecordsAppendix({ filters, epoch }: { filters: Filters; epoch: number }) {
  const [state, setState] = useState<{ rows: RecordRow[]; total: number; done: boolean; error: string | null }>({ rows: [], total: 0, done: false, error: null });
  const base = filtersToQuery({ ...filters, layers: ['captura', 'visita'] });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const rows: RecordRow[] = [];
      let total = 0;
      try {
        for (let page = 1; page <= MAX / 100; page++) {
          const r = await api.get<{ total: number; rows: RecordRow[] }>(`/api/records?${base}&page=${page}&pageSize=100&sort=locality_raw&dir=asc`);
          total = r.total;
          rows.push(...r.rows);
          if (cancelled) return;
          if (rows.length >= total) break;
        }
        if (!cancelled) setState({ rows, total, done: true, error: null });
      } catch (e) {
        if (!cancelled) setState({ rows, total, done: true, error: e instanceof Error ? e.message : 'Erro ao carregar registros.' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [base, epoch]);

  if (!state.done) return <div className="skeleton" style={{ height: 120 }} aria-busy="true" />;
  if (state.error) return <div className="notice erro" role="alert">{state.error}</div>;
  return (
    <section className="card report-records" aria-label="Lista de registros">
      <h2>Registros de captura e visita ({state.total})</h2>
      <p className="small muted">Lista completa dos registros que respeitam os filtros. Não inclui endereço, número do imóvel nem coordenadas.{state.total > state.rows.length ? ` Mostrando os primeiros ${state.rows.length}.` : ''}</p>
      <div className="table-wrap">
        <table className="compact">
          <thead>
            <tr><th>Localidade</th><th>Tipo</th><th>Data</th><th>Exame</th><th>Data do exame</th><th>Espécie</th><th>Fase/sexo</th><th>Origem</th><th>Ambiente</th></tr>
          </thead>
          <tbody>
            {state.rows.map((r) => (
              <tr key={r.rid}>
                <td>{r.locality_raw ?? '—'}</td>
                <td>{LABEL[r.type] ?? r.type}</td>
                <td>{formatDate(r.visit_date)}</td>
                <td>{r.type === 'captura' ? LABEL[r.exam_result] : r.type === 'visita' ? LABEL[r.search_result] : '—'}</td>
                <td>{formatDate(r.exam_date)}</td>
                <td>{r.species ?? '—'}</td>
                <td>{[r.stage, r.sex].filter(Boolean).join(' · ') || '—'}</td>
                <td>{r.channel === 'pit' ? 'PIT' : r.channel === 'captura' ? 'Campanha' : '—'}</td>
                <td>{r.environment ? LABEL[r.environment] : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

import { useRef, useState, type ReactNode } from 'react';
import { downloadCanvasPng, downloadCsv } from './charts';

export interface TableData {
  head: string[];
  rows: (string | number | null)[][];
}

interface Props {
  id: string;
  title: string;
  /** o que está sendo contado (unidade) */
  unit: string;
  /** como ler o gráfico, em linguagem simples */
  how: string;
  /** limitações/avisos sobre os dados deste gráfico */
  note?: ReactNode;
  /** dica de interação (clique/passar o mouse) */
  hint?: string;
  table: TableData;
  wide?: boolean;
  /** conteúdo sem canvas (ex.: mapa de calor): esconde o botão PNG */
  noPng?: boolean;
  children: ReactNode;
}

/** Cartão padrão de gráfico: título, unidade, "como ler", avisos, tabela de dados e exportação. */
export function ChartCard({ id, title, unit, how, note, hint, table, wide, noPng, children }: Props) {
  const [asTable, setAsTable] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  return (
    <figure className={`card chart-card${wide ? ' wide' : ''}`} aria-labelledby={`${id}-t`} style={{ margin: 0 }}>
      <figcaption>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'nowrap' }}>
          <h3 id={`${id}-t`} style={{ margin: 0, fontSize: 15 }}>{title}</h3>
          <span className="unit-chip" title="O que está sendo contado">{unit}</span>
        </div>
        <p className="small how"><strong>Como ler:</strong> {how}</p>
        {hint && <p className="small muted" style={{ margin: '0 0 8px' }}>{hint}</p>}
      </figcaption>
      <div ref={host}>
        {asTable ? (
          <div className="table-wrap">
            <table>
              <caption className="sr-only">{title}</caption>
              <thead><tr>{table.head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>{table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c ?? '—'}</td>)}</tr>)}</tbody>
            </table>
          </div>
        ) : (
          children
        )}
      </div>
      {note && <p className="small muted note">{note}</p>}
      <div className="row chart-actions">
        <button className="small" aria-pressed={asTable} onClick={() => setAsTable((v) => !v)}>{asTable ? 'Ver gráfico' : 'Ver como tabela'}</button>
        {!noPng && <button className="small" onClick={() => downloadCanvasPng(host.current, id)}>Baixar PNG</button>}
        <button className="small" onClick={() => downloadCsv(table.head, table.rows, id)}>Baixar CSV</button>
      </div>
    </figure>
  );
}

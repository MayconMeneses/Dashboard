import { Chart as ChartJS, BarController, BarElement, CategoryScale, Legend, LinearScale, Tooltip } from 'chart.js';
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { COLORS, filtersToQuery, formatNumber } from '../lib/format';
import type { Chart, Filters } from '../lib/types';
import { useAsync } from '../lib/useAsync';

ChartJS.register(BarController, BarElement, CategoryScale, LinearScale, Legend, Tooltip);

interface Props {
  filters: Filters;
  epoch: number;
  selected?: string;
  onSelect: (key: string | undefined) => void;
}

export function ChartPanel({ filters, epoch, selected, onSelect }: Props) {
  const [mode, setMode] = useState<'busca' | 'exame'>('busca');
  const [sort, setSort] = useState<'nome' | 'total'>('total');
  const [stacked, setStacked] = useState(true);
  const [asTable, setAsTable] = useState(false);
  const [showEmpty, setShowEmpty] = useState(false);
  const q = filtersToQuery({ ...filters, layers: [] }, { mode, sort, hideEmpty: !showEmpty });
  const { data, loading, error, reload } = useAsync(() => api.get<Chart>(`/api/chart?${q}`), [q, epoch]);

  const canvas = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<ChartJS | null>(null);
  const keysRef = useRef<string[]>([]);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  useEffect(() => {
    if (!data || !canvas.current || asTable) return;
    keysRef.current = data.localities.map((l) => l.key);
    const dim = (hex: string, key: string) => (selected && selected !== key ? hex + '55' : hex);
    const datasets = data.series.map((s) => ({
      label: s.label,
      data: s.data,
      backgroundColor: data.localities.map((l) => dim(COLORS[s.key] ?? '#999999', l.key)),
      borderColor: '#00000033',
      borderWidth: 1,
    }));
    chartRef.current?.destroy();
    chartRef.current = new ChartJS(canvas.current, {
      type: 'bar',
      data: { labels: data.localities.map((l) => l.name), datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? false : undefined,
        scales: {
          x: { stacked, ticks: { maxRotation: 60, minRotation: 30, autoSkip: false, font: { size: 12 } } },
          y: { stacked, beginAtZero: true, ticks: { precision: 0 }, title: { display: true, text: `Contagem (${data.unit})` } },
        },
        plugins: {
          legend: { position: 'top' },
          tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${formatNumber(c.parsed.y)} ${data.unit}` } },
        },
        onClick: (_e, els) => {
          const el = els[0];
          if (!el) return;
          const key = keysRef.current[el.index];
          onSelectRef.current(key === selectedRef.current ? undefined : key);
        },
        onHover: (e, els) => {
          const t = e.native?.target as HTMLElement | undefined;
          if (t) t.style.cursor = els.length ? 'pointer' : 'default';
        },
      },
    });
    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [data, stacked, selected, asTable]);

  const width = data ? Math.max(data.localities.length * 64, 320) : 320;

  return (
    <section className="card" aria-label="Gráfico por localidade">
      <h2>Resultados por localidade</h2>
      <div className="toolbar">
        <div className="seg" role="group" aria-label="Tipo de resultado">
          <button aria-pressed={mode === 'busca'} onClick={() => setMode('busca')}>
            Resultado da busca
          </button>
          <button aria-pressed={mode === 'exame'} onClick={() => setMode('exame')}>
            Resultado do exame
          </button>
        </div>
        <label className="field">
          Ordenar
          <select value={sort} onChange={(e) => setSort(e.target.value as 'nome' | 'total')}>
            <option value="total">Por quantidade</option>
            <option value="nome">Por nome</option>
          </select>
        </label>
        <label className="checks">
          <input type="checkbox" checked={stacked} onChange={(e) => setStacked(e.target.checked)} /> Empilhar
        </label>
        <label className="checks">
          <input type="checkbox" checked={showEmpty} onChange={(e) => setShowEmpty(e.target.checked)} /> Mostrar localidades sem registros
        </label>
        <button className="small" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}>
          {asTable ? 'Ver gráfico' : 'Ver como tabela'}
        </button>
      </div>
      {data && <p className="small muted" style={{ margin: '0 0 8px' }}>{data.note} Unidade: {data.unit}.</p>}
      {error && (
        <div className="notice erro" role="alert">
          {error} <button className="small" onClick={reload}>Tentar de novo</button>
        </div>
      )}
      {loading && !data && <div className="skeleton" style={{ height: 340 }} aria-busy="true" />}
      {data && data.localities.length === 0 && <div className="notice info">Nenhuma localidade com dados para estes filtros. Envie um arquivo em “Atualizar dados” ou limpe os filtros.</div>}
      {data && data.localities.length > 0 && !asTable && (
        <>
          <div className="chart-scroll">
            <div className="chart-box" style={{ minWidth: width }}>
              <canvas ref={canvas} role="img" aria-label={`Gráfico de colunas: ${data.unit} por localidade`} />
            </div>
          </div>
          <p className="small muted" style={{ margin: '8px 0 0' }}>Clique em uma coluna para selecionar a localidade; clique de novo para desmarcar.</p>
        </>
      )}
      {data && data.localities.length > 0 && asTable && (
        <div className="table-wrap">
          <table>
            <caption className="sr-only">Contagens por localidade</caption>
            <thead>
              <tr>
                <th>Localidade</th>
                {data.series.map((s) => (
                  <th key={s.key}>{s.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.localities.map((l, i) => (
                <tr key={l.key} tabIndex={0} aria-selected={selected === l.key} onClick={() => onSelect(l.key === selected ? undefined : l.key)} onKeyDown={(e) => e.key === 'Enter' && onSelect(l.key === selected ? undefined : l.key)}>
                  <td>{l.name}</td>
                  {data.series.map((s) => (
                    <td key={s.key}>{formatNumber(s.data[i])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

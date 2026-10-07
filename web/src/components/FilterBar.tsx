import { LABEL } from '../lib/format';
import type { Filters, Locality } from '../lib/types';

const LAYERS = ['localidade', 'visita', 'captura', 'pit', 'area', 'rota'];
const SEARCH = ['com_captura', 'sem_captura', 'nao_informado'];
const EXAM = ['positivo', 'negativo', 'pendente', 'nao_realizado', 'nao_informado'];

export const DEFAULT_FILTERS: Filters = { layers: [], search: [], exam: [] };

function toggle(list: string[], v: string): string[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

export function activeChips(f: Filters, localities: Locality[]): { label: string; clear: (f: Filters) => Filters }[] {
  const chips: { label: string; clear: (f: Filters) => Filters }[] = [];
  if (f.from) chips.push({ label: `De ${f.from.split('-').reverse().join('/')}`, clear: (x) => ({ ...x, from: undefined }) });
  if (f.to) chips.push({ label: `Até ${f.to.split('-').reverse().join('/')}`, clear: (x) => ({ ...x, to: undefined }) });
  if (f.locality) chips.push({ label: `Localidade: ${localities.find((l) => l.key === f.locality)?.name ?? f.locality}`, clear: (x) => ({ ...x, locality: undefined }) });
  for (const v of f.search) chips.push({ label: `Busca: ${LABEL[v]}`, clear: (x) => ({ ...x, search: x.search.filter((s) => s !== v) }) });
  for (const v of f.exam) chips.push({ label: `Exame: ${LABEL[v]}`, clear: (x) => ({ ...x, exam: x.exam.filter((s) => s !== v) }) });
  for (const v of f.layers) chips.push({ label: `Camada: ${LABEL[v]}`, clear: (x) => ({ ...x, layers: x.layers.filter((s) => s !== v) }) });
  return chips;
}

export function FilterBar({ filters, onChange, localities }: { filters: Filters; onChange: (f: Filters) => void; localities: Locality[] }) {
  const chips = activeChips(filters, localities);
  return (
    <section className="card" aria-label="Filtros">
      <div className="filters">
        <label className="field">
          De
          <input type="date" value={filters.from ?? ''} onChange={(e) => onChange({ ...filters, from: e.target.value || undefined })} />
        </label>
        <label className="field">
          Até
          <input type="date" value={filters.to ?? ''} onChange={(e) => onChange({ ...filters, to: e.target.value || undefined })} />
        </label>
        <label className="field">
          Localidade
          <select value={filters.locality ?? ''} onChange={(e) => onChange({ ...filters, locality: e.target.value || undefined })}>
            <option value="">Todas</option>
            {localities.map((l) => (
              <option key={l.key} value={l.key}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend>Resultado da busca</legend>
          <div className="checks">
            {SEARCH.map((v) => (
              <label key={v}>
                <input type="checkbox" checked={filters.search.includes(v)} onChange={() => onChange({ ...filters, search: toggle(filters.search, v) })} />
                {LABEL[v]}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Resultado do exame</legend>
          <div className="checks">
            {EXAM.map((v) => (
              <label key={v}>
                <input type="checkbox" checked={filters.exam.includes(v)} onChange={() => onChange({ ...filters, exam: toggle(filters.exam, v) })} />
                {LABEL[v]}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Tipo de registro (tabela)</legend>
          <div className="checks">
            {LAYERS.map((v) => (
              <label key={v}>
                <input type="checkbox" checked={filters.layers.includes(v)} onChange={() => onChange({ ...filters, layers: toggle(filters.layers, v) })} />
                {LABEL[v]}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      <p className="small muted" style={{ margin: '8px 0 0' }}>
        Com filtro de período, registros sem data ficam de fora. Sem nada marcado em um grupo, todos os valores aparecem.
      </p>
      {chips.length > 0 && (
        <div className="chips" aria-label="Filtros ativos">
          {chips.map((c) => (
            <button key={c.label} className="chip" onClick={() => onChange(c.clear(filters))} aria-label={`Remover filtro ${c.label}`}>
              {c.label} ✕
            </button>
          ))}
          <button className="chip" onClick={() => onChange(DEFAULT_FILTERS)}>
            Limpar filtros
          </button>
        </div>
      )}
    </section>
  );
}

import { formatNumber } from '../lib/format';
import type { Summary } from '../lib/types';

const ITEMS: [keyof Summary['kpis'], string][] = [
  ['localidades', 'Localidades mapeadas'],
  ['visitas', 'Visitas registradas'],
  ['comCaptura', 'Registros com captura'],
  ['semCaptura', 'Buscas sem captura'],
  ['examePositivo', 'Exames positivos'],
  ['exameNegativo', 'Exames negativos'],
  ['examePendente', 'Pendentes / não realizados'],
  ['exameNaoInformado', 'Exame não informado'],
  ['pits', 'PITs cadastrados'],
  ['triatomineos', 'Triatomíneos (soma informada)'],
];

export function Kpis({ summary, loading }: { summary: Summary | null; loading: boolean }) {
  if (!summary) {
    return (
      <div className="grid kpis" aria-busy={loading}>
        {ITEMS.map(([k]) => (
          <div key={k} className="card kpi skeleton" style={{ height: 84 }} />
        ))}
      </div>
    );
  }
  return (
    <section aria-label="Indicadores" className="grid kpis">
      {ITEMS.map(([key, label]) => {
        const k = summary.kpis[key];
        const absent = k.status === 'ausente';
        return (
          <div key={key} className="card kpi" title={k.note || undefined}>
            <div className="l">{label}</div>
            <div className={`v${absent ? ' absent' : ''}`}>{absent ? 'Sem dado' : formatNumber(k.value)}</div>
            <div className="u">{absent ? 'não é zero' : k.unit}</div>
            {k.note && <div className="u">{k.note}</div>}
          </div>
        );
      })}
    </section>
  );
}

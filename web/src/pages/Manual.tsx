import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import { LABEL, formatDate, todayFortaleza } from '../lib/format';
import type { Locality, ManualVisit } from '../lib/types';
import { useAsync } from '../lib/useAsync';

export function ManualPage({ onChanged }: { onChanged: () => void }) {
  const list = useAsync(() => api.get<ManualVisit[]>('/api/manual-visits'), []);
  const locs = useAsync(() => api.get<Locality[]>('/api/localities'), []);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'erro'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const num = (k: string) => (fd.get(k) ? Number(String(fd.get(k)).replace(',', '.')) : undefined);
    const errs: Record<string, string> = {};
    if (String(fd.get('locality') ?? '').trim().length < 2) errs.locality = 'Informe a localidade.';
    if (!fd.get('date')) errs.date = 'Informe a data.';
    else if (String(fd.get('date')) > todayFortaleza()) errs.date = 'A data não pode estar no futuro.';
    const lat = num('lat');
    const lng = num('lng');
    if ((lat === undefined) !== (lng === undefined)) errs.lat = 'Informe latitude e longitude juntas, ou deixe as duas em branco.';
    if ((lat !== undefined && Number.isNaN(lat)) || (lng !== undefined && Number.isNaN(lng))) errs.lat = 'Use números, como -4.40 e -40.90.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.post<{ localidadeNova: boolean }>('/api/manual-visits', {
        locality: String(fd.get('locality')).trim(),
        date: fd.get('date'),
        result: fd.get('result'),
        lat,
        lng,
        notes: notes.trim() || undefined,
      });
      setMsg({ kind: 'ok', text: r.localidadeNova ? 'Visita registrada. Atenção: esta localidade não existe no arquivo ativo (conferir a grafia).' : 'Visita registrada.' });
      form.reset();
      setNotes('');
      list.reload();
      locs.reload();
      onChanged();
    } catch (err) {
      setMsg({ kind: 'erro', text: err instanceof ApiError ? err.message : 'Não foi possível registrar.' });
    } finally {
      setBusy(false);
    }
  }

  async function void_(id: number) {
    if (!window.confirm('Anular este registro? Ele deixa de entrar nas contagens (fica na auditoria).')) return;
    try {
      await api.del(`/api/manual-visits/${id}`);
      list.reload();
      onChanged();
    } catch (err) {
      setMsg({ kind: 'erro', text: err instanceof ApiError ? err.message : 'Não foi possível anular.' });
    }
  }

  return (
    <div className="stack">
      <form className="card stack" onSubmit={submit} noValidate aria-label="Registrar visita">
        <h2>Registrar visita sem captura (ou com captura) à parte do KML</h2>
        <p className="small muted" style={{ margin: 0 }}>Este registro fica identificado como “registro manual”. Não informe nomes de moradores nem outros dados pessoais.</p>
        <div className="filters">
          <label className="field">
            Localidade
            <input name="locality" list="locs" required aria-invalid={!!errors.locality} aria-describedby="e-loc" />
            <datalist id="locs">{(locs.data ?? []).map((l) => <option key={l.key} value={l.name} />)}</datalist>
            {errors.locality && <span id="e-loc" className="small" style={{ color: 'var(--danger)' }}>{errors.locality}</span>}
          </label>
          <label className="field">
            Data da visita
            <input name="date" type="date" defaultValue={todayFortaleza()} max={todayFortaleza()} required aria-invalid={!!errors.date} />
            {errors.date && <span className="small" style={{ color: 'var(--danger)' }}>{errors.date}</span>}
          </label>
          <fieldset>
            <legend>Resultado da busca</legend>
            <div className="checks">
              <label><input type="radio" name="result" value="sem_captura" defaultChecked /> {LABEL.sem_captura}</label>
              <label><input type="radio" name="result" value="com_captura" /> {LABEL.com_captura}</label>
            </div>
          </fieldset>
        </div>
        <div className="filters">
          <label className="field">Latitude (opcional)<input name="lat" inputMode="decimal" placeholder="-4.40" aria-invalid={!!errors.lat} /></label>
          <label className="field">Longitude (opcional)<input name="lng" inputMode="decimal" placeholder="-40.90" /></label>
        </div>
        {errors.lat && <span className="small" style={{ color: 'var(--danger)' }}>{errors.lat}</span>}
        <label className="field">
          Observação técnica (opcional, até 280 caracteres)
          <textarea value={notes} onChange={(e) => setNotes(e.target.value.slice(0, 280))} />
          <span className="small">{notes.length}/280</span>
        </label>
        {msg && <div className={`notice ${msg.kind}`} role={msg.kind === 'erro' ? 'alert' : 'status'}>{msg.text}</div>}
        <div><button className="primary" disabled={busy}>{busy ? 'Salvando…' : 'Registrar visita'}</button></div>
      </form>

      <section className="card" aria-label="Registros manuais">
        <h2>Registros manuais</h2>
        {list.data && list.data.length === 0 && <p className="muted">Nenhum registro manual ainda.</p>}
        {list.data && list.data.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Data</th><th>Localidade</th><th>Resultado da busca</th><th>Observação</th><th>Registrado por</th><th /></tr></thead>
              <tbody>
                {list.data.map((v) => (
                  <tr key={v.id}>
                    <td>{formatDate(v.date)}</td><td>{v.locality}</td><td><span className={`badge ${v.result}`}>{LABEL[v.result]}</span></td>
                    <td>{v.notes || '—'}</td><td>{v.createdBy}</td>
                    <td><button className="small danger" onClick={() => void_(v.id)}>Anular</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

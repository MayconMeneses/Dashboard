import { useRef, useState, type DragEvent } from 'react';
import { api, ApiError } from '../lib/api';
import { LABEL, formatBytes, formatDateTime } from '../lib/format';
import type { ImportInfo, Me } from '../lib/types';
import { useAsync } from '../lib/useAsync';

const FIELD_OPTIONS: [string, string][] = [
  ['', '— sem mapeamento —'],
  ['localidade', 'Localidade'],
  ['data_visita', 'Data da visita/captura'],
  ['data_exame', 'Data do exame'],
  ['resultado_busca', 'Resultado da busca (com/sem captura)'],
  ['resultado_exame', 'Resultado do exame'],
  ['quantidade', 'Quantidade de triatomíneos'],
  ['fase', 'Fase/estágio'],
  ['sexo', 'Sexo'],
  ['especie', 'Espécie'],
  ['imovel', 'Imóvel'],
  ['pit', 'PIT'],
  ['id_origem', 'Identificador de origem'],
  ['endereco', 'Endereço (restrito)'],
  ['ignorar', 'Ignorar este campo'],
];
const TYPE_OPTIONS = ['localidade', 'visita', 'captura', 'pit', 'area', 'rota', 'outro'];
const STATUS: Record<string, string> = { staged: 'Em prévia', active: 'Ativa', archived: 'Arquivada', failed: 'Com falha', discarded: 'Descartada' };

export function ImportPage({ me, onChanged }: { me: Me; onChanged: () => void }) {
  const [current, setCurrent] = useState<ImportInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [excludeRepeats, setExcludeRepeats] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [mapping, setMapping] = useState<{ fields: Record<string, string>; folders: Record<string, string>; aliases: Record<string, string> }>({ fields: {}, folders: {}, aliases: {} });
  const input = useRef<HTMLInputElement>(null);
  const versions = useAsync(() => api.get<ImportInfo[]>('/api/imports'), [done, current?.id]);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    setDone(null);
    setConfirming(false);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const info = await api.post<ImportInfo>('/api/imports', fd);
      setCurrent(info);
      setMapping({ fields: {}, folders: {}, aliases: {} });
      setExcludeRepeats(!!info.report && info.report.duplicates.length > 0 && info.report.duplicates.every((d) => d.crossFolder));
    } catch (e) {
      if (e instanceof ApiError && e.body && typeof e.body === 'object' && 'id' in (e.body as object)) setCurrent(e.body as ImportInfo);
      else setCurrent(null);
      setError(e instanceof ApiError ? e.message : 'Não foi possível enviar o arquivo.');
    } finally {
      setBusy(false);
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files[0];
    if (f) void upload(f);
  };

  async function remap() {
    if (!current) return;
    const fields = Object.fromEntries(Object.entries(mapping.fields).filter(([, v]) => v));
    const folders = Object.fromEntries(Object.entries(mapping.folders).filter(([, v]) => v));
    const localityAliases = Object.fromEntries(Object.entries(mapping.aliases).filter(([, v]) => v));
    setBusy(true);
    setError(null);
    try {
      setCurrent(await api.put<ImportInfo>(`/api/imports/${current.id}/mapping`, { fields, folders, localityAliases }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível reprocessar.');
      if (e instanceof ApiError && e.body && typeof e.body === 'object' && 'id' in (e.body as object)) setCurrent(e.body as ImportInfo);
    } finally {
      setBusy(false);
    }
  }

  async function activate() {
    if (!current) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<ImportInfo>(`/api/imports/${current.id}/activate`, { confirm: true, excludeRepeats });
      setDone(`Versão ${r.version} ativada. O painel já usa o novo arquivo; a versão anterior continua disponível abaixo.`);
      setCurrent(null);
      setConfirming(false);
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível ativar.');
    } finally {
      setBusy(false);
    }
  }

  async function discard() {
    if (!current) return;
    await api.post(`/api/imports/${current.id}/discard`).catch(() => undefined);
    setCurrent(null);
    setConfirming(false);
    versions.reload();
  }

  async function restore(id: number) {
    if (!window.confirm('Restaurar esta versão como a ativa? A versão atual será arquivada (não é apagada).')) return;
    try {
      await api.post(`/api/imports/${id}/restore`, { confirm: true });
      setDone('Versão restaurada.');
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível restaurar.');
    }
  }

  const r = current?.report;
  const errors = r?.issues.filter((i) => i.severity === 'erro') ?? [];
  const warns = r?.issues.filter((i) => i.severity === 'aviso') ?? [];
  const infos = r?.issues.filter((i) => i.severity === 'info') ?? [];

  return (
    <div className="stack">
      <section className="card stack" aria-label="Importar arquivo">
        <h2>Importar arquivo</h2>
        <div
          className={`dropzone${over ? ' over' : ''}`}
          onDragOver={(e) => (e.preventDefault(), setOver(true))}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
        >
          <p style={{ marginTop: 0 }}>Arraste o arquivo <strong>.kml</strong> ou <strong>.kmz</strong> aqui ou</p>
          <button className="primary" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? 'Processando…' : 'Selecionar arquivo'}
          </button>
          <input ref={input} type="file" accept=".kml,.kmz" className="sr-only" aria-label="Arquivo KML ou KMZ" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
          <p className="small muted" style={{ marginBottom: 0 }}>
            Tamanho máximo: {me.map.maxUploadMb} MB. No Google Earth/My Maps: menu do mapa → “Exportar como KML/KMZ”.
          </p>
        </div>
        <div className="notice info small">
          Nada é substituído antes de você revisar a prévia e confirmar. Se o arquivo tiver problema, o painel atual continua como está.
        </div>
        {done && <div className="notice ok" role="status">{done}</div>}
        {error && (
          <div className="notice erro" role="alert">
            {error} {current?.status === 'failed' && 'Corrija o arquivo (ou use o mapeamento abaixo, se for um problema de campos) e envie de novo. Os dados atuais não foram alterados.'}
          </div>
        )}
      </section>

      {current && r && (
        <section className="card stack" aria-label="Prévia da importação">
          <h2>Prévia: {current.filename}</h2>
          <div className="table-wrap">
            <table>
              <tbody>
                <tr><th>Pastas/camadas</th><td>{r.folders.length}</td><th>Localidades</th><td>{r.counts.localities}</td></tr>
                <tr><th>Registros no arquivo</th><td>{r.counts.placemarks}</td><th>Capturas</th><td>{r.counts.captureRecords}</td></tr>
                <tr><th>Pontos</th><td>{r.counts.points}</td><th>PITs</th><td>{r.counts.pits}</td></tr>
                <tr><th>Polígonos</th><td>{r.counts.polygons}</td><th>Linhas/rotas</th><td>{r.counts.lines}</td></tr>
                <tr><th>Visitas</th><td>{r.counts.byType.visita ?? 0}</td><th>Sem coordenadas</th><td>{r.counts.semGeometria}</td></tr>
              </tbody>
            </table>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            Campos encontrados no arquivo: {Object.entries(r.seenFields).filter(([, v]) => v).map(([k]) => k).join(', ') || 'nenhum reconhecido'}.
            {!r.seenFields.resultado_busca && ' O arquivo não informa buscas sem captura; o painel não vai inferir negativos.'}
          </p>

          {errors.map((i, n) => <div key={`e${n}`} className="notice erro">{i.message}</div>)}
          {warns.length > 0 && (
            <details open={warns.length < 6}>
              <summary>{warns.length} aviso(s)</summary>
              <ul className="small">{warns.slice(0, 100).map((i, n) => <li key={n}>{i.message}</li>)}{warns.length > 100 && <li>… e mais {warns.length - 100}. Veja o relatório completo.</li>}</ul>
            </details>
          )}
          {infos.length > 0 && (
            <details>
              <summary>{infos.length} informação(ões)</summary>
              <ul className="small">{infos.slice(0, 100).map((i, n) => <li key={n}>{i.message}</li>)}</ul>
            </details>
          )}

          <details>
            <summary>Mapear pastas e campos (use se algo foi reconhecido errado)</summary>
            <div className="stack" style={{ marginTop: 12 }}>
              <h3>Pastas/camadas → tipo de registro</h3>
              {Object.entries(r.folderTypes).length === 0 && <p className="small muted">Sem pastas nomeadas.</p>}
              {Object.entries(r.folderTypes).map(([folder, t]) => (
                <label key={folder} className="field">
                  {folder} (reconhecido como {LABEL[t] ?? t})
                  <select value={mapping.folders[folder] ?? ''} onChange={(e) => setMapping((m) => ({ ...m, folders: { ...m.folders, [folder]: e.target.value } }))}>
                    <option value="">— manter —</option>
                    {TYPE_OPTIONS.map((o) => <option key={o} value={o}>{LABEL[o]}</option>)}
                  </select>
                </label>
              ))}
              <h3>Campos sem mapeamento</h3>
              {r.unmappedFields.length === 0 && <p className="small muted">Todos os campos foram reconhecidos ou estão vazios.</p>}
              {r.unmappedFields.map((field) => (
                <label key={field} className="field">
                  {field}
                  <select value={mapping.fields[field] ?? ''} onChange={(e) => setMapping((m) => ({ ...m, fields: { ...m.fields, [field]: e.target.value } }))}>
                    {FIELD_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
              ))}
              <h3>Unificar localidades com grafia diferente</h3>
              {r.unmatchedLocalities.length === 0 && r.similarLocalities.length === 0 && <p className="small muted">Nenhuma localidade com grafia suspeita.</p>}
              {r.unmatchedLocalities.map((name) => (
                <label key={name} className="field">
                  “{name}” não existe entre as localidades mapeadas. É a mesma que…
                  <select value={mapping.aliases[name] ?? ''} onChange={(e) => setMapping((m) => ({ ...m, aliases: { ...m.aliases, [name]: e.target.value } }))}>
                    <option value="">— manter como localidade nova —</option>
                    {r.localities.filter((l) => l.name !== name).map((l) => <option key={l.key} value={l.name}>{l.name}</option>)}
                  </select>
                </label>
              ))}
              {r.similarLocalities.map(([a, b]) => (
                <label key={a + b} className="field">
                  “{b}” parece a mesma que “{a}”
                  <select value={mapping.aliases[b] ?? ''} onChange={(e) => setMapping((m) => ({ ...m, aliases: { ...m.aliases, [b]: e.target.value } }))}>
                    <option value="">— manter separadas —</option>
                    <option value={a}>Unificar em “{a}”</option>
                  </select>
                </label>
              ))}
              <div><button onClick={remap} disabled={busy}>Reprocessar com este mapeamento</button></div>
            </div>
          </details>

          {r.duplicates.length > 0 && (
            <fieldset>
              <legend>{r.duplicates.length} grupo(s) com possíveis duplicatas{r.duplicates.every((d) => d.crossFolder) ? ' (cópias em outras pastas, como Resultados/Positivos/Negativos)' : ''}</legend>
              <div className="checks">
                <label><input type="radio" name="dup" checked={!excludeRepeats} onChange={() => setExcludeRepeats(false)} /> Manter todos</label>
                <label><input type="radio" name="dup" checked={excludeRepeats} onChange={() => setExcludeRepeats(true)} /> Excluir as repetições e manter o primeiro de cada grupo</label>
              </div>
              <p className="small muted" style={{ marginBottom: 0 }}>Nada é apagado: as repetições excluídas continuam no arquivo original e na versão guardada.</p>
            </fieldset>
          )}

          <div className="row">
            <a className="btn" href={`/api/imports/${current.id}/report.txt`}>Baixar relatório</a>
            {!confirming ? (
              <button className="primary" disabled={busy || current.status !== 'staged'} onClick={() => setConfirming(true)}>Ativar esta versão…</button>
            ) : (
              <>
                <span className="notice aviso">Isto substitui os dados exibidos no painel. A versão atual fica arquivada e pode ser restaurada.</span>
                <button className="primary" disabled={busy} onClick={activate}>Confirmar ativação</button>
                <button onClick={() => setConfirming(false)}>Cancelar</button>
              </>
            )}
            <button className="danger" onClick={discard}>Descartar prévia</button>
          </div>
        </section>
      )}

      {me.permissions.administrar && (
        <section className="card stack" aria-label="Backup">
          <h2>Backup</h2>
          <p className="small" style={{ margin: 0 }}>
            O backup é um arquivo ZIP com o banco de dados e os arquivos KML/KMZ originais enviados. Guarde-o em local seguro: ele contém os dados da campanha. <strong>Não há backup automático</strong>: baixe com a frequência que a equipe precisar.
          </p>
          <div className="row">
            <a className="btn" href="/api/admin/backup">Baixar backup (ZIP)</a>
          </div>
          <p className="small muted" style={{ margin: 0 }}>Para restaurar, com o servidor parado: <code>npm run restore -- "arquivo-do-backup.zip"</code>. O banco anterior é guardado ao lado, com a data.</p>
        </section>
      )}

      <section className="card" aria-label="Versões">
        <h2>Versões importadas</h2>
        {versions.loading && !versions.data && <div className="skeleton" style={{ height: 80 }} />}
        {versions.data && versions.data.length === 0 && <p className="muted">Nenhuma importação ainda.</p>}
        {versions.data && versions.data.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Versão</th><th>Arquivo</th><th>Situação</th><th>Enviado</th><th>Tamanho</th><th>Ações</th></tr></thead>
              <tbody>
                {versions.data.map((v) => (
                  <tr key={v.id}>
                    <td>{v.version ?? '—'}</td>
                    <td>{v.filename}</td>
                    <td>{STATUS[v.status]}{v.error ? ` – ${v.error.message}` : ''}</td>
                    <td>{formatDateTime(v.createdAt)}{v.createdBy ? ` · ${v.createdBy}` : ''}</td>
                    <td>{formatBytes(v.sizeBytes)}</td>
                    <td className="row">
                      <a className="btn small" href={`/api/imports/${v.id}/report.txt`}>Relatório</a>
                      {v.status === 'archived' && <button className="small" onClick={() => restore(v.id)}>Restaurar</button>}
                      {me.role === 'admin' && <a className="btn small" href={`/api/imports/${v.id}/original`}>Original</a>}
                    </td>
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

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './lib/api';
import { formatDateTime } from './lib/format';
import type { Me, Summary } from './lib/types';
import { DashboardPage } from './pages/Dashboard';
import { ImportPage } from './pages/Import';
import { LoginPage } from './pages/Login';
import { ManualPage } from './pages/Manual';

type Page = 'painel' | 'dados' | 'manual';

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [page, setPage] = useState<Page>('painel');
  const [version, setVersion] = useState<Summary['versao']>(null);
  const [dataEpoch, setDataEpoch] = useState(0);

  useEffect(() => {
    api.get<Me>('/api/me').then(setMe, (e: unknown) => setMe(e instanceof ApiError && e.status === 401 ? null : null));
  }, []);

  const refresh = useCallback(() => setDataEpoch((n) => n + 1), []);
  useEffect(() => {
    if (!me) return;
    api.get<Summary>('/api/summary').then((s) => setVersion(s.versao), () => setVersion(null));
  }, [me, dataEpoch]);

  if (me === undefined) return <div className="container" role="status">Carregando…</div>;
  if (me === null) return <LoginPage onLogin={(m) => setMe(m)} />;

  const tabs: [Page, string][] = [['painel', 'Painel']];
  if (me.permissions.importar) tabs.push(['dados', 'Atualizar dados']);
  if (me.permissions.manual) tabs.push(['manual', 'Visita sem captura']);

  return (
    <>
      <header className="top">
        <div className="container">
          <div className="brand">
            <h1>Triatomíneos – Croatá/CE</h1>
            <small>
              {version ? `Versão ${version.numero} · ${version.arquivo} · ativada em ${formatDateTime(version.ativadoEm)}` : 'Nenhum arquivo ativo'}
            </small>
          </div>
          <nav className="tabs" aria-label="Seções">
            {tabs.map(([k, label]) => (
              <button key={k} aria-current={page === k ? 'page' : undefined} onClick={() => setPage(k)}>
                {label}
              </button>
            ))}
          </nav>
          <div className="userbox">
            <span className="small muted">
              {me.username} ({me.role})
            </span>
            <button
              onClick={async () => {
                await api.post('/api/auth/logout').catch(() => undefined);
                setMe(null);
              }}
            >
              Sair
            </button>
          </div>
        </div>
      </header>
      <main className="container">
        {page === 'painel' && <DashboardPage me={me} epoch={dataEpoch} goImport={() => setPage('dados')} />}
        {page === 'dados' && me.permissions.importar && <ImportPage me={me} onChanged={refresh} />}
        {page === 'manual' && me.permissions.manual && <ManualPage onChanged={refresh} />}
      </main>
    </>
  );
}

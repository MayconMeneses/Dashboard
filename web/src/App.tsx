import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './lib/api';
import { formatDateTime } from './lib/format';
import type { Me, Summary } from './lib/types';
import { DashboardPage } from './pages/Dashboard';
import { ImportPage } from './pages/Import';
import { LoginPage } from './pages/Login';
import { AboutPage } from './pages/About';
import { IS_STATIC, getSnapshot } from './lib/static';
import { ManualPage } from './pages/Manual';

type Page = 'painel' | 'dados' | 'manual' | 'sobre';

const STATIC_ME: Me = {
  username: 'visitante',
  role: 'leitor',
  permissions: { importar: false, manual: false, exportar: false, restrito: false, auditoria: false },
  map: { tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '© colaboradores do OpenStreetMap', maxUploadMb: 0 },
};

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(IS_STATIC ? STATIC_ME : undefined);
  const [page, setPage] = useState<Page>('painel');
  const [version, setVersion] = useState<Summary['versao']>(null);
  const [dataEpoch, setDataEpoch] = useState(0);

  useEffect(() => {
    if (IS_STATIC) return;
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
  if (IS_STATIC) tabs.push(['sobre', 'Sobre os dados']);
  if (me.permissions.importar) tabs.push(['dados', 'Atualizar dados']);
  if (me.permissions.manual) tabs.push(['manual', 'Visita sem captura']);

  return (
    <>
      <header className="top">
        <div className="container">
          <div className="brand">
            <h1>Triatomíneos – Croatá/CE</h1>
            <small>
              {version ? (IS_STATIC ? `Arquivo ${version.arquivo} · dados gerados em ${formatDateTime(version.ativadoEm)}` : `Versão ${version.numero} · ${version.arquivo} · ativada em ${formatDateTime(version.ativadoEm)}`) : 'Nenhum arquivo ativo'}
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
            {IS_STATIC ? (
              <span className="small muted">Painel compartilhado · somente leitura</span>
            ) : (
              <>
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
              </>
            )}
          </div>
        </div>
      </header>
      <main className="container">
        {page === 'painel' && <DashboardPage me={me} epoch={dataEpoch} goImport={() => setPage('dados')} />}
        {page === 'sobre' && IS_STATIC && <AboutPage snapshot={getSnapshot()} />}
        {page === 'dados' && me.permissions.importar && <ImportPage me={me} onChanged={refresh} />}
        {page === 'manual' && me.permissions.manual && <ManualPage onChanged={refresh} />}
      </main>
    </>
  );
}

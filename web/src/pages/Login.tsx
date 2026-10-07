import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import type { Me } from '../lib/types';

export function LoginPage({ onLogin }: { onLogin: (me: Me) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/login', { username: fd.get('username'), password: fd.get('password') });
      onLogin(await api.get<Me>('/api/me'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível entrar. Tente novamente.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="container login">
      <form className="card stack" onSubmit={submit}>
        <h1>Triatomíneos – Croatá/CE</h1>
        <p className="muted small">Acesso restrito à equipe de endemias.</p>
        <label className="field">
          Usuário
          <input name="username" autoComplete="username" required autoFocus />
        </label>
        <label className="field">
          Senha
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        {error && (
          <div className="notice erro" role="alert">
            {error}
          </div>
        )}
        <button className="primary" disabled={busy}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </main>
  );
}

import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import { formatDateTime } from '../lib/format';
import type { Me, Role } from '../lib/types';
import { useAsync } from '../lib/useAsync';

interface UserInfo {
  id: number;
  username: string;
  role: Role;
  active: boolean;
  createdAt: string;
}

const ROLE_LABEL: Record<Role, string> = { admin: 'Administrador', analista: 'Analista', leitor: 'Leitor' };
const ROLE_HELP: Record<Role, string> = {
  admin: 'Tudo: usuários, backup, auditoria, importação e exportação.',
  analista: 'Importa e ativa arquivos, registra visitas, exporta e vê endereços.',
  leitor: 'Só visualiza o painel (sem endereço, sem exportar).',
};

export function UsersPage({ me }: { me: Me }) {
  const users = useAsync(() => api.get<UserInfo[]>('/api/users'), []);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'erro'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ kind: 'ok', text: ok });
      users.reload();
    } catch (e) {
      setMsg({ kind: 'erro', text: e instanceof ApiError ? e.message : 'Não foi possível concluir. Tente novamente.' });
    } finally {
      setBusy(false);
    }
  }

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    await run(() => api.post('/api/users', { username: fd.get('username'), password: fd.get('password'), role: fd.get('role') }), 'Usuário criado.');
    form.reset();
  }

  return (
    <div className="stack">
      <form className="card stack" onSubmit={create} aria-label="Novo usuário">
        <h2>Novo usuário</h2>
        <div className="filters">
          <label className="field">Usuário<input name="username" required minLength={3} maxLength={40} autoComplete="off" pattern="[A-Za-z0-9._-]+" title="Letras, números, ponto, hífen e sublinhado" /></label>
          <label className="field">Senha (mínimo 10 caracteres)<input name="password" type="password" required minLength={10} autoComplete="new-password" /></label>
          <label className="field">
            Perfil
            <select name="role" defaultValue="leitor">
              {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          </label>
        </div>
        <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
          {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <li key={r}><strong>{ROLE_LABEL[r]}:</strong> {ROLE_HELP[r]}</li>)}
        </ul>
        {msg && <div className={`notice ${msg.kind}`} role={msg.kind === 'erro' ? 'alert' : 'status'}>{msg.text}</div>}
        <div><button className="primary" disabled={busy}>Criar usuário</button></div>
      </form>

      <section className="card" aria-label="Usuários">
        <h2>Usuários</h2>
        {users.error && <div className="notice erro" role="alert">{users.error}</div>}
        {users.data && (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Usuário</th><th>Perfil</th><th>Situação</th><th>Criado em</th><th>Ações</th></tr></thead>
              <tbody>
                {users.data.map((u) => {
                  const self = u.username === me.username;
                  return (
                    <tr key={u.id}>
                      <td>{u.username}{self ? ' (você)' : ''}</td>
                      <td>
                        <select aria-label={`Perfil de ${u.username}`} value={u.role} disabled={busy || self} onChange={(e) => run(() => api.patch(`/api/users/${u.id}`, { role: e.target.value }), 'Perfil alterado. As sessões abertas desse usuário foram encerradas.')}>
                          {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                        </select>
                      </td>
                      <td><span className={`badge ${u.active ? 'com_captura' : 'nao_informado'}`}>{u.active ? 'Ativo' : 'Desativado'}</span></td>
                      <td>{formatDateTime(u.createdAt)}</td>
                      <td className="row">
                        <button className="small" disabled={busy || self} onClick={() => window.confirm(`${u.active ? 'Desativar' : 'Reativar'} o usuário ${u.username}?`) && run(() => api.patch(`/api/users/${u.id}`, { active: !u.active }), u.active ? 'Usuário desativado.' : 'Usuário reativado.')}>
                          {u.active ? 'Desativar' : 'Reativar'}
                        </button>
                        <button className="small" disabled={busy} onClick={() => {
                          const p = window.prompt(`Nova senha para ${u.username} (mínimo 10 caracteres):`);
                          if (p) void run(() => api.patch(`/api/users/${u.id}`, { password: p }), 'Senha redefinida. As sessões abertas desse usuário foram encerradas.');
                        }}>Redefinir senha</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

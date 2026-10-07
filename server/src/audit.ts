import type { AuthUser } from './auth.js';
import type { Db } from './db.js';

export function audit(db: Db, user: Pick<AuthUser, 'id' | 'username'> | null, action: string, target?: string, detail?: unknown): void {
  db.prepare('INSERT INTO audit_log (at, user_id, username, action, target, detail_json) VALUES (?,?,?,?,?,?)').run(
    new Date().toISOString(),
    user?.id ?? null,
    user?.username ?? null,
    action,
    target ?? null,
    detail === undefined ? null : JSON.stringify(detail),
  );
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public body?: unknown,
  ) {
    super(message);
  }
}

import { handle } from '../static/engine';
import { IS_STATIC, getSnapshot } from './static';

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  if (IS_STATIC) {
    const snap = getSnapshot();
    if (method !== 'GET') throw new ApiError(403, 'somente_leitura', 'Este painel compartilhado é somente leitura.');
    if (!snap) throw new ApiError(500, 'sem_dados', 'Este arquivo não contém dados. Gere-o de novo com o comando gerar-html.');
    return handle(snap, url) as T;
  }
  const headers: Record<string, string> = { 'X-Requested-With': 'dashboard' };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body: payload, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'rede', 'Sem conexão com o servidor. Verifique sua rede e tente de novo.');
  }
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const d = data as { error?: string; message?: string } | null;
    throw new ApiError(res.status, d?.error ?? 'erro', d?.message ?? 'Não foi possível concluir a ação. Tente novamente.', data);
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body ?? {}),
  patch: <T>(url: string, body?: unknown) => request<T>('PATCH', url, body ?? {}),
  del: <T>(url: string) => request<T>('DELETE', url),
};

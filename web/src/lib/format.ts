import type { Filters } from './types';

export const LABEL: Record<string, string> = {
  com_captura: 'Com captura',
  sem_captura: 'Sem captura',
  nao_informado: 'Não informado',
  positivo: 'Positivo',
  negativo: 'Negativo',
  pendente: 'Pendente',
  nao_realizado: 'Não realizado',
  localidade: 'Localidade',
  visita: 'Visita',
  captura: 'Captura',
  pit: 'PIT',
  area: 'Área',
  rota: 'Rota',
  outro: 'Outro',
  arquivo: 'Arquivo',
  manual: 'Registro manual',
};

export const COLORS: Record<string, string> = {
  com_captura: '#0f766e',
  sem_captura: '#64748b',
  positivo: '#c0392b',
  negativo: '#2563eb',
  pendente: '#d97706',
  nao_realizado: '#6b7280',
  nao_informado: '#cbd5e1',
};

/** "2026-04-10" -> "10/04/2026" sem passar por Date (evita deslocamento de fuso). */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Fortaleza' }).format(new Date(iso));
}

export function todayFortaleza(): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Fortaleza' }).format(new Date());
  return p; // YYYY-MM-DD
}

export function formatNumber(n: number | null | undefined): string {
  return n == null ? '—' : new Intl.NumberFormat('pt-BR').format(n);
}

export function filtersToQuery(f: Filters, extra: Record<string, string | number | boolean | undefined> = {}): string {
  const p = new URLSearchParams();
  if (f.from) p.set('from', f.from);
  if (f.to) p.set('to', f.to);
  if (f.locality) p.set('locality', f.locality);
  if (f.layers.length) p.set('layers', f.layers.join(','));
  if (f.search.length) p.set('search', f.search.join(','));
  if (f.exam.length) p.set('exam', f.exam.join(','));
  if (f.q) p.set('q', f.q);
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) p.set(k, String(v));
  return p.toString();
}

export function formatBytes(n: number): string {
  return n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

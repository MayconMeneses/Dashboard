import type { Snapshot } from '../static/engine';

/** Painel compartilhável: um único arquivo HTML com os dados embutidos, sem servidor nem login. */
export const IS_STATIC = import.meta.env.VITE_STATIC === '1';

let cached: Snapshot | null | undefined;
export function getSnapshot(): Snapshot | null {
  if (cached !== undefined) return cached;
  try {
    const el = document.getElementById('snapshot');
    const parsed = el?.textContent ? (JSON.parse(el.textContent) as Snapshot | null) : null;
    cached = parsed && parsed.formato === 1 ? parsed : null;
  } catch {
    cached = null;
  }
  return cached;
}

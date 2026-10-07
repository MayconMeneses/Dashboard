/**
 * Ganchos de impressão/PDF: gráficos e mapas se redesenham para a largura da página impressa.
 * (O layout muda ao imprimir; sem isso o mapa interativo ficaria mostrando só um pedaço.)
 */
type Hook = () => void;
const hooks = new Set<Hook>();

export function registerPrintHook(fn: Hook): () => void {
  hooks.add(fn);
  return () => {
    hooks.delete(fn);
  };
}

export function runPrintHooks(): void {
  for (const h of hooks) {
    try {
      h();
    } catch {
      /* um gancho com problema não pode impedir os outros */
    }
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeprint', runPrintHooks);
  window.addEventListener('afterprint', runPrintHooks);
  window.matchMedia?.('print').addEventListener?.('change', runPrintHooks);
  (window as unknown as { __prepararImpressao?: () => void }).__prepararImpressao = runPrintHooks;
}

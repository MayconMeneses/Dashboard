import { currentPref, navCollapsed, parsePref, saveNavCollapsed, setPreference } from '../design/theme.js';

/** Barra lateral (recolher/expandir, saltar para uma seção) e seletor de tema. */
export function initShell() {
  const shell = document.getElementById('shell');
  const toggle = document.getElementById('navToggle') as HTMLButtonElement | null;
  const sel = document.getElementById('themeSel') as HTMLSelectElement | null;
  if (!shell) return;

  const setCollapsed = (v: boolean) => {
    shell.classList.toggle('nav-collapsed', v);
    toggle?.setAttribute('aria-expanded', String(!v));
    if (toggle) toggle.title = v ? 'Expandir o menu' : 'Recolher o menu';
  };
  setCollapsed(navCollapsed());
  if (toggle) {
    toggle.onclick = () => {
      const v = !shell.classList.contains('nav-collapsed');
      setCollapsed(v);
      saveNavCollapsed(v);
    };
  }

  if (sel) {
    sel.value = currentPref();
    sel.onchange = () => setPreference(parsePref(sel.value));
  }

  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  shell.querySelectorAll<HTMLAnchorElement>('.sidenav a[href^="#"]').forEach((a) => {
    a.onclick = (e) => {
      const target = document.querySelector(a.getAttribute('href')!);
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
      (target as HTMLElement).focus?.({ preventScroll: true });
    };
  });
}

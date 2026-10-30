export type ThemePref = 'dark' | 'light' | 'auto';
export type ThemeMode = 'dark' | 'light';

const KEY = 'du-tema';
const KEY_NAV = 'du-menu-recolhido';

export const parsePref = (v: unknown): ThemePref => (v === 'light' || v === 'auto' || v === 'dark' ? v : 'dark');
export const resolveTheme = (pref: ThemePref, systemDark: boolean): ThemeMode => (pref === 'auto' ? (systemDark ? 'dark' : 'light') : pref);

/** localStorage pode falhar (modo privado, bloqueio, arquivo local): o painel funciona sem ele. */
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* sem persistência */
  }
}

let pref: ThemePref = 'dark';
let printing = false;
let listener: ((mode: ThemeMode) => void) | undefined;
const systemDark = () => (typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)').matches : true);

export const currentMode = (): ThemeMode => (printing ? 'light' : resolveTheme(pref, systemDark()));
export const currentPref = () => pref;

function apply(notify = true) {
  const mode = currentMode();
  document.documentElement.dataset.theme = mode;
  document.documentElement.style.colorScheme = mode;
  if (notify) listener?.(mode);
}

export function setPreference(p: ThemePref) {
  pref = p;
  write(KEY, p);
  apply();
}

/** Na impressão e no PDF o painel usa sempre o tema claro (papel branco); ao terminar volta ao escolhido. */
export function setPrinting(on: boolean) {
  if (printing === on) return;
  printing = on;
  apply(false);
}

/** Lê a preferência salva, aplica o tema e avisa quando ele mudar (inclusive pelo sistema, no modo automático). */
export function initTheme(onChange: (mode: ThemeMode) => void) {
  listener = onChange;
  pref = parsePref(read(KEY));
  if (typeof matchMedia === 'function') matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => pref === 'auto' && apply());
  apply();
}

export const navCollapsed = () => read(KEY_NAV) === '1';
export const saveNavCollapsed = (v: boolean) => write(KEY_NAV, v ? '1' : '0');

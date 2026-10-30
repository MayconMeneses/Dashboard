// Legibilidade do design system: contraste WCAG 2.2 AA calculado a partir dos próprios tokens do CSS.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TEXT } from '../src/design/chartTheme.js';
import { PALETTE } from '../src/design/palette.js';
import { parsePref, resolveTheme } from '../src/design/theme.js';

const css = readFileSync(new URL('../src/design/tokens.css', import.meta.url), 'utf8');

function tokens(selector: RegExp): Record<string, string> {
  const block = css.split('}').find((b) => selector.test(b.split('{')[0]!))!;
  return Object.fromEntries([...block.matchAll(/--([a-z-]+):\s*(#[0-9A-Fa-f]{6})\s*;/g)].map((m) => [m[1]!, m[2]!.toUpperCase()]));
}
const dark = { ...tokens(/data-theme='dark'/) };
const light = { ...dark, ...tokens(/data-theme='light'/) };

const lin = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (h: string) => {
  const n = parseInt(h.slice(1), 16);
  return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

describe.each([['escuro', dark], ['claro', light]] as const)('tema %s', (_n, t) => {
  const bgs = ['bg-canvas', 'bg-sidebar', 'bg-surface', 'bg-raised'] as const;
  it('texto comum tem contraste ≥ 4,5:1 sobre todos os fundos', () => {
    for (const fg of ['text-primary', 'text-secondary', 'text-muted'] as const) for (const bg of bgs) expect(ratio(t[fg]!, t[bg]!), `${fg} sobre ${bg}`).toBeGreaterThanOrEqual(4.5);
  });
  it('cores de destaque usadas como texto têm ≥ 4,5:1 sobre o cartão', () => {
    for (const fg of ['accent-blue', 'accent-cyan', 'accent-purple', 'status-success', 'status-warning', 'status-danger'] as const) expect(ratio(t[fg]!, t['bg-surface']!), fg).toBeGreaterThanOrEqual(4.5);
  });
  it('texto sobre o botão de destaque e aviso de erro são legíveis', () => {
    expect(ratio(t['on-accent']!, t['accent-blue']!)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(t['status-danger']!, t['danger-bg']!)).toBeGreaterThanOrEqual(4.5);
  });
  it('contornos de controles e foco têm ≥ 3:1 (contraste não textual)', () => {
    for (const bg of ['bg-surface', 'bg-raised', 'bg-canvas'] as const) {
      expect(ratio(t['border-control']!, t[bg]!), `borda em ${bg}`).toBeGreaterThanOrEqual(3);
      expect(ratio(t['focus-ring']!, t[bg]!), `foco em ${bg}`).toBeGreaterThanOrEqual(3);
    }
  });
  it('texto dos gráficos (canvas) acompanha os tokens e é legível', () => {
    const mode = t === dark ? 'dark' : 'light';
    expect(TEXT[mode].text.toUpperCase()).toBe(t['text-secondary']);
    expect(TEXT[mode].grid.toUpperCase()).toBe(t['border-subtle']);
    expect(ratio(TEXT[mode].text, t['bg-surface']!)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('paleta dos gráficos', () => {
  it('todas as cores têm ≥ 3:1 sobre o cartão escuro e sobre o branco (tela, PDF e impressão)', () => {
    for (const c of PALETTE) {
      expect(ratio(c, dark['bg-surface']!), `${c} no escuro`).toBeGreaterThanOrEqual(3);
      expect(ratio(c, '#FFFFFF'), `${c} no branco`).toBeGreaterThanOrEqual(3);
    }
    expect(new Set(PALETTE).size).toBe(PALETTE.length);
  });
});

describe('preferência de tema', () => {
  it('padrão é escuro; automático segue o sistema', () => {
    expect(parsePref(null)).toBe('dark');
    expect(parsePref('qualquer')).toBe('dark');
    expect(parsePref('light')).toBe('light');
    expect(resolveTheme('auto', true)).toBe('dark');
    expect(resolveTheme('auto', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
  });
});

/** máximo/mínimo sem espalhar o array nos argumentos (o `Math.max(...a)` estoura a pilha com ~100 mil itens) */
export function maxOf(a: readonly number[], init = -Infinity): number {
  let m = init;
  for (const v of a) if (v > m) m = v;
  return m;
}
export function minOf(a: readonly number[], init = Infinity): number {
  let m = init;
  for (const v of a) if (v < m) m = v;
  return m;
}

/** Luminância relativa (WCAG) de uma cor RGB 0–255. */
export function luminance(r: number, g: number, b: number): number {
  const f = (c: number) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrastRatio(l1: number, l2: number): number {
  const [a, b] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (a + 0.05) / (b + 0.05);
}

/** Cor do fundo da célula do mapa de calor (azul sobre branco) e a cor de texto com maior contraste. */
export function heatCell(f: number): { bg: string; fg: '#000' | '#fff'; ratio: number } {
  const a = 0.08 + f * 0.82;
  const rgb: [number, number, number] = [0, 114, 178].map((c) => Math.round(c * a + 255 * (1 - a))) as [number, number, number];
  const l = luminance(...rgb);
  const white = contrastRatio(l, 1);
  const black = contrastRatio(l, 0);
  return { bg: `rgb(${rgb.join(',')})`, fg: white >= black ? '#fff' : '#000', ratio: Math.max(white, black) };
}

const SMALL_WORDS = new Set(['de', 'da', 'do', 'dos', 'das', 'e', 'com', 'em', 'para', 'no', 'na', 'nos', 'nas', 'a', 'o', 'por', 'ao']);

/** “PESQUISA COM PARTICIPAÇÃO POPULAR (PIT's)” → “Pesquisa com participação popular (PIT's)”: baixa conectivos e palavras longas em caixa alta. */
export function sentenceCase(s: string): string {
  const words = s.trim().split(/\s+/).map((w) => {
    const letters = w.replace(/[^\p{L}]/gu, '');
    if (w !== w.toUpperCase()) return w;
    return SMALL_WORDS.has(letters.toLowerCase()) || letters.length > 4 ? w.toLowerCase() : w;
  });
  const out = words.join(' ');
  return out.charAt(0).toUpperCase() + out.slice(1);
}

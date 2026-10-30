/**
 * Cores de série dos gráficos. Cada cor mantém contraste ≥ 3:1 (WCAG 1.4.11) tanto sobre o azul-marinho do
 * tema escuro quanto sobre branco, então o mesmo conjunto vale na tela, no tema claro, no PDF e na impressão.
 * A paleta foi escolhida por busca: as 6 primeiras cores ficam a CIEDE2000 ≥ 12 umas das outras para quem vê normal e para
 * protanopia, deuteranopia e tritanopia simuladas (8 cores: ≥ 9; 10 cores: ≥ 8) — test/daltonismo.test.ts mede e registra.
 * Cor nunca é o único sinal (legendas e rótulos continuam presentes).
 */
export const PALETTE = ['#2B86D9', '#C08808', '#B83890', '#806800', '#008058', '#F02068', '#E058A0', '#2868C8', '#00A078', '#C03848'] as const;

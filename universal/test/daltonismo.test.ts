// Daltonismo: simula protanopia, deuteranopia e tritanopia (Machado et al. 2009, gravidade máxima, RGB linear) e mede a distância
// de cor (CIEDE2000) entre as cores da paleta dos gráficos e entre as classes da rampa do mapa temático.
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PALETTE } from '../src/design/palette.js';
import { RAMP } from '../src/geo/thematic.js';
import { de2000, distancia, VISOES, visao } from './util/cor.js';

/** Menor distância entre duas cores do conjunto, e o par, para uma visão. */
function pior(cores: readonly string[], nome: string | null) {
  let min = Infinity;
  let par = '';
  for (let i = 0; i < cores.length; i++)
    for (let j = i + 1; j < cores.length; j++) {
      const d = de2000(visao(cores[i]!, nome), visao(cores[j]!, nome));
      if (d < min) [min, par] = [d, `${cores[i]} × ${cores[j]}`];
    }
  return { min, par };
}

/** As séries recebem as cores na ordem da paleta: até 6 séries é o caso comum; 8 e 10 são os extremos aceitos antes de a legenda ficar indispensável. */
const LIMITES: [number, number][] = [[6, 12], [8, 9], [10, 8]];

describe('daltonismo: paleta dos gráficos', () => {
  it('o simulador está certo: vermelho e verde puros ficam muito distantes para quem vê normal e bem menos para o deuteranopo', () => {
    expect(de2000(visao('#FF0000', null), visao('#00FF00', null))).toBeGreaterThan(80);
    expect(de2000(visao('#FF0000', 'deuteranopia'), visao('#00FF00', 'deuteranopia'))).toBeLessThan(40);
  });
  it('as cores das séries continuam distinguíveis em cada tipo de daltonismo (CIEDE2000)', () => {
    const medidas: Record<string, unknown> = {};
    for (const [n, limite] of LIMITES) {
      for (const nome of VISOES) {
        const r = pior(PALETTE.slice(0, n), nome);
        medidas[`${n} séries · ${nome ?? 'visão normal'}`] = { menorDistancia: +r.min.toFixed(1), par: r.par, limite };
        expect(r.min, `${n} séries, ${nome ?? 'visão normal'}: ${r.par}`).toBeGreaterThanOrEqual(limite);
      }
    }
    // as medidas só são gravadas sob pedido (ESCREVER_MEDIDAS=1), para o teste não alterar arquivos do repositório
    if (process.env.ESCREVER_MEDIDAS) writeFileSync(new URL('../../docs/benchmarks/daltonismo.json', import.meta.url), JSON.stringify({ metodo: 'Machado 2009, gravidade máxima; CIEDE2000', paleta: PALETTE, medidas }, null, 2));
  });
  it('a menor distância olhando pelos quatro tipos de visão ao mesmo tempo é a mesma do conjunto', () => {
    const todas = PALETTE.flatMap((a, i) => PALETTE.slice(i + 1).map((b) => distancia(a, b)));
    expect(Math.min(...todas)).toBeGreaterThanOrEqual(8);
  });
  it('a rampa do mapa temático cresce em luminosidade (sem inversões) para quem vê normal e nos três tipos de daltonismo', () => {
    for (const nome of VISOES) {
      const L = RAMP.map((c) => visao(c, nome)[0]);
      for (let i = 1; i < L.length; i++) expect(L[i]!, `${nome ?? 'normal'}: classe ${i + 1}`).toBeLessThan(L[i - 1]!);
    }
  });
  it('classes vizinhas da rampa são distinguíveis (CIEDE2000 ≥ 8 entre vizinhas)', () => {
    for (const nome of VISOES) for (let i = 1; i < RAMP.length; i++) expect(de2000(visao(RAMP[i - 1]!, nome), visao(RAMP[i]!, nome)), `${nome ?? 'normal'}: ${i}→${i + 1}`).toBeGreaterThanOrEqual(8);
  });
});

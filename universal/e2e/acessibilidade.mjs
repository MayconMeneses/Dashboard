// Acessibilidade medida no navegador (Chromium): largura de tablet, zoom de 200% e reflow, navegação completa por teclado,
// foco visível, tamanho dos alvos de toque e filtro por teclado. Uso: npm run build && node e2e/acessibilidade.mjs
// Daltonismo e contraste de cores são medidos por testes unitários (test/daltonismo.test.ts e test/design.test.ts).
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const pw = await import(process.env.PLAYWRIGHT_MODULE ?? new URL('../../node_modules/playwright-core/index.mjs', import.meta.url).href);
const dir = mkdtempSync(join(tmpdir(), 'universal-a11y-'));
const app = new URL('../dist/index.html', import.meta.url).href;
const NL = String.fromCharCode(10);
const log = [];
const ok = (m) => log.push('✓ ' + m);

const ufs = ['SP', 'RJ', 'MG', 'BA', 'CE'];
const linhas = ['cidade;uf;valor;data;latitude;longitude'];
for (let i = 0; i < 40; i++) linhas.push(`cidade ${i};${ufs[i % 5]};${10 + i * 3};${String((i % 9) + 1).padStart(2, '0')}/${String((i % 12) + 1).padStart(2, '0')}/2024;-${4 + (i % 7) / 10};-${40 + (i % 9) / 10}`);
writeFileSync(join(dir, 'a11y.csv'), linhas.join(NL));

const browser = await pw.chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const errors = [];
const nova = async (w, h, tema) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: tema === 'claro' ? 'light' : 'dark' });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(app);
  return p;
};
async function abrirPainel(p) {
  await p.setInputFiles('#file', join(dir, 'a11y.csv'));
  await p.waitForSelector('#preview:not([hidden]) h2');
  await p.click('#preview button.primary');
  await p.waitForSelector('#charts .chart');
  await p.waitForTimeout(600);
}

// 1. Tablet, zoom de 200% (640 px de largura CSS) e reflow (320 px): a página não rola na horizontal
for (const [nome, w, h] of [['desktop', 1280, 900], ['tablet', 768, 1024], ['zoom 200%', 640, 450], ['reflow 320 px', 320, 640]]) {
  const p = await nova(w, h);
  await abrirPainel(p);
  const r = await p.evaluate(() => {
    const largura = document.documentElement.clientWidth;
    const rola = (e) => {
      for (let n = e.parentElement; n && n !== document.body; n = n.parentElement) {
        // um ancestral que corta ou rola o conteúdo e cabe na tela (tabela larga, mapa) contém o excesso
        if (getComputedStyle(n).overflowX !== 'visible' && n.getBoundingClientRect().right <= largura + 1) return true;
      }
      return false;
    };
    const fora = [...document.querySelectorAll('body *')]
      .filter((e) => e.getClientRects().length && e.getBoundingClientRect().right > largura + 1 && !rola(e))
      .slice(0, 6)
      .map((e) => `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${e.className && typeof e.className === 'string' ? '.' + e.className.split(' ')[0] : ''}`);
    return { rolagem: document.documentElement.scrollWidth - largura, fora };
  });
  assert.ok(r.rolagem <= 1, `${nome}: rolagem horizontal de ${r.rolagem}px; elementos fora: ${r.fora.join(', ')}`);
  assert.deepEqual(r.fora, [], `${nome}: elementos além da borda (fora de áreas rolantes): ${r.fora.join(', ')}`);
  await p.context().close();
}
ok('sem rolagem horizontal da página em 1280, 768 (tablet), 640 (zoom de 200%) e 320 px (reflow)');

// 2. Teclado: a tela inicial, o seletor de arquivo e o painel inteiro
{
  const p = await nova(1280, 900);
  await p.focus('#drop');
  const [fc] = await Promise.all([p.waitForEvent('filechooser', { timeout: 5000 }), p.keyboard.press('Enter')]);
  assert.ok(fc, 'Enter na área de arquivo abre o seletor');
  await fc.setFiles(join(dir, 'a11y.csv'));
  await p.waitForSelector('#preview:not([hidden]) h2');
  await p.click('#preview button.primary');
  await p.waitForSelector('#charts .chart');
  await p.waitForTimeout(600);
  // percorre com Tab e registra cada parada
  // ponto de partida no começo do documento (senão o Tab recomeça de onde estava o último clique)
  await p.evaluate(() => {
    window.scrollTo(0, 0);
    const inicio = document.createElement('span');
    inicio.tabIndex = -1;
    document.body.prepend(inicio);
    inicio.focus();
  });
  const paradas = [];
  for (let i = 0; i < 600; i++) {
    await p.keyboard.press('Tab');
    const s = await p.evaluate(() => {
      const e = document.activeElement;
      if (!e || e === document.body) return null;
      const cs = getComputedStyle(e);
      const r = e.getBoundingClientRect();
      const contorno = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2;
      const sombra = cs.boxShadow !== 'none';
      const rotulo = e.getAttribute('aria-label') || (e.textContent || '').trim().slice(0, 30) || e.tagName;
      return { tag: e.tagName.toLowerCase(), rotulo, detalhe: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.boxShadow + ' fv=' + e.matches(':focus-visible'), visivel: contorno || sombra, w: Math.round(r.width), h: Math.round(r.height), chave: e.tagName + '|' + (e.id || '') + '|' + rotulo + '|' + Math.round(r.top) + '|' + Math.round(r.left) };
    });
    if (!s) break;
    if (paradas.length && paradas[0].chave === s.chave) break;
    paradas.push(s);
  }
  assert.ok(paradas.length > 20, 'o Tab percorre o painel inteiro: ' + paradas.length + ' paradas');
  const semFoco = paradas.filter((x) => !x.visivel);
  assert.deepEqual(semFoco.map((x) => `${x.tag}:${x.rotulo} [${x.detalhe}]`), [], 'toda parada do Tab tem indicador de foco visível');
  // tudo que é interativo e visível é alcançável por Tab
  const todos = await p.evaluate(() =>
    [...document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, summary, [tabindex]')]
      .filter((e) => !e.disabled && e.tabIndex >= 0 && e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' && !e.closest('[hidden], details:not([open]) > :not(summary)'))
      .map((e) => e.tagName + '|' + (e.id || '') + '|' + (e.getAttribute('aria-label') || (e.textContent || '').trim().slice(0, 30) || e.tagName)),
  );
  const alcancados = new Set(paradas.map((x) => x.chave.split('|').slice(0, 3).join('|')));
  const faltam = todos.filter((t) => !alcancados.has(t));
  assert.ok(faltam.length <= 2, `controles visíveis que o Tab não alcança: ${faltam.slice(0, 8).join('; ')}`);
  ok(`teclado: ${paradas.length} paradas pelo Tab, todas com indicador de foco; ${todos.length - faltam.length} de ${todos.length} controles visíveis alcançáveis`);

  // 3. Alvos de toque: pelo menos 24 × 24 px (WCAG 2.5.8)
  const pequenos = await p.evaluate(() =>
    [...document.querySelectorAll('button, select, input:not([type=hidden]):not([type=checkbox]), summary, a[href]')]
      // exceção da WCAG 2.5.8: link dentro de uma frase (o “Leaflet” da atribuição do mapa)
      .filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' && !e.closest('[hidden], details:not([open]) > :not(summary), .leaflet-control-attribution'))
      .map((e) => ({ r: e.getBoundingClientRect(), n: e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.split(' ')[0] : '') + ':' + ((e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 24)) }))
      .filter((x) => x.r.width < 24 || x.r.height < 24)
      .map((x) => `${x.n} ${Math.round(x.r.width)}×${Math.round(x.r.height)}`),
  );
  assert.deepEqual(pequenos, [], 'alvos menores que 24×24 px: ' + pequenos.join('; '));
  ok('todos os controles têm pelo menos 24 × 24 px');

  // 4. Filtro por teclado: abrir a tabela de dados de um gráfico e acionar o botão do rótulo
  const resumo = p.locator('#charts .chart', { has: p.locator('h3', { hasText: 'Registros por uf' }) }).locator('details.data-alt > summary').first();
  assert.match(await resumo.innerText(), /filtrar por teclado/);
  await resumo.scrollIntoViewIfNeeded();
  await resumo.focus();
  await p.keyboard.press('Enter');
  await p.keyboard.press('Tab');
  const foco = await p.evaluate(() => document.activeElement?.className);
  assert.equal(foco, 'pick', 'o próximo Tab cai no botão do primeiro rótulo');
  await p.keyboard.press('Enter');
  await p.waitForSelector('#chips .chip');
  const chips = await p.locator('#chips .chip').count();
  assert.equal(chips, 1, 'um filtro aplicado só pelo teclado');
  const registros = await p.evaluate(() => [...document.querySelectorAll('#kpis .kpi')].find((k) => k.querySelector('span')?.textContent === 'Registros')?.querySelector('b')?.textContent);
  assert.ok(Number(registros) > 0 && Number(registros) < 40, 'o filtro reduz os registros: ' + registros);
  ok('filtro cruzado acionado só pelo teclado (tabela de dados do gráfico): ' + registros + ' de 40 registros');
  await p.context().close();
}

// 5. Mapa: os valores não dependem do mouse (tabela equivalente com os mesmos pontos)
{
  const p = await nova(1280, 900);
  await abrirPainel(p);
  const mapa = p.locator('#charts .map').first();
  await mapa.scrollIntoViewIfNeeded();
  const detalhes = p.locator('#charts details.data-alt', { hasText: 'dados do mapa' }).first();
  assert.equal(await detalhes.count(), 1, 'há tabela equivalente ao mapa');
  await detalhes.locator('summary').click();
  const linhasTabela = await detalhes.locator('tbody tr').count();
  assert.equal(linhasTabela, 40, 'uma linha por ponto desenhado');
  assert.match((await mapa.getAttribute('aria-label')) ?? '', /40 feição/);
  ok('o mapa tem região nomeada e tabela com os 40 pontos (teclado e leitor de tela)');
  await p.context().close();
}

// 6. Foco visível no tema claro também
{
  const p = await nova(1280, 900, 'claro');
  await p.evaluate(() => localStorage.setItem('du-tema', 'light'));
  await p.reload();
  await p.focus('#drop');
  const f = await p.evaluate(() => {
    const cs = getComputedStyle(document.activeElement);
    return { tema: document.documentElement.dataset.theme, estilo: cs.outlineStyle, largura: parseFloat(cs.outlineWidth), cor: cs.outlineColor, sombra: cs.boxShadow };
  });
  assert.equal(f.tema, 'light');
  assert.ok((f.estilo !== 'none' && f.largura >= 2) || f.sombra !== 'none', 'foco visível no tema claro: ' + JSON.stringify(f));
  ok('foco visível também no tema claro');
  await p.context().close();
}

assert.deepEqual(errors, [], 'sem erros de página: ' + errors.join(' | '));
await browser.close();
console.log(log.join(NL));

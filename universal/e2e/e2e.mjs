// Teste de ponta a ponta no navegador (Chromium). Uso: npm run build && npm run test:e2e
// Variáveis: CHROME_PATH (padrão /opt/pw-browsers/chromium), PLAYWRIGHT_MODULE (padrão ../../node_modules/playwright-core/index.mjs)
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const pw = await import(process.env.PLAYWRIGHT_MODULE ?? new URL('../../node_modules/playwright-core/index.mjs', import.meta.url).href);
const dir = mkdtempSync(join(tmpdir(), 'universal-e2e-'));
const app = new URL('../dist/index.html', import.meta.url).href;
const latin1 = (s) => Buffer.from([...s].map((c) => c.charCodeAt(0)));

// --- arquivos de teste (dados fictícios)
const cidades = ['Croatá', 'Croata', 'CROATÁ', 'Tianguá', 'Tiangua'];
let csv = 'cidade;valor;data;qtd\n';
for (let i = 0; i < 40; i++) csv += `${cidades[i % 5]};${i},5;${String((i % 12) + 1).padStart(2, '0')}/${String((i % 9) + 1).padStart(2, '0')}/2024;${i === 7 ? 'abc' : i}\n`;
writeFileSync(join(dir, 'cp1252.csv'), latin1(csv));
let big = 'id,v\n';
for (let i = 0; i < 120000; i++) big += `${i},${i % 7}\n`;
writeFileSync(join(dir, 'grande.csv'), big);

const log = [];
const ok = (name) => log.push('✓ ' + name);
const browser = await pw.chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(app);

// 1. Prévia com Windows-1252 + ";" + valor inválido + datas ambíguas
await page.setInputFiles('#file', join(dir, 'cp1252.csv'));
await page.waitForSelector('#preview:not([hidden]) h2');
const prev = await page.locator('#preview').innerText();
assert.match(prev, /Windows-1252/);
assert.match(prev, /ponto e vírgula/);
assert.ok(!prev.includes('�'), 'sem caractere de substituição');
assert.match(prev, /Croatá/);
assert.match(prev, /linha 8: “abc”/);
assert.equal(await page.locator('#app').isHidden(), true, 'painel não aparece antes de confirmar');
ok('prévia mostra codificação, separador, valor inválido e não gera o painel antes do aceite');

// 2. Confirmar → painel; alerta de grafias → Juntar
await page.click('#preview button.primary');
await page.waitForSelector('#kpis .kpi');
const alerts = await page.locator('#alerts').innerText();
assert.match(alerts, /parecem a mesma categoria/);
await page.locator('#alerts button', { hasText: 'Juntar como' }).first().click();
await page.waitForTimeout(300);
assert.match(await page.locator('#alerts').innerText(), /grafias unificadas por você/);
ok('juntar grafias aplica e mostra "Desfazer"');

// 3. Tabela: ordenar e paginar
await page.locator('#tbl th button', { hasText: 'qtd' }).click();
assert.equal(await page.locator('#tbl th[aria-sort="ascending"]').count(), 1);
await page.selectOption('select[aria-label="Linhas por página"]', '25');
assert.match(await page.locator('#pager').innerText(), /Página 1 de 2/);
await page.locator('#pager button', { hasText: 'Próxima' }).click();
assert.match(await page.locator('#pager').innerText(), /Página 2 de 2/);
ok('ordenação e paginação');

// 4. Período
const dateCols = await page.locator('#dateBar select').count();
assert.equal(dateCols, 1);
await page.fill('#dateBar input[aria-label="Período: de"]', '2024-03-01');
await page.fill('#dateBar input[aria-label="Período: até"]', '2024-04-30');
await page.dispatchEvent('#dateBar input[aria-label="Período: até"]', 'change');
await page.waitForTimeout(300);
const info = await page.locator('#tinfo').innerText();
assert.match(info, /filtradas de 40/);
ok('filtro por período');

// 4b. Métrica própria, renomear campo, restaurar gráfico, Excel, projeto e "Atualizar dados"
await page.fill('input[aria-label="Nome da métrica"]', 'Soma dobrada');
await page.fill('input[aria-label="Fórmula da métrica"]', 'SUM([qtd]) * 2');
await page.click('button:has-text("Adicionar métrica")');
await page.waitForTimeout(300);
assert.ok((await page.locator('#kpis .kpi').allInnerTexts()).some((x) => x.includes('Soma dobrada')), 'KPI da métrica');
assert.match(await page.locator('#metricsBox').innerText(), /SUM\(\[qtd\]\) \* 2/, 'fórmula visível');
await page.fill('input[aria-label="Nome da coluna qtd"]', 'quantidade');
await page.dispatchEvent('input[aria-label="Nome da coluna qtd"]', 'change');
await page.waitForTimeout(300);
assert.match(await page.locator('#metricsBox').innerText(), /\[quantidade\]/, 'fórmula acompanha o renome');
assert.ok((await page.locator('#tbl th').allInnerTexts()).join('|').includes('quantidade'));
ok('métrica própria com fórmula visível e renomear campo (fórmula acompanha)');

const nCharts = await page.locator('.chart').count();
await page.locator('.chart .x').first().click();
assert.equal(await page.locator('.chart').count(), nCharts - 1);
await page.click('#btnRestore');
assert.equal(await page.locator('.chart').count(), nCharts);
ok('remover e restaurar gráfico');

const { unzipSync } = await import('fflate');
const [xl] = await Promise.all([page.waitForEvent('download'), page.click('#btnXlsx')]);
await xl.saveAs(join(dir, 'saida.xlsx'));
const zx = unzipSync(new Uint8Array(readFileSync(join(dir, 'saida.xlsx'))));
assert.ok(zx['xl/workbook.xml'] && zx['[Content_Types].xml'], 'xlsx válido');
assert.match(new TextDecoder().decode(zx['xl/workbook.xml']), /Origem e ajustes/);
ok('Excel (.xlsx) com aba de dados e aba de origem/ajustes');

const [pj] = await Promise.all([page.waitForEvent('download'), page.click('#btnSaveProj')]);
await pj.saveAs(join(dir, 'p.projeto.json'));
const proj = JSON.parse(readFileSync(join(dir, 'p.projeto.json'), 'utf8'));
assert.equal(proj.estado.metrics.length, 1);
assert.equal(proj.estado.renames.qtd, 'quantidade');
ok('projeto salvo (sem os dados) com métrica e renomes');

const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('#btnUpdate')]);
await fc.setFiles(join(dir, 'cp1252.csv'));
await page.waitForSelector('#preview:not([hidden]) .notice');
assert.match(await page.locator('#preview .notice').innerText(), /Configuração reaplicada/);
assert.match(await page.locator('#preview .notice').innerText(), /Linhas: 40 → 40/);
await page.click('#preview button.primary');
await page.waitForSelector('#kpis .kpi');
assert.ok((await page.locator('#kpis .kpi').allInnerTexts()).some((x) => x.includes('Soma dobrada')));
assert.match(await page.locator('#tinfo').innerText(), /filtradas de 40/);
ok('Atualizar dados reaplica métrica, período e ajustes e mostra o que mudou');

const p4 = await browser.newPage({ viewport: { width: 1280, height: 900 } });
p4.on('pageerror', (e) => errors.push(e.message));
await p4.goto(app);
await p4.setInputFiles('#projFile', join(dir, 'p.projeto.json'));
await p4.waitForFunction(() => document.getElementById('note')?.textContent?.includes('Projeto aberto'));
await p4.setInputFiles('#file', join(dir, 'cp1252.csv'));
await p4.waitForSelector('#preview:not([hidden]) .notice');
await p4.click('#preview button.primary');
await p4.waitForSelector('#kpis .kpi');
assert.ok((await p4.locator('#kpis .kpi').allInnerTexts()).some((x) => x.includes('Soma dobrada')));
await p4.close();
ok('abrir projeto salvo e aplicar a um arquivo');

// 5. Relatório em PDF de verdade (download direto, sem diálogo de impressão)
const [pdfDl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#btnReport')]);
assert.match(pdfDl.suggestedFilename(), /^relatorio-cp1252\.pdf$/);
const pdfPath = join(dir, 'relatorio.pdf');
await pdfDl.saveAs(pdfPath);
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(pdfPath)) }).promise;
assert.ok(doc.numPages >= 2, 'PDF com 2 ou mais páginas');
let pdfText = '';
let images = 0;
for (let i = 1; i <= doc.numPages; i++) {
  const pg = await doc.getPage(i);
  pdfText += (await pg.getTextContent()).items.map((x) => x.str).join(' ') + '\n';
  const ops = await pg.getOperatorList();
  images += ops.fnArray.filter((f) => f === pdfjs.OPS.paintImageXObject || f === pdfjs.OPS.paintInlineImageXObject).length;
}
for (const s of ['1. Filtros, período e ajustes aplicados', 'Período em', 'Grafias unificadas', '3. Gráficos', '4. Critérios de cálculo', '5. Limitações e avisos', '6. Como reproduzir', 'Anexo A', 'Página 1 de']) assert.ok(pdfText.includes(s), 'PDF contém: ' + s);
for (const s of ['SHA-256', 'Origem dos dados', 'Registros analisados', 'Tamanho', 'Versão do painel']) assert.ok(!pdfText.includes(s), 'PDF não traz: ' + s);
assert.ok(images >= 1, 'PDF contém imagens dos gráficos');
ok(`relatório em PDF real: ${doc.numPages} páginas, texto selecionável, ${images} imagem(ns) de gráfico, numeração de páginas`);

// 6. Mapa sem fundo / HTML compartilhável restaura o estado
await page.click('#btnHtml');
await page.fill('#shTitle', 'Teste E2E');
await page.fill('#shFile', 'e2e');
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#shGo')]);
await dl.saveAs(join(dir, 'e2e.html'));
const p2 = await browser.newPage({ viewport: { width: 1280, height: 900 } });
p2.on('pageerror', (e) => errors.push(e.message));
await p2.goto(pathToFileURL(join(dir, 'e2e.html')).href);
await p2.waitForSelector('#kpis .kpi');
assert.equal(await p2.title(), 'Teste E2E');
assert.equal(await p2.evaluate(() => document.body.classList.contains('shared')), true);
assert.match(await p2.locator('#alerts').innerText(), /grafias unificadas por você/);
assert.match(await p2.locator('#tinfo').innerText(), /filtradas de 40/);
assert.equal(await p2.locator('#btnHtml').isVisible(), false);
ok('HTML compartilhável reabre com grafias unificadas, período e modo leitura');

// 7. Arquivo grande (120 mil linhas) abre
const p3 = await browser.newPage({ viewport: { width: 1280, height: 900 } });
p3.on('pageerror', (e) => errors.push(e.message));
await p3.goto(app);
const t0 = Date.now();
await p3.setInputFiles('#file', join(dir, 'grande.csv'));
await p3.waitForSelector('#preview:not([hidden]) h2', { timeout: 60000 });
assert.match(await p3.locator('#preview').innerText(), /120\.000/);
await p3.click('#preview button.primary');
await p3.waitForSelector('#kpis .kpi', { timeout: 60000 });
ok(`arquivo com 120 mil linhas abre (${((Date.now() - t0) / 1000).toFixed(1)} s)`);

// 8. Tema: escuro por padrão, troca para claro, preferência lembrada (mesmo contexto = mesmo armazenamento)
assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const t1 = await ctx.newPage();
t1.on('pageerror', (e) => errors.push(e.message));
await t1.goto(app);
assert.equal(await t1.evaluate(() => document.documentElement.dataset.theme), 'dark', 'padrão escuro');
await t1.selectOption('#themeSel', 'light');
assert.equal(await t1.evaluate(() => document.documentElement.dataset.theme), 'light');
const t2 = await ctx.newPage();
t2.on('pageerror', (e) => errors.push(e.message));
await t2.goto(app);
assert.equal(await t2.evaluate(() => document.documentElement.dataset.theme), 'light', 'tema claro lembrado');
assert.equal(await t2.locator('#themeSel').inputValue(), 'light');
await ctx.close();
ok('tema escuro por padrão, troca para claro e preferência lembrada');

// 9. Barra lateral: salta para a seção e recolhe
const y0 = await page.evaluate(() => window.scrollY);
await page.locator('.sidenav a', { hasText: 'Dados' }).click();
await page.waitForTimeout(900);
assert.ok((await page.evaluate(() => window.scrollY)) > y0, 'link "Dados" rolou a página');
await page.click('#navToggle');
assert.equal(await page.evaluate(() => document.getElementById('shell').classList.contains('nav-collapsed')), true);
assert.equal(await page.getAttribute('#navToggle', 'aria-expanded'), 'false');
await page.click('#navToggle');
ok('barra lateral: links levam à seção e o menu recolhe/expande');

// 10. Imagens dos gráficos no PDF saem em tema claro (texto escuro, fundo branco) mesmo com a tela escura
await page.evaluate(() => {
  const o = HTMLCanvasElement.prototype.toDataURL;
  window.__png = [];
  HTMLCanvasElement.prototype.toDataURL = function (...a) {
    const r = o.apply(this, a);
    window.__png.push(r);
    return r;
  };
});
await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#btnReport')]);
const pix = await page.evaluate(async () => {
  const url = window.__png.find((u) => u.startsWith('data:image/png'));
  const img = new Image();
  img.src = url;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const x = c.getContext('2d');
  x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height).data;
  const near = (i, r, g, b) => Math.abs(d[i] - r) < 4 && Math.abs(d[i + 1] - g) < 4 && Math.abs(d[i + 2] - b) < 4;
  let darkText = 0;
  let lightText = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (near(i, 0xb7, 0xc8, 0xdd)) lightText++;
    if (near(i, 0x2c, 0x3e, 0x57)) darkText++;
  }
  return { corner: [d[0], d[1], d[2], d[3]], darkText, lightText };
});
assert.deepEqual(pix.corner, [255, 255, 255, 255], 'fundo do gráfico no PDF é branco opaco');
assert.ok(pix.darkText > 50, 'texto escuro presente: ' + pix.darkText);
assert.ok(pix.lightText < 10, 'sem texto claro do tema escuro: ' + pix.lightText);
assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark', 'tela continua escura');
ok('gráficos do PDF saem com fundo branco e texto escuro mesmo no tema escuro');

// 11. Dica do mapa mostra o texto do arquivo como texto, sem executar HTML
{
  const evil = '<img src=x onerror="window.__xss=1">';
  const linhas = ['nome;latitude;longitude'];
  for (let i = 0; i < 12; i++) linhas.push(`${i === 0 ? evil : 'ponto ' + i};-4.${40 + i};-40.${90 + i}`);
  const c = linhas.join('\n');
  writeFileSync(join(dir, 'xss.csv'), c);
  const px = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  px.on('pageerror', (e) => errors.push(e.message));
  await px.goto(app);
  await px.setInputFiles('#file', join(dir, 'xss.csv'));
  await px.waitForSelector('#preview:not([hidden]) h2');
  await px.click('#preview button.primary');
  await px.waitForSelector('#charts .map .leaflet-interactive', { timeout: 20000 });
  await px.locator('#charts .map .leaflet-interactive').first().dispatchEvent('mouseover');
  await px.waitForSelector('.leaflet-tooltip', { timeout: 5000 });
  await px.waitForTimeout(300);
  assert.equal(await px.evaluate(() => window.__xss), undefined, 'HTML do arquivo não pode executar na dica do mapa');
  assert.equal(await px.evaluate(() => document.querySelectorAll('.leaflet-tooltip img').length), 0, 'sem elemento <img> criado pelo conteúdo do arquivo');
  assert.match(await px.locator('.leaflet-tooltip').first().innerText(), /<img src=x/);
  await px.close();
  ok('dica do mapa trata o valor do arquivo como texto (sem executar HTML)');
}

// 12. Papel e origem das colunas e efeito do filtro aparecem na tela
{
  const ufs = ['SP', 'RJ', 'MG', 'BA'];
  const linhas = ['cep;uf;vendas'];
  for (let i = 0; i < 24; i++) linhas.push(`${10000000 + i * 7919};${ufs[i % 4]};${100 + i * 10}`);
  writeFileSync(join(dir, 'papeis.csv'), linhas.join(String.fromCharCode(10)));
  const pp = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  pp.on('pageerror', (e) => errors.push(e.message));
  await pp.goto(app);
  await pp.setInputFiles('#file', join(dir, 'papeis.csv'));
  await pp.waitForSelector('#preview:not([hidden]) h2');
  await pp.click('#preview button.primary');
  await pp.waitForSelector('#cols tbody tr');
  const linha = async (nome) => pp.evaluate((n) => [...document.querySelectorAll('#cols tbody tr')].find((tr) => tr.querySelector('input')?.value === n)?.lastElementChild?.textContent ?? null, nome);
  assert.match(await linha('uf'), /^dimensão · Lida do arquivo sem alteração./);
  assert.match(await linha('vendas'), /^medida · /);
  assert.match(await linha('cep'), /^identificador · /, 'CEP é identificador');
  assert.equal(await pp.locator('#charts .card', { hasText: 'cep' }).count(), 0, 'nenhum gráfico usa o CEP');
  // renomear aparece na linhagem
  const idx = await pp.evaluate(() => [...document.querySelectorAll('#cols tbody tr')].findIndex((tr) => tr.querySelector('input')?.value === 'vendas'));
  await pp.locator('#cols tbody tr').nth(idx).locator('input').first().fill('faturamento');
  await pp.keyboard.press('Tab');
  await pp.waitForFunction(() => [...document.querySelectorAll('#cols tbody tr')].some((tr) => tr.querySelector('input')?.value === 'faturamento' && /Renomeada de “vendas”/.test(tr.lastElementChild.textContent)));
  // filtro: clicar na primeira barra do gráfico por UF
  const cv = pp.locator('#charts canvas[aria-label^="Registros por uf"]').first();
  await cv.scrollIntoViewIfNeeded();
  const box = await cv.boundingBox();
  for (const fy of [0.1, 0.18, 0.26, 0.34, 0.42, 0.5, 0.58, 0.66, 0.74, 0.82]) {
    if (await pp.locator('#chips .chip').count()) break;
    await pp.mouse.click(box.x + box.width * 0.35, box.y + box.height * fy);
    await pp.waitForTimeout(250);
  }
  assert.ok(await pp.locator('#chips .chip').count(), 'filtro aplicado pelo clique no gráfico');
  assert.match(await pp.locator('#chips .filter-note').innerText(), /Efeito do filtro — .*“uf”: 6 de 24 preenchidas, 1 de 4 valores distintos/);
  await pp.close();
  ok('tabela de colunas mostra papel e origem; filtro mostra o efeito nas colunas');
}

// 13. Exploração manual e filtro cruzado: KPIs, tabela e gráficos concordam
{
  const ufs = ['SP', 'RJ', 'MG', 'BA'];
  const linhas = ['uf;taxa;vendas'];
  for (let i = 0; i < 24; i++) linhas.push(`${ufs[i % 4]};${50 + (i % 5) * 10}%;${100 + i * 10}`);
  writeFileSync(join(dir, 'explorar.csv'), linhas.join(String.fromCharCode(10)));
  const px = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  px.on('pageerror', (e) => errors.push(e.message));
  await px.goto(app);
  await px.setInputFiles('#file', join(dir, 'explorar.csv'));
  await px.waitForSelector('#preview:not([hidden]) h2');
  await px.click('#preview button.primary');
  await px.waitForSelector('#secExplorar canvas', { timeout: 20000 });
  const sel = (nome) => px.locator(`#secExplorar select[aria-label="${nome}"]`);
  // percentual: somar é recusado com explicação
  await sel('Cálculo').selectOption('sum');
  await px.waitForSelector('#secExplorar [role=alert]');
  assert.match(await px.locator('#secExplorar [role=alert]').innerText(), /somar não tem significado/);
  assert.equal(await px.locator('#secExplorar canvas').count(), 0, 'sem gráfico para combinação sem sentido');
  // medida somável com mediana
  await sel('Medida').selectOption('vendas');
  await sel('Cálculo').selectOption('median');
  await px.waitForSelector('#secExplorar canvas');
  assert.equal(await px.locator('#secExplorar h3').nth(1).innerText(), 'Mediana de vendas por uf');
  // filtro cruzado por clique: KPI de registros e tabela acompanham
  const cv = px.locator('#charts canvas[aria-label^="Registros por uf"]').first();
  await cv.scrollIntoViewIfNeeded();
  const box = await cv.boundingBox();
  for (const fy of [0.1, 0.18, 0.26, 0.34, 0.42, 0.5, 0.58, 0.66, 0.74, 0.82]) {
    if (await px.locator('#chips .chip').count()) break;
    await px.mouse.click(box.x + box.width * 0.35, box.y + box.height * fy);
    await px.waitForTimeout(250);
  }
  assert.ok(await px.locator('#chips .chip').count(), 'filtro aplicado');
  const kpiReg = await px.evaluate(() => [...document.querySelectorAll('#kpis .kpi')].find((k) => k.querySelector('span')?.textContent === 'Registros')?.querySelector('b')?.textContent);
  assert.equal(kpiReg, '6', 'KPI de registros acompanha o filtro');
  assert.equal(await px.locator('#tbl tbody tr').count(), 6, 'tabela mostra as mesmas 6 linhas');
  await px.waitForSelector('#secExplorar canvas');
  await px.close();
  ok('exploração manual valida combinações e filtro cruzado deixa KPIs e tabela coerentes');
}

assert.deepEqual(errors, [], 'sem erros de página: ' + errors.join(' | '));
await browser.close();
console.log(log.join('\n'));

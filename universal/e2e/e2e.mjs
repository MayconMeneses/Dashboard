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

// 14. Geometrias reais: polígono com buraco, mapa temático, dica sem HTML, coordenada projetada e desempenho
{
  const sq = (x, y, w, hole) => ({ type: 'Polygon', coordinates: [[[x, y], [x + w, y], [x + w, y + w], [x, y + w], [x, y]], ...(hole ? [[[x, y], [x + w / 2, y], [x + w / 2, y + w / 2], [x, y + w / 2], [x, y]]] : [])] });
  const evil = '<img src=x onerror="window.__xss=1">';
  const fc = { type: 'FeatureCollection', features: [
    { type: 'Feature', properties: { nome: evil, pop: 10 }, geometry: sq(-41, -5, 1, true) },
    { type: 'Feature', properties: { nome: 'B', pop: 500 }, geometry: sq(-39.5, -5, 1) },
    { type: 'Feature', properties: { nome: 'C', pop: 90 }, geometry: sq(-38, -5, 1) },
  ] };
  writeFileSync(join(dir, 'poligonos.geojson'), JSON.stringify(fc));
  const pg = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  pg.on('pageerror', (e) => errors.push(e.message));
  await pg.goto(app);
  await pg.setInputFiles('#file', join(dir, 'poligonos.geojson'));
  await pg.waitForSelector('#preview:not([hidden]) h2');
  await pg.click('#preview button.primary');
  await pg.waitForSelector('#charts .map path.leaflet-interactive', { timeout: 20000 });
  assert.equal(await pg.locator('#charts .map path.leaflet-interactive').count(), 3, 'três polígonos desenhados (formas reais, não pontos)');
  assert.equal(await pg.locator('#charts .map .leaflet-interactive').count(), 3);
  const subpaths = await pg.evaluate(() => [...document.querySelectorAll('#charts .map path.leaflet-interactive')].map((p) => (p.getAttribute('d').match(/M/g) ?? []).length));
  assert.equal(Math.max(...subpaths), 2, 'o polígono com buraco tem dois anéis no desenho');
  assert.match(await pg.locator('#charts .card p[role=status], #charts .chart p[role=status]').first().innerText(), /3 de 3 linha/);
  await pg.locator('#charts .map path.leaflet-interactive').first().dispatchEvent('mouseover');
  await pg.waitForSelector('.leaflet-tooltip', { timeout: 5000 });
  assert.equal(await pg.evaluate(() => window.__xss), undefined, 'HTML na propriedade do polígono não executa');
  assert.equal(await pg.evaluate(() => document.querySelectorAll('.leaflet-tooltip img').length), 0);
  // mapa temático por medida
  await pg.locator('select[aria-label="Colorir o mapa por"]').selectOption('pop');
  await pg.waitForSelector('#charts .map-legend li');
  assert.ok((await pg.locator('#charts .map-legend li').count()) >= 2, 'legenda com classes');
  const fills = await pg.evaluate(() => new Set([...document.querySelectorAll('#charts .map path.leaflet-interactive')].map((p) => p.getAttribute('fill'))).size);
  assert.ok(fills >= 2, 'polígonos com cores diferentes: ' + fills);
  await pg.close();

  // coordenada projetada: aviso e nada desenhado como se fosse válido
  const proj = { type: 'FeatureCollection', features: Array.from({ length: 6 }, (_, i) => ({ type: 'Feature', properties: { n: i }, geometry: { type: 'Point', coordinates: [500000 + i, 9500000] } })) };
  writeFileSync(join(dir, 'projetado.geojson'), JSON.stringify(proj));
  const pp2 = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  pp2.on('pageerror', (e) => errors.push(e.message));
  await pp2.goto(app);
  await pp2.setInputFiles('#file', join(dir, 'projetado.geojson'));
  await pp2.waitForSelector('#preview:not([hidden]) h2');
  assert.match(await pp2.locator('#preview').innerText(), /WGS84/, 'a prévia avisa sobre coordenadas projetadas');
  await pp2.close();

  // desempenho: 5.000 polígonos no limite do desenho
  const big = { type: 'FeatureCollection', features: Array.from({ length: 5000 }, (_, i) => ({ type: 'Feature', properties: { n: i, v: i % 17 }, geometry: sq(-60 + (i % 100) * 0.1, -30 + Math.floor(i / 100) * 0.1, 0.08) })) };
  writeFileSync(join(dir, 'grande.geojson'), JSON.stringify(big));
  const pb = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  pb.on('pageerror', (e) => errors.push(e.message));
  await pb.goto(app);
  await pb.setInputFiles('#file', join(dir, 'grande.geojson'));
  await pb.waitForSelector('#preview:not([hidden]) h2');
  const t0 = Date.now();
  await pb.click('#preview button.primary');
  await pb.waitForFunction(() => document.querySelectorAll('#charts .map path.leaflet-interactive').length >= 5000, null, { timeout: 60000 });
  const ms = Date.now() - t0;
  console.log('desempenho: 5000 polígonos desenhados em ' + ms + ' ms');
  assert.ok(ms < 30000, 'mapa com 5.000 polígonos em menos de 30 s: ' + ms);
  await pb.close();
  ok('geometrias reais: polígono com buraco, mapa temático, dica sem HTML, aviso de coordenada projetada, 5.000 polígonos em ' + ms + ' ms');
}

// 15. Privacidade do mapa: por padrão nenhuma requisição de mapa de fundo; a Esri só é consultada se o usuário escolher
{
  const linhas = ['nome;latitude;longitude'];
  for (let i = 0; i < 12; i++) linhas.push(`ponto ${i};-4.${40 + i};-40.${90 + i}`);
  writeFileSync(join(dir, 'fundo.csv'), linhas.join(String.fromCharCode(10)));
  const pf = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  pf.on('pageerror', (e) => errors.push(e.message));
  const externas = [];
  await pf.route(/arcgisonline.com/, (r) => {
    externas.push(r.request().url());
    return r.abort();
  });
  pf.on('request', (r) => {
    if (/^https?:/.test(r.url()) && !r.url().startsWith('file:')) externas.push(r.url());
  });
  await pf.goto(app);
  await pf.setInputFiles('#file', join(dir, 'fundo.csv'));
  await pf.waitForSelector('#preview:not([hidden]) h2');
  await pf.click('#preview button.primary');
  await pf.waitForSelector('#charts .map .leaflet-interactive', { timeout: 20000 });
  await pf.waitForTimeout(1500);
  assert.equal(await pf.locator('select[aria-label="Mapa de fundo"]').inputValue(), 'none', 'padrão: sem mapa de fundo');
  assert.deepEqual(externas, [], 'nenhuma requisição externa ao abrir o mapa: ' + externas.join(', '));
  await pf.locator('select[aria-label="Mapa de fundo"]').selectOption('esri');
  await pf.waitForFunction(() => document.querySelectorAll('#charts .map .leaflet-tile, #charts .map .leaflet-tile-pane').length > 0);
  await pf.waitForTimeout(1500);
  assert.ok(externas.some((u) => /arcgisonline/.test(u)), 'ao escolher a Esri, as imagens são pedidas (controle positivo)');
  await pf.close();
  ok('mapa abre sem fundo e sem requisição externa; a Esri só é consultada se escolhida');
}

// 16. Vários arquivos e relação entre tabelas: análise antes de confirmar, cancelar não muda nada, a receita volta ao reabrir o projeto
{
  const NL = String.fromCharCode(10);
  writeFileSync(join(dir, 'vendas.csv'), ['cod;valor', '0123;100', '0456;200', '0456;50', '0999;70', ';10'].join(NL));
  writeFileSync(join(dir, 'bairros.csv'), ['cod;pop;nome', '0123;1000;A', '0456;2000;B', '0777;3000;C'].join(NL));
  const arquivos = [join(dir, 'vendas.csv'), join(dir, 'bairros.csv')];
  const pj2 = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  pj2.on('pageerror', (e) => errors.push(e.message));
  await pj2.goto(app);
  await pj2.setInputFiles('#file', arquivos);
  await pj2.waitForSelector('#preview:not([hidden]) h2');
  const prev = await pj2.locator('#preview').innerText();
  assert.ok(prev.includes('Fonte 1') && prev.includes('Fonte 2'), 'a prévia lista as duas fontes');
  assert.ok(prev.includes('SHA-256 da fonte 2'), 'cada fonte tem o seu SHA-256');
  await pj2.click('#preview button.primary');
  await pj2.waitForSelector('#secRelacionar:not([hidden])');
  assert.equal(await pj2.locator('#tableSel option').count(), 2, 'duas tabelas, uma por arquivo');
  // análise antes de criar qualquer coisa
  await pj2.locator('#secRelacionar button', { hasText: 'Analisar relação' }).click();
  await pj2.waitForSelector('#joinAnalysis');
  const an = await pj2.locator('#joinAnalysis').innerText();
  assert.ok(an.includes('N:1'), 'cardinalidade muitos para um: ' + an);
  assert.ok(an.includes('0456') && an.includes('Chaves repetidas na esquerda'), 'aponta a chave repetida');
  assert.ok(an.includes('“pop” se repete em até 2 linhas'), 'avisa que a medida do lado um se repete');
  assert.ok(an.includes('0999') && an.includes('0777'), 'mostra exemplos sem par nos dois lados');
  // cancelar não muda nada
  await pj2.click('#joinCancel');
  assert.equal(await pj2.locator('#joinAnalysis').count(), 0, 'a análise some ao cancelar');
  assert.equal(await pj2.locator('#tableSel option').count(), 2, 'nenhuma tabela criada');
  // confirmar cria a tabela e abre
  await pj2.locator('#secRelacionar button', { hasText: 'Analisar relação' }).click();
  await pj2.waitForSelector('#joinConfirm');
  await pj2.click('#joinConfirm');
  await pj2.waitForFunction(() => document.querySelectorAll('#tableSel option').length === 3);
  const reg = () => pj2.evaluate(() => [...document.querySelectorAll('#kpis .kpi')].find((k) => k.querySelector('span')?.textContent === 'Registros')?.querySelector('b')?.textContent);
  assert.equal(await reg(), '5', 'relação à esquerda mantém as 5 linhas de vendas');
  assert.ok((await pj2.locator('#cols tbody tr input').evaluateAll((l) => l.map((i) => i.value))).includes('pop'), 'a coluna da direita entrou');
  // projeto guarda a receita, não as linhas
  const [pdl] = await Promise.all([pj2.waitForEvent('download'), pj2.click('#btnSaveProj')]);
  await pdl.saveAs(join(dir, 'rel.projeto.json'));
  const rel = JSON.parse(readFileSync(join(dir, 'rel.projeto.json'), 'utf8'));
  assert.equal(rel.estado.joins.length, 1);
  assert.equal(rel.estado.joins[0].leftKey, 'cod');
  assert.ok(!JSON.stringify(rel).includes('Chaves repetidas') && JSON.stringify(rel).length < 5000, 'projeto pequeno, sem as linhas da relação');
  await pj2.close();
  // reabrir o projeto e os mesmos arquivos refaz a relação
  const p5 = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  p5.on('pageerror', (e) => errors.push(e.message));
  await p5.goto(app);
  await p5.setInputFiles('#projFile', join(dir, 'rel.projeto.json'));
  await p5.waitForFunction(() => document.getElementById('note')?.textContent?.includes('Projeto aberto'));
  await p5.setInputFiles('#file', arquivos);
  await p5.waitForSelector('#preview:not([hidden]) h2');
  await p5.click('#preview button.primary');
  await p5.waitForFunction(() => document.querySelectorAll('#tableSel option').length === 3);
  const reg5 = await p5.evaluate(() => [...document.querySelectorAll('#kpis .kpi')].find((k) => k.querySelector('span')?.textContent === 'Registros')?.querySelector('b')?.textContent);
  assert.equal(reg5, '5', 'a relação foi refeita e a tabela relacionada está aberta');
  // abrir só um dos arquivos: a relação é descartada com o motivo
  await p5.close();
  const p6 = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  p6.on('pageerror', (e) => errors.push(e.message));
  await p6.goto(app);
  await p6.setInputFiles('#projFile', join(dir, 'rel.projeto.json'));
  await p6.waitForFunction(() => document.getElementById('note')?.textContent?.includes('Projeto aberto'));
  await p6.setInputFiles('#file', join(dir, 'vendas.csv'));
  await p6.waitForSelector('#preview:not([hidden]) h2');
  await p6.click('#preview button.primary');
  await p6.waitForSelector('#kpis .kpi');
  assert.ok((await p6.locator('#msg').innerText()).includes('descartada'), 'avisa que a relação foi descartada');
  await p6.close();
  ok('vários arquivos: análise antes de confirmar, cancelar não muda nada, projeto guarda a receita e refaz a relação');
}

// 17. Modo offline e HTML autônomo: nenhuma requisição externa em CSV, PDF, XLSX, relatório e HTML compartilhado; dado com </script> não executa
{
  const { fileURLToPath } = await import('node:url');
  const fx = (n) => fileURLToPath(new URL('../test/fixtures/' + n, import.meta.url));
  const NL = String.fromCharCode(10);
  const perigo = '</script><script>window.__x=1</script>';
  const linhas = ['nome;valor;uf'];
  for (let i = 0; i < 12; i++) linhas.push((i === 0 ? 'a' + perigo : 'n' + i) + ';' + (10 + i) + ';' + ['SP', 'RJ', 'MG'][i % 3]);
  writeFileSync(join(dir, 'offline.csv'), linhas.join(NL));
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const externas = [];
  await ctx.route(/^https?:/, (r) => {
    externas.push(r.request().url());
    return r.abort();
  });
  const nova = async () => {
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(app);
    return p;
  };
  // ponte do aplicativo de desktop: o Electron entrega o arquivo em base64
  const po = await nova();
  const b64 = readFileSync(join(dir, 'offline.csv')).toString('base64');
  await po.evaluate(([n, b]) => window.__abrirArquivo(n, b), ['offline.csv', b64]);
  await po.waitForSelector('#preview:not([hidden]) h2');
  await po.click('#preview button.primary');
  await po.waitForSelector('#kpis .kpi');
  assert.ok((await po.locator('#tbl').innerText()).includes('window.__x=1'), 'o dado aparece como texto na tabela');
  const [rep] = await Promise.all([po.waitForEvent('download', { timeout: 60000 }), po.click('#btnReport')]);
  assert.ok((await rep.suggestedFilename()).endsWith('.pdf'));
  const [xl2] = await Promise.all([po.waitForEvent('download'), po.click('#btnXlsx')]);
  assert.ok((await xl2.suggestedFilename()).endsWith('.xlsx'));
  const [cs] = await Promise.all([po.waitForEvent('download'), po.click('#btnCsv')]);
  assert.ok((await cs.suggestedFilename()).endsWith('.csv'));
  // HTML compartilhável: abre sozinho, sem rede, e o dado não vira script
  await po.click('#btnHtml');
  await po.fill('#shTitle', 'Offline');
  await po.fill('#shFile', 'offline');
  const [sh] = await Promise.all([po.waitForEvent('download'), po.click('#shGo')]);
  await sh.saveAs(join(dir, 'offline.html'));
  const ps = await ctx.newPage();
  ps.on('pageerror', (e) => errors.push(e.message));
  await ps.goto(pathToFileURL(join(dir, 'offline.html')).href);
  await ps.waitForSelector('#kpis .kpi');
  assert.equal(await ps.evaluate(() => window.__x), undefined, 'o dado com </script> não executou no HTML compartilhado');
  assert.ok((await ps.locator('#tbl').innerText()).includes('window.__x=1'));
  // PDF e Excel importados (leitor de PDF e de planilha também sem rede)
  for (const f of ['tabela-meses.pdf', 'planilha.xlsx']) {
    const pi = await nova();
    await pi.setInputFiles('#file', fx(f));
    await pi.waitForSelector('#preview:not([hidden]) h2', { timeout: 30000 });
    await pi.click('#preview button.primary');
    await pi.waitForSelector('#kpis .kpi, #charts .chart', { timeout: 30000 });
    await pi.close();
  }
  assert.deepEqual(externas, [], 'nenhuma requisição externa: ' + externas.join(', '));
  await ctx.close();
  ok('modo offline: CSV, PDF, XLSX, relatório e HTML compartilhável sem nenhuma requisição externa; dado com </script> não executa');
}

// 18. Busca e período no topo, painel lateral de filtros, reordenar gráficos, contraste alto, esqueleto de carregamento, Parquet e mapa de fluxos
{
  const NL = String.fromCharCode(10);
  const ufs = ['São Paulo', 'Rio', 'Minas', 'Bahia', 'Ceará'];
  const L = ['cidade;uf;valor;data'];
  for (let i = 0; i < 40; i++) L.push(`cidade ${i};${ufs[i % 5]};${10 + i * 3};${String((i % 9) + 1).padStart(2, '0')}/${String((i % 12) + 1).padStart(2, '0')}/${i < 24 ? 2023 : 2024}`);
  writeFileSync(join(dir, 'topo.csv'), L.join(NL));
  const pt = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  pt.on('pageerror', (e) => errors.push(e.message));
  await pt.goto(app);
  await pt.setInputFiles('#file', join(dir, 'topo.csv'));
  await pt.waitForSelector('#preview:not([hidden]) h2');
  await pt.click('#preview button.primary');
  await pt.waitForSelector('#charts .chart');
  const registros = () => pt.evaluate(() => [...document.querySelectorAll('#kpis .kpi')].find((k) => k.querySelector('span')?.textContent === 'Registros')?.querySelector('b')?.textContent);
  assert.equal(await registros(), '40');
  // busca do topo: sem acento e sem distinguir caixa; vale para o painel inteiro
  await pt.fill('#gSearch', 'sao paulo');
  await pt.waitForFunction(() => [...document.querySelectorAll('#kpis .kpi')].some((k) => k.querySelector('b')?.textContent === '8' && k.querySelector('span')?.textContent === 'Registros'));
  assert.ok((await pt.locator('#chips .chip').first().innerText()).includes('Busca: sao paulo'));
  assert.ok((await pt.locator('#tinfo').innerText()).includes('de 40'), 'a tabela também respeita a busca');
  await pt.locator('#chips .chip').first().click();
  await pt.waitForFunction(() => document.querySelectorAll('#chips .chip').length === 0);
  assert.equal(await registros(), '40');
  assert.equal(await pt.inputValue('#gSearch'), '', 'a caixa de busca acompanha o estado');
  // período rápido: este ano = o ano da data mais recente (2024 → 16 linhas)
  await pt.selectOption('#gPeriodo', 'ano');
  await pt.waitForFunction(() => [...document.querySelectorAll('#kpis .kpi')].some((k) => k.querySelector('b')?.textContent === '16' && k.querySelector('span')?.textContent === 'Registros'));
  await pt.selectOption('#gPeriodo', 'tudo');
  await pt.waitForFunction(() => document.querySelectorAll('#chips .chip').length === 0);
  // painel lateral de filtros
  await pt.click('#btnFiltros');
  await pt.waitForSelector('#painelFiltros:not([hidden])');
  assert.equal(await pt.evaluate(() => document.activeElement?.id), 'pfTitulo', 'o foco vai para o painel');
  await pt.selectOption('#pfColuna', 'uf');
  await pt.selectOption('#pfValor', 'Bahia');
  await pt.click('#pfAplicar');
  await pt.waitForFunction(() => document.querySelectorAll('#chips .chip').length === 1);
  assert.equal(await registros(), '8');
  assert.equal((await pt.locator('#btnFiltros').innerText()).trim(), 'Filtros (1)');
  assert.ok((await pt.locator('#pfCorpo').innerText()).includes('uf: Bahia'));
  await pt.click('#pfLimpar');
  await pt.waitForFunction(() => document.querySelectorAll('#chips .chip').length === 0);
  assert.equal(await registros(), '40');
  await pt.keyboard.press('Escape');
  await pt.waitForSelector('#painelFiltros', { state: 'hidden' });
  assert.equal(await pt.evaluate(() => document.activeElement?.id), 'btnFiltros', 'o foco volta ao botão');
  // reordenar os gráficos: botões (teclado) e arrastar
  const ordem = () => pt.evaluate(() => [...document.querySelectorAll('#charts > .chart[data-id]')].map((c) => c.dataset.id));
  const o0 = await ordem();
  assert.ok(o0.length >= 3, 'há gráficos para reordenar: ' + o0.length);
  await pt.locator('#charts > .chart[data-id]').first().locator('button.mover', { hasText: '↓' }).click();
  await pt.waitForFunction((p) => document.querySelector('#charts > .chart[data-id]')?.dataset.id === p, o0[1]);
  const o1 = await ordem();
  assert.deepEqual(o1.slice(0, 2), [o0[1], o0[0]], 'o primeiro desceu uma posição');
  await pt.locator('#charts > .chart[data-id]').first().scrollIntoViewIfNeeded();
  const alca = pt.locator('#charts > .chart[data-id]').nth(1).locator('.alca');
  await alca.dragTo(pt.locator('#charts > .chart[data-id]').first(), { targetPosition: { x: 40, y: 5 } });
  await pt.waitForFunction((id) => document.querySelector('#charts > .chart[data-id]')?.dataset.id === id, o1[1]);
  const o2 = await ordem();
  assert.equal(o2[0], o1[1], 'o segundo foi arrastado para o início (voltou à ordem original)');
  assert.deepEqual(o2.slice(0, 2), [o0[0], o0[1]]);
  // a ordem e a busca vão no projeto salvo
  await pt.fill('#gSearch', 'rio');
  await pt.waitForFunction(() => document.querySelectorAll('#chips .chip').length === 1);
  const [pj3] = await Promise.all([pt.waitForEvent('download'), pt.click('#btnSaveProj')]);
  await pj3.saveAs(join(dir, 'topo.projeto.json'));
  const saved = JSON.parse(readFileSync(join(dir, 'topo.projeto.json'), 'utf8'));
  assert.equal(saved.estado.search, 'rio');
  assert.deepEqual(saved.estado.chartOrder.slice(0, 3), (await ordem()).slice(0, 3));
  // contraste alto
  await pt.selectOption('#themeSel', 'contrast');
  const cores = await pt.evaluate(() => ({ tema: document.documentElement.dataset.theme, fundo: getComputedStyle(document.body).backgroundColor, texto: getComputedStyle(document.querySelector('h2') ?? document.body).color }));
  assert.equal(cores.tema, 'contrast');
  assert.equal(cores.fundo, 'rgb(0, 0, 0)');
  assert.equal(cores.texto, 'rgb(255, 255, 255)');
  await pt.close();

  // esqueleto de carregamento aparece enquanto um arquivo grande é lido
  const pe = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  pe.on('pageerror', (e) => errors.push(e.message));
  await pe.goto(app);
  // a leitura bloqueia a página por um tempo: um observador registra se o esqueleto chegou a aparecer
  await pe.evaluate(() => {
    window.__sk = '';
    new MutationObserver(() => {
      const b = document.getElementById('carregando');
      if (b && !b.hidden && b.querySelector('.sk')) window.__sk = b.textContent;
    }).observe(document.body, { subtree: true, attributes: true, childList: true });
  });
  await pe.setInputFiles('#file', join(dir, 'grande.csv'));
  await pe.waitForSelector('#preview:not([hidden]) h2', { timeout: 60000 });
  assert.ok((await pe.evaluate(() => window.__sk)).includes('Lendo o arquivo'), 'o esqueleto apareceu durante a leitura');
  assert.equal(await pe.locator('#carregando').isHidden(), true, 'o esqueleto some quando a prévia aparece');
  await pe.close();

  // Parquet pelo seletor de arquivo
  const { parquetWriteBuffer } = await import('hyparquet-writer');
  const pq = Buffer.from(new Uint8Array(parquetWriteBuffer({ columnData: [{ name: 'uf', data: ['SP', 'RJ', 'MG', 'SP', 'RJ', 'MG', 'SP', 'RJ', 'MG', 'SP', 'RJ', 'MG'], type: 'STRING' }, { name: 'valor', data: [10.5, 20, null, 5, 7, 9, 1, 2, 3, 4, 5, 6], type: 'DOUBLE' }] })));
  writeFileSync(join(dir, 'dados.parquet'), pq);
  const pp3 = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  pp3.on('pageerror', (e) => errors.push(e.message));
  await pp3.goto(app);
  await pp3.setInputFiles('#file', join(dir, 'dados.parquet'));
  await pp3.waitForSelector('#preview:not([hidden]) h2');
  assert.ok((await pp3.locator('#preview').innerText()).includes('.parquet'), 'a prévia mostra o formato Parquet');
  await pp3.click('#preview button.primary');
  await pp3.waitForSelector('#kpis .kpi');
  const reg3 = await pp3.evaluate(() => [...document.querySelectorAll('#kpis .kpi')].find((k) => k.querySelector('span')?.textContent === 'Registros')?.querySelector('b')?.textContent);
  assert.equal(reg3, '12');
  await pp3.close();

  // mapa de fluxos: um par origem/destino por registro
  writeFileSync(join(dir, 'fluxos.csv'), ['origem;destino;lat_origem;lon_origem;lat_destino;lon_destino;peso', 'Fortaleza;Sobral;-3.73;-38.52;-3.69;-40.35;1200', 'Fortaleza;Crato;-3.73;-38.52;-7.23;-39.41;800', 'Sobral;Crato;-3.69;-40.35;-7.23;-39.41;500', 'Fortaleza;Sobral;-3.73;-38.52;-3.69;-40.35;300', 'Crato;Fortaleza;-7.23;-39.41;-3.73;-38.52;700'].join(NL));
  const pf = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  pf.on('pageerror', (e) => errors.push(e.message));
  await pf.goto(app);
  await pf.setInputFiles('#file', join(dir, 'fluxos.csv'));
  await pf.waitForSelector('#preview:not([hidden]) h2');
  await pf.click('#preview button.primary');
  await pf.waitForSelector('#charts .map path.leaflet-interactive', { timeout: 20000 });
  assert.equal(await pf.locator('#charts .map path.leaflet-interactive').count(), 5, 'uma linha por registro');
  assert.ok((await pf.locator('#charts p[role=status]').first().innerText()).includes('5 de 5'));
  await pf.close();
  ok('busca e período no topo, painel de filtros, reordenar (botões e arrastar) e salvar, contraste alto, esqueleto, Parquet e mapa de fluxos');
}

assert.deepEqual(errors, [], 'sem erros de página: ' + errors.join(' | '));
await browser.close();
console.log(log.join('\n'));

// Teste de ponta a ponta no navegador (Chromium). Uso: npm run build && npm run test:e2e
// Variáveis: CHROME_PATH (padrão /opt/pw-browsers/chromium), PLAYWRIGHT_MODULE (padrão ../../node_modules/playwright-core/index.mjs)
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const pw = await import(process.env.PLAYWRIGHT_MODULE ?? new URL('../../node_modules/playwright-core/index.mjs', import.meta.url).href);
const dir = mkdtempSync(join(tmpdir(), 'universal-e2e-'));
const app = pathToFileURL(new URL('../dist/index.html', import.meta.url).pathname).href;
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

assert.deepEqual(errors, [], 'sem erros de página: ' + errors.join(' | '));
await browser.close();
console.log(log.join('\n'));

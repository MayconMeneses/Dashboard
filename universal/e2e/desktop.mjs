// Teste do aplicativo de desktop (Electron) já empacotado, SEM instalar nada no Windows.
// Uso (depois de `npm run build` e `npm run dist:win` em desktop/): node e2e/desktop.mjs
// Abre release/win-unpacked/Dashboard Universal.exe com pasta de dados temporária e a consulta de atualização desligada,
// conecta pelo protocolo de depuração do Chrome (CDP), entrega um arquivo pela ponte do Electron e confere o resultado.
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const pw = await import(process.env.PLAYWRIGHT_MODULE ?? new URL('../../node_modules/playwright-core/index.mjs', import.meta.url).href);
const aqui = fileURLToPath(new URL('.', import.meta.url));
const exe = join(aqui, '..', 'desktop', 'release', 'win-unpacked', 'Dashboard Universal.exe');
if (!existsSync(exe)) throw new Error('Rode "npm run dist:win" em universal/desktop antes (gera release/win-unpacked).');
const log = [];
const ok = (m) => log.push('✓ ' + m);

// 1. o painel empacotado é o painel recém-compilado (mesmo SHA-256)
const requireDesk = createRequire(join(aqui, '..', 'desktop', 'package.json'));
const asar = requireDesk('@electron/asar');
const noPacote = asar.extractFile(join(aqui, '..', 'desktop', 'release', 'win-unpacked', 'resources', 'app.asar'), 'app/index.html');
const sha = (b) => createHash('sha256').update(b).digest('hex');
assert.equal(sha(noPacote), sha(readFileSync(join(aqui, '..', 'dist', 'index.html'))), 'o painel dentro do pacote é o de dist/index.html');
ok('o painel dentro do aplicativo empacotado é idêntico ao compilado (SHA-256)');

// 2. abre o aplicativo isolado: dados em pasta temporária, sem consulta de atualização
const dados = mkdtempSync(join(tmpdir(), 'universal-desktop-'));
writeFileSync(join(dados, 'config.json'), JSON.stringify({ autoUpdate: false }));
const porta = 9333;
const proc = spawn(exe, [`--user-data-dir=${dados}`, `--remote-debugging-port=${porta}`], { stdio: 'ignore' });
let browser;
try {
  for (let i = 0; i < 60 && !browser; i++) {
    try {
      browser = await pw.chromium.connectOverCDP(`http://127.0.0.1:${porta}`);
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  assert.ok(browser, 'conectou ao aplicativo');
  const ctx = browser.contexts()[0];
  let page = ctx.pages()[0];
  for (let i = 0; i < 40 && !page; i++) {
    await new Promise((r) => setTimeout(r, 250));
    page = ctx.pages()[0];
  }
  const externas = [];
  page.on('request', (r) => {
    if (/^https?:/.test(r.url())) externas.push(r.url());
  });
  await page.waitForSelector('#drop', { timeout: 20000 });
  assert.match(await page.title(), /Dashboard/);
  assert.match(await page.evaluate(() => navigator.userAgent), /Electron\/44/);
  assert.equal(await page.evaluate(() => typeof window.__abrirArquivo), 'function', 'a ponte do Electron existe');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark', 'tema escuro por padrão');
  ok('aplicativo Electron 44 abre o painel, com tema escuro e a ponte de arquivos');

  // 3. entrega um arquivo como o menu “Abrir arquivo” faz e gera o painel
  const NL = String.fromCharCode(10);
  const csv = ['uf;valor', ...Array.from({ length: 12 }, (_, i) => `${['SP', 'RJ', 'MG'][i % 3]};${10 + i}`)].join(NL);
  await page.evaluate(([n, b]) => window.__abrirArquivo(n, b), ['desktop.csv', Buffer.from(csv).toString('base64')]);
  await page.waitForSelector('#preview:not([hidden]) h2', { timeout: 20000 });
  await page.click('#preview button.primary');
  await page.waitForSelector('#kpis .kpi', { timeout: 20000 });
  const reg = await page.evaluate(() => [...document.querySelectorAll('#kpis .kpi')].find((k) => k.querySelector('span')?.textContent === 'Registros')?.querySelector('b')?.textContent);
  assert.equal(reg, '12');
  assert.ok((await page.locator('#charts .chart').count()) > 0, 'gráficos gerados');
  ok('arquivo entregue pela ponte vira painel (12 registros, gráficos)');

  // 4. nenhuma requisição externa durante o uso
  await page.waitForTimeout(1500);
  assert.deepEqual(externas, [], 'nenhuma requisição externa: ' + externas.join(', '));
  ok('nenhuma requisição externa durante o uso (consulta de atualização desligada pela configuração)');
} finally {
  try {
    await browser?.close();
  } catch {
    /* já fechado */
  }
  try {
    execFileSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
  } catch {
    proc.kill();
  }
}
console.log(log.join('\n'));

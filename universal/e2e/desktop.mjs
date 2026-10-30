// Teste do aplicativo de desktop (Electron) já empacotado, SEM instalar nada no Windows.
// Uso (depois de `npm run build` e `npm run dist:win` — ou `npx electron-builder --win dir --x64` — em desktop/): node e2e/desktop.mjs
// Abre release/win-unpacked/Dashboard Universal.exe com pasta de dados temporária, conecta pelo protocolo de depuração do Chrome (CDP)
// e confere: painel empacotado, ponte de arquivos, nenhuma requisição externa e a atualização ao abrir (servidor local, resposta por variável de ambiente).
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
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
const sha = (b) => createHash('sha256').update(b).digest('hex');
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const NL = String.fromCharCode(10);

// 1. o painel empacotado é o painel recém-compilado (mesmo SHA-256) e o módulo de atualização foi para dentro do pacote
const requireDesk = createRequire(join(aqui, '..', 'desktop', 'package.json'));
const asar = requireDesk('@electron/asar');
const pacote = join(aqui, '..', 'desktop', 'release', 'win-unpacked', 'resources', 'app.asar');
const dist = readFileSync(join(aqui, '..', 'dist', 'index.html'));
assert.equal(sha(asar.extractFile(pacote, 'app/index.html')), sha(dist), 'o painel dentro do pacote é o de dist/index.html');
const arquivosNoPacote = asar.listPackage(pacote).map((p) => p.replace(/^[\\/]/, '').replace(/\\/g, '/'));
assert.ok(arquivosNoPacote.includes('atualizacao.cjs'), 'atualizacao.cjs está dentro do pacote: ' + arquivosNoPacote.join(', '));
ok('o painel dentro do aplicativo empacotado é idêntico ao compilado (SHA-256) e o módulo de atualização está no pacote');

// 2. ferramentas: servidor de atualização local e abertura do aplicativo isolado
let proxima = 9333;
async function servidor(manifesto, html) {
  const pedidos = [];
  const srv = createServer((req, res) => {
    pedidos.push(req.url);
    if (req.url === '/versao.json') res.end(JSON.stringify(manifesto));
    else if (req.url === '/index.html') res.end(html);
    else {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${srv.address().port}`, pedidos, fechar: () => new Promise((r) => srv.close(r)) };
}
async function abrir({ dados = mkdtempSync(join(tmpdir(), 'universal-desktop-')), cfg, env = {}, args = [] } = {}) {
  if (cfg) writeFileSync(join(dados, 'config.json'), JSON.stringify(cfg));
  const porta = proxima++;
  const proc = spawn(exe, [...args, `--user-data-dir=${dados}`, `--remote-debugging-port=${porta}`], { stdio: 'ignore', env: { ...process.env, ...env } });
  let browser;
  for (let i = 0; i < 80 && !browser; i++) {
    try {
      browser = await pw.chromium.connectOverCDP(`http://127.0.0.1:${porta}`);
    } catch {
      await dormir(500);
    }
  }
  assert.ok(browser, 'conectou ao aplicativo');
  let page = browser.contexts()[0].pages()[0];
  for (let i = 0; i < 40 && !page; i++) {
    await dormir(250);
    page = browser.contexts()[0].pages()[0];
  }
  await page.waitForSelector('#drop', { state: 'attached', timeout: 20000 });
  const fechar = async () => {
    try {
      await browser.close();
    } catch {
      /* já fechado */
    }
    try {
      execFileSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      proc.kill();
    }
  };
  return { dados, page, fechar };
}
// painel “novo” de mentira: o compilado com uma marca no <head> (o título continua começando com “Dashboard”)
const marca = '<meta name="teste-atualizacao" content="0.9.1">';
const htmlTexto = dist.toString('utf8');
assert.equal(htmlTexto.split('</head>').length, 2, 'o painel tem um único </head>');
const htmlNovo = Buffer.from(htmlTexto.replace('</head>', marca + '</head>'), 'utf8');
const manifestoBom = { versao: '0.9.1', sha256: sha(htmlNovo), programaMinimo: '0.2.0' };
const csv = ['uf;valor', ...Array.from({ length: 12 }, (_, i) => `${['SP', 'RJ', 'MG'][i % 3]};${10 + i}`)].join(NL);
const arquivoCsv = join(mkdtempSync(join(tmpdir(), 'universal-desktop-dados-')), 'desktop.csv');
writeFileSync(arquivoCsv, csv);
const temMarca = (page) => page.evaluate(() => !!document.querySelector('meta[name="teste-atualizacao"]'));

// 3. uso normal, com a consulta de atualização desligada: ponte de arquivos, tema, zero requisição externa
{
  const app = await abrir({ cfg: { autoUpdate: false } });
  try {
    const externas = [];
    app.page.on('request', (r) => {
      if (/^https?:/.test(r.url())) externas.push(r.url());
    });
    assert.match(await app.page.title(), /Dashboard/);
    assert.match(await app.page.evaluate(() => navigator.userAgent), /Electron\/44/);
    assert.equal(await app.page.evaluate(() => typeof window.__abrirArquivo), 'function', 'a ponte do Electron existe');
    assert.equal(await app.page.evaluate(() => document.documentElement.dataset.theme), 'dark', 'tema escuro por padrão');
    await app.page.evaluate(([n, b]) => window.__abrirArquivo(n, b), ['desktop.csv', Buffer.from(csv).toString('base64')]);
    await app.page.waitForSelector('#preview:not([hidden]) h2', { timeout: 20000 });
    await app.page.click('#preview button.primary');
    await app.page.waitForSelector('#kpis .kpi', { timeout: 20000 });
    const reg = await app.page.evaluate(() => [...document.querySelectorAll('#kpis .kpi')].find((k) => k.querySelector('span')?.textContent === 'Registros')?.querySelector('b')?.textContent);
    assert.equal(reg, '12');
    assert.ok((await app.page.locator('#charts .chart').count()) > 0, 'gráficos gerados');
    await app.page.waitForTimeout(1500);
    assert.deepEqual(externas, [], 'nenhuma requisição externa: ' + externas.join(', '));
    ok('Electron 44 abre o painel (tema escuro), arquivo entregue pela ponte vira painel (12 registros) e não há requisição externa');
  } finally {
    await app.fechar();
  }
}

// 4. atualização desligada nas preferências: não consulta o servidor nem pergunta
{
  const srv = await servidor(manifestoBom, htmlNovo);
  const app = await abrir({ cfg: { autoUpdate: false }, env: { UNIVERSAL_UPDATE_URL: srv.url, UNIVERSAL_TEST_ANSWER: 'sim' } });
  try {
    await app.page.waitForTimeout(3000);
    assert.deepEqual(srv.pedidos, [], 'nenhuma consulta ao servidor de atualização');
    assert.equal(await temMarca(app.page), false);
    ok('com “verificar ao abrir” desligado o aplicativo não consulta nada');
  } finally {
    await app.fechar();
    await srv.fechar();
  }
}

// 5. atualização ao abrir, usuário aceita: baixa, confere, grava, recarrega e entrega de novo o arquivo que estava aberto
let dadosAtualizados;
{
  const srv = await servidor(manifestoBom, htmlNovo);
  const app = await abrir({ args: [arquivoCsv], env: { UNIVERSAL_UPDATE_URL: srv.url, UNIVERSAL_TEST_ANSWER: 'sim' } });
  try {
    await app.page.waitForSelector('meta[name="teste-atualizacao"]', { state: 'attached', timeout: 30000 });
    await app.page.waitForSelector('#preview:not([hidden]) h2', { timeout: 20000 });
    assert.ok((await app.page.locator('#preview').innerText()).includes('desktop.csv'), 'o arquivo aberto foi entregue de novo ao painel novo');
    assert.deepEqual([...new Set(srv.pedidos)].sort(), ['/index.html', '/versao.json']);
    assert.equal(readFileSync(join(app.dados, 'painel', 'versao.txt'), 'utf8'), '0.9.1');
    assert.equal(sha(readFileSync(join(app.dados, 'painel', 'index.html'))), manifestoBom.sha256, 'o painel gravado é o servido');
    dadosAtualizados = app.dados;
    ok('atualização ao abrir: pergunta, baixa, confere o SHA-256, grava, recarrega e reabre o arquivo que estava aberto');
  } finally {
    await app.fechar();
    await srv.fechar();
  }
}

// 6. na abertura seguinte o painel baixado é o que abre, e como já é a versão do servidor não baixa nem pergunta de novo
{
  const srv = await servidor(manifestoBom, htmlNovo);
  const app = await abrir({ dados: dadosAtualizados, env: { UNIVERSAL_UPDATE_URL: srv.url, UNIVERSAL_TEST_ANSWER: 'sim' } });
  try {
    await app.page.waitForTimeout(3000);
    assert.equal(await temMarca(app.page), true, 'abre direto o painel atualizado');
    assert.deepEqual(srv.pedidos, ['/versao.json'], 'só consulta o manifesto, não baixa de novo');
    ok('a atualização persiste: reabrir usa o painel novo e não baixa de novo');
  } finally {
    await app.fechar();
    await srv.fechar();
  }
}

// 7. “Depois”: nada é baixado nem guardado, e o painel antigo continua
{
  const srv = await servidor(manifestoBom, htmlNovo);
  const app = await abrir({ env: { UNIVERSAL_UPDATE_URL: srv.url, UNIVERSAL_TEST_ANSWER: 'depois' } });
  try {
    await app.page.waitForTimeout(3000);
    assert.deepEqual(srv.pedidos, ['/versao.json'], 'só o manifesto foi pedido');
    assert.equal(existsSync(join(app.dados, 'painel')), false, 'nada gravado');
    assert.equal(await temMarca(app.page), false);
    ok('“Depois” não baixa nem grava nada (a pergunta volta na próxima abertura)');
  } finally {
    await app.fechar();
    await srv.fechar();
  }
}

// 8. arquivo adulterado (SHA-256 diferente do manifesto): recusado, painel antigo continua
{
  const srv = await servidor({ ...manifestoBom, sha256: sha('outro conteudo') }, htmlNovo);
  const app = await abrir({ env: { UNIVERSAL_UPDATE_URL: srv.url, UNIVERSAL_TEST_ANSWER: 'sim' } });
  try {
    await app.page.waitForTimeout(3000);
    assert.ok(srv.pedidos.includes('/index.html'), 'tentou baixar');
    assert.equal(existsSync(join(app.dados, 'painel', 'versao.txt')), false, 'nada gravado');
    assert.equal(await temMarca(app.page), false);
    ok('painel adulterado (SHA-256 diferente) é recusado e o painel atual continua');
  } finally {
    await app.fechar();
    await srv.fechar();
  }
}
console.log(log.join(NL));

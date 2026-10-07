// Gera o relatório em PDF a partir do HTML do painel, usando o Chrome ou o Edge instalados no computador.
// Uso: npm run gerar-pdf -- painel.html [saida.pdf]
// Opcional: CHROME_PATH="C:\caminho\chrome.exe" para escolher o navegador.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const base = process.env.INIT_CWD ?? process.cwd();
const [input, output = 'relatorio-triatomineos.pdf'] = process.argv.slice(2);
if (!input) {
  console.error('Uso: npm run gerar-pdf -- painel.html [saida.pdf]');
  process.exit(1);
}
const htmlPath = resolve(base, input);
if (!existsSync(htmlPath)) {
  console.error(`Arquivo não encontrado: ${htmlPath}`);
  process.exit(1);
}

async function abrir() {
  const tentativas = [];
  if (process.env.CHROME_PATH) tentativas.push({ executablePath: process.env.CHROME_PATH });
  tentativas.push({ channel: 'chrome' }, { channel: 'msedge' });
  for (const t of tentativas) {
    try {
      return await chromium.launch({ headless: true, args: ['--no-sandbox'], ...t });
    } catch {
      /* tenta o próximo */
    }
  }
  throw new Error('Não encontrei o Google Chrome nem o Microsoft Edge. Instale um deles ou defina CHROME_PATH com o caminho do executável.');
}

const browser = await abrir();
try {
  const page = await (await browser.newContext({ viewport: { width: 780, height: 1100 } })).newPage();
  await page.goto(pathToFileURL(htmlPath).href);
  await page.waitForSelector('canvas', { timeout: 30000 });
  await page.getByRole('button', { name: 'Relatório / PDF' }).click();
  await page.waitForSelector('.report-records table tbody tr', { timeout: 30000 });
  // espera os mapas-base carregarem (se houver internet); segue mesmo se não carregarem
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => undefined);
  await page.waitForTimeout(2500);
  await page.emulateMedia({ media: 'print' });
  await page.evaluate(() => window.__prepararImpressao && window.__prepararImpressao());
  await page.waitForTimeout(2000);
  const out = resolve(base, output);
  await page.pdf({ path: out, format: 'A4', landscape: false, printBackground: true, margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' } });
  console.log(`PDF gerado: ${out}`);
} finally {
  await browser.close();
}

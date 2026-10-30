// Capturas de tela do painel (dados sintéticos) para os relatórios. Uso: npm run build && node e2e/capturas.mjs <pasta-de-saida>
// Variáveis: CHROME_PATH, PLAYWRIGHT_MODULE (como em e2e.mjs).
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const pw = await import(process.env.PLAYWRIGHT_MODULE ?? new URL('../../node_modules/playwright-core/index.mjs', import.meta.url).href);
const out = process.argv[2] ?? 'capturas';
mkdirSync(out, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'universal-cap-'));
const bairros = ['Centro', 'Norte', 'Sul', 'Leste', 'Oeste'];
let csv = 'bairro;status;valor;data;latitude;longitude\n';
for (let i = 0; i < 60; i++) csv += `${bairros[i % 5]};${i % 3 ? 'ok' : 'falha'};${(i * 37) % 91 + 5};${String((i % 28) + 1).padStart(2, '0')}/${String((i % 6) + 1).padStart(2, '0')}/2024;-4.${40 + (i % 9)};-40.${90 + (i % 7)}\n`;
writeFileSync(join(dir, 'amostra.csv'), csv);

const browser = await pw.chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const app = new URL('../dist/index.html', import.meta.url).href;

async function abrir(page, tema) {
  await page.goto(app);
  await page.selectOption('#themeSel', tema);
  await page.setInputFiles('#file', join(dir, 'amostra.csv'));
  await page.waitForSelector('#preview:not([hidden]) h2');
  await page.click('#preview button.primary');
  await page.waitForSelector('#kpis .kpi');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(3000);
}

for (const tema of ['dark', 'light']) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await abrir(page, tema);
  await page.screenshot({ path: join(out, `desktop-${tema}.png`) });
  if (tema === 'dark') {
    await page.click('#navToggle');
    await page.screenshot({ path: join(out, 'desktop-dark-menu-recolhido.png') });
  }
  await page.close();
}
const mobile = await browser.newPage({ viewport: { width: 375, height: 812 } });
await abrir(mobile, 'dark');
const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
await mobile.screenshot({ path: join(out, 'mobile-dark.png') });
console.log('rolagem horizontal no celular (px):', overflow);
await browser.close();

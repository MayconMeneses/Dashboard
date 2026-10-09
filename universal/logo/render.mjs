import { readFileSync, writeFileSync } from 'node:fs';
const pw = await import('/home/user/Dashboard/node_modules/playwright-core/index.mjs');
const svg = readFileSync('logo.svg', 'utf8');
const b = await pw.chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
for (const s of [1024, 512, 256, 64, 32]) {
  const p = await b.newPage({ viewport: { width: s, height: s } });
  await p.setContent(`<body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${s}" height="${s}" `)}</body>`);
  writeFileSync(`logo-${s}.png`, await p.screenshot({ omitBackground: true }));
  await p.close();
}
await b.close();

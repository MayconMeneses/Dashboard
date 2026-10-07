import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { buildSnapshot } from '../snapshot.js';

// Uso: npm run gerar-html -- <arquivo.kml|kmz> [saida.html] [--manter-duplicatas|--excluir-duplicatas]
const base = process.env.INIT_CWD ?? process.cwd();
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith('--') && !a.startsWith('--nome=')));
const nome = process.argv.slice(2).find((a) => a.startsWith('--nome='))?.slice(7);
const [input, output = 'painel-triatomineos-croata.html'] = args;
if (!input) {
  console.error('Uso: npm run gerar-html -- <arquivo.kml|kmz> [saida.html] [--nome="Nome exibido.kml"] [--manter-duplicatas|--excluir-duplicatas]');
  process.exit(1);
}
const template = resolve(import.meta.dirname, '../../../web/dist-static/index.html');
if (!existsSync(template)) {
  console.error('Modelo não encontrado. Rode antes: npm run build:static');
  process.exit(1);
}
const boundaryFile = resolve(import.meta.dirname, '../../../boundary/croata-ibge.geojson');
const boundary = existsSync(boundaryFile)
  ? {
      geojson: JSON.parse(readFileSync(boundaryFile, 'utf8')),
      source: 'IBGE – Mapa Municipal de Croatá-CE (2304236), Malha Territorial ed. 04/2021; contorno vetorizado do PDF (precisão aproximada)',
    }
  : null;

const inPath = resolve(base, input);
const snap = buildSnapshot(readFileSync(inPath), nome ?? basename(inPath), {
  boundary,
  excludeRepeats: flags.has('--excluir-duplicatas') ? true : flags.has('--manter-duplicatas') ? false : undefined,
});
const json = JSON.stringify(snap).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
let html = readFileSync(template, 'utf8');
const re = /<script id="snapshot" type="application\/json">[\s\S]*?<\/script>/;
if (!re.test(html)) {
  console.error('Marcador do modelo não encontrado.');
  process.exit(1);
}
html = html.replace(re, () => `<script id="snapshot" type="application/json">${json}</script>`);
const outPath = resolve(base, output);
writeFileSync(outPath, html);
console.log(`Gerado: ${outPath} (${(html.length / 1048576).toFixed(2)} MB). Registros: ${snap.rec.length}; duplicatas excluídas: ${snap.sobre.duplicatasExcluidas}.`);

// Publica a versão atual do painel para a atualização automática (universal/atualizacao/).
// Uso: npm run build (em universal/) e depois "npm run publicar" aqui; faça commit e push dos arquivos gerados.
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', 'dist', 'index.html');
if (!existsSync(src)) throw new Error('Rode "npm run build" em universal/ antes.');
const versao = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')).version;
const programa = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'));
const out = join(here, '..', 'atualizacao');
mkdirSync(out, { recursive: true });
cpSync(src, join(out, 'index.html'));
const sha256 = createHash('sha256').update(readFileSync(src)).digest('hex');
writeFileSync(join(out, 'versao.json'), JSON.stringify({ versao, sha256, programaMinimo: programa.programaMinimo ?? '0.2.0', publicadoEm: new Date().toISOString() }, null, 2) + '\n');
console.log(`Publicado painel ${versao} (${sha256.slice(0, 12)}…) em universal/atualizacao/`);

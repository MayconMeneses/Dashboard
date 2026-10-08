// copia o painel já compilado (universal/dist/index.html) para a pasta do aplicativo
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', 'dist', 'index.html');
if (!existsSync(src)) throw new Error('Rode "npm run build" em universal/ antes (gera dist/index.html).');
rmSync(join(here, 'app'), { recursive: true, force: true });
mkdirSync(join(here, 'app'), { recursive: true });
cpSync(src, join(here, 'app', 'index.html'));
console.log('Painel copiado para desktop/app/index.html');

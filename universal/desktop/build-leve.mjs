// gera o instalador leve (NSIS) usando o makensis que o electron-builder já baixou
import { cpSync, existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
cpSync(join(here, 'app', 'index.html'), join(here, 'leve', 'index.html'));
if (!existsSync(join(here, 'leve', 'icon.ico'))) throw new Error('Falta leve/icon.ico');
const cache = process.platform === 'win32' ? join(process.env.LOCALAPPDATA ?? '', 'electron-builder', 'Cache') : join(homedir(), '.cache', 'electron-builder');
const base = join(cache, 'nsis-3.0.4.1');
const dir = readdirSync(base).map((d) => join(base, d)).find((d) => existsSync(join(d, 'Include', 'MUI2.nsh')));
if (!dir) throw new Error('NSIS não encontrado no cache do electron-builder; rode "npm run dist:win" uma vez antes.');
const exe = process.platform === 'win32' ? join(dir, 'makensis.exe') : join(dir, 'linux', 'makensis');
const r = spawnSync(exe, ['-V2', 'instalador.nsi'], { cwd: join(here, 'leve'), stdio: 'inherit', env: { ...process.env, NSISDIR: dir, NSISCONFDIR: dir } });
process.exit(r.status ?? 1);

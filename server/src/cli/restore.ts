import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { restoreBackup } from '../backup.js';
import { loadConfig } from '../config.js';

// Uso (com o servidor PARADO): npm run restore -- <backup.zip>
const input = process.argv[2];
if (!input) {
  console.error('Uso: npm run restore -- <backup.zip>   (pare o servidor antes)');
  process.exit(1);
}
try {
  const base = process.env.INIT_CWD ?? process.cwd();
  const r = restoreBackup(new Uint8Array(readFileSync(resolve(base, input))), loadConfig());
  console.log(`Backup restaurado. Arquivos originais: ${r.restoredUploads}.${r.previousDb ? ` O banco anterior foi guardado em: ${r.previousDb}` : ''}`);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}

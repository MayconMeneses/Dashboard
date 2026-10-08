import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

const version = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version;

export default defineConfig({ plugins: [viteSingleFile()], define: { __APP_VERSION__: JSON.stringify(version) }, build: { chunkSizeWarningLimit: 4000 } });

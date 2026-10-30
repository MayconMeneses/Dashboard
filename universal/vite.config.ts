/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

const version = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version;

export default defineConfig({
  plugins: [viteSingleFile()], define: { __APP_VERSION__: JSON.stringify(version) }, build: { chunkSizeWarningLimit: 4000 },
  // leitura de PDF e arquivos compactados grandes demoram mais quando os testes rodam em paralelo; o limite padrão (5 s) dava falso negativo por tempo
  test: { testTimeout: 30000 },
});

/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig(({ mode }) => ({
  // mode "static": painel compartilhável em um único arquivo HTML (JS, CSS e dados embutidos)
  plugins: [react(), ...(mode === 'static' ? [viteSingleFile()] : [])],
  build: mode === 'static' ? { outDir: 'dist-static', assetsInlineLimit: 100_000_000 } : undefined,
  server: { proxy: { '/api': 'http://127.0.0.1:3000' } },
  test: { environment: 'jsdom', globals: true },
}));

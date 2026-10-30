import { defineConfig } from 'vitest/config';

// Medições de desempenho: fora do `npm test` (que só pega *.test.ts / *.spec.ts). Uso: npm run bench
export default defineConfig({ test: { include: ['bench/**/*.bench.ts'], testTimeout: 300000 } });

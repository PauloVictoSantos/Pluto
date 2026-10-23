import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'finance-engine', root: 'packages/finance-engine', environment: 'node' } },
      { test: { name: 'shared', root: 'packages/shared', environment: 'node' } },
      {
        test: { name: 'api', root: 'apps/api', include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'], environment: 'node', testTimeout: 20_000 },
      },
      { test: { name: 'web', root: 'apps/web', include: ['lib/**/*.test.ts'], environment: 'node' } },
      // App: so o que nao depende do React Native (cliente da API, formatacao).
      { test: { name: 'mobile', root: 'apps/mobile', include: ['src/api/**/*.test.ts', 'src/lib/**/*.test.ts'], environment: 'node' } },
    ],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**', 'apps/api/src/**'],
      exclude: ['**/*.test.ts', '**/index.ts'],
      // Secao 9.1: motor financeiro com cobertura minima de 90%.
      thresholds: {
        'packages/finance-engine/src/**': { lines: 90, functions: 90, branches: 90, statements: 90 },
      },
    },
  },
});

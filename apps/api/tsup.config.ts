import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  sourcemap: true,
  clean: true,
  // Pacotes do monorepo sao TS puro: embutir no bundle.
  noExternal: [/^@pluto\//],
});

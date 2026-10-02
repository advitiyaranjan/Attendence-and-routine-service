import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  outDir: 'dist',
  clean: true,
  // The shared core package ships TypeScript source, so bundle it in.
  noExternal: ['@student-os/core'],
});

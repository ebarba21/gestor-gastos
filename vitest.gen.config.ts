/// <reference types="vitest/config" />
// Configuracion SOLO para los generadores de datos de scripts/*.gen.ts (no forman parte de la
// suite de tests normal: `npm test` no los ejecuta). Ver scripts/excelABackup.gen.ts.
import { defineConfig } from 'vite';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['scripts/**/*.gen.ts'],
    testTimeout: 600_000,
  },
});

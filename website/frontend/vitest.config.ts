import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    include: [
      'tests/components/**/*.test.ts',
      'tests/stores/**/*.test.ts',
      'tests/pages/**/*.test.ts',
    ],
    // Note: tests/constraints/*.test.ts use Node.js native testing (node:test, node:assert)
    // and should be run with 'npm run test' instead of vitest
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/components/**/*.ts', 'src/stores/**/*.ts', 'src/pages/**/*.ts'],
    },
    setupFiles: ['tests/setup.ts'],
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
});

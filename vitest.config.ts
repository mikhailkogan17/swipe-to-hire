import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['packages/agent/**/*.ts', 'packages/bot/**/*.ts'],
      exclude: ['**/dist/**', '**/node_modules/**', '**/tests/**'],
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['packages/*/tests/unit/**/*.test.ts'],
          exclude: ['packages/*/tests/integration/**'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['packages/*/tests/integration/**/*.test.ts'],
          exclude: ['packages/*/tests/unit/**'],
          testTimeout: 120_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});

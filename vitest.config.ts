import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.ts', 'src/**/*.test.ts'],
    setupFiles: ['tests/unit/setup.ts'],
    globals: false,
  },
});

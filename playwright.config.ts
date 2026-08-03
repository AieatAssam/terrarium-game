import { defineConfig, devices } from '@playwright/test';

// Two projects, per docs/IMPLEMENTATION_PLAN.yaml phase 4 constraints:
// - "dev": runs against the Vite dev server. Debug affordances (e.g. debug
//   Star Sprout spawn) are expected to be reachable here because
//   import.meta.env.DEV is true.
// - "preview": runs against `vite preview` serving the production build.
//   Tests here must assert the debug panel / debug globals are ABSENT, since
//   DEV is false in a production build.
// Subagent G (phase 4) owns tests/e2e/*.spec.ts; this file is Subagent A's to
// configure but not to fill with app-specific specs beyond a trivial smoke
// test per project.
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  // Babylon/WebGL scenes contend for the shared browser graphics context when
  // five workers run at once; serial workers keep actionability and screenshot
  // timing deterministic for the acceptance gate.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list']],
  use: {
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command: 'npm run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'npm run build && npm run preview',
      url: 'http://localhost:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
  projects: [
    {
      name: 'dev',
      testMatch: /.*\.dev\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:5173',
      },
    },
    {
      name: 'preview',
      testMatch: /.*\.preview\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:4173',
      },
    },
  ],
});

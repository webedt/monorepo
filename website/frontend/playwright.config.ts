import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E Test Configuration
 *
 * These tests run against a live frontend + backend stack.
 * Use `npm run test:e2e` to run after starting the dev servers.
 */
export default defineConfig({
  testDir: './e2e',

  // Maximum time for a single test
  timeout: 30_000,

  // Maximum time for each assertion
  expect: {
    timeout: 5_000,
  },

  // Run tests in parallel by default
  fullyParallel: true,

  // Fail the build if tests are marked as .only
  forbidOnly: !!process.env.CI,

  // Retry failed tests in CI
  retries: process.env.CI ? 2 : 0,

  // Limit parallel workers in CI for stability
  workers: process.env.CI ? 1 : undefined,

  // Reporter configuration
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'on-failure' }]],

  // Global configuration for all tests
  use: {
    // Base URL for navigation
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000',

    // Collect trace on first retry
    trace: 'on-first-retry',

    // Screenshot on failure
    screenshot: 'only-on-failure',

    // Video recording
    video: 'on-first-retry',

    // Accept downloads
    acceptDownloads: true,
  },

  // Configure projects for different browsers
  projects: [
    // Setup project for authenticated tests
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts/,
    },

    // Chromium tests (main browser)
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
      dependencies: ['setup'],
    },

    // Firefox tests (secondary)
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
      },
      dependencies: ['setup'],
    },

    // WebKit tests (Safari)
    {
      name: 'webkit',
      use: {
        ...devices['Desktop Safari'],
      },
      dependencies: ['setup'],
    },

    // Mobile Chrome tests
    {
      name: 'mobile-chrome',
      use: {
        ...devices['Pixel 5'],
      },
      dependencies: ['setup'],
    },
  ],

  // Web server configuration for running tests against dev servers
  webServer: process.env.CI ? undefined : [
    {
      command: 'npm run dev',
      cwd: '../..',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],

  // Output folder for test artifacts
  outputDir: 'e2e-results',
});

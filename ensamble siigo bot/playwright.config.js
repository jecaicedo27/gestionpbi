// @ts-check
const { defineConfig, devices } = require('@playwright/test');
const path = require('path');
require('dotenv').config();

/**
 * @see https://playwright.dev/docs/test-configuration
 */
module.exports = defineConfig({
  testDir: './tests',
  /* Maximum time one test can run for. */
  timeout: 60 * 1000,
  expect: {
    timeout: 10000
  },
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [
    ['html'],
    ['list']
  ],
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: 'https://svnegocios.apps.bancolombia.com',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',

    /* Capture screenshot on failure */
    screenshot: 'only-on-failure',

    /* Record video only on retry */
    video: 'on-first-retry',

    /* Browser options hardcodificadas para usar Chrome Local si es necesario
     * pero el test persistente usa su propia config.
     * Dejamos esto como default seguro.
     */
    headless: false,
    viewport: null,
    ignoreHTTPSErrors: true,
    channel: 'chrome',
    launchOptions: {
      slowMo: 100,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--start-maximized',
        '--no-sandbox',
        '--disable-infobars'
      ],
      ignoreDefaultArgs: ['--enable-automation'],
    },
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: {
        channel: 'chrome', // <--- REACTIVADO PARA SOLUCIONAR BLOQUEO
        launchOptions: {
          args: [
            '--start-maximized',
            '--disable-blink-features=AutomationControlled',
            '--disable-infobars'
          ],
          ignoreDefaultArgs: ['--enable-automation'],
        },
        viewport: null
      },
    },
  ],
});

import { defineConfig } from '@playwright/test';
import { join } from 'node:path';

const scenario = process.env.DEMO_SCENARIO;
const runDir = process.env.DEMO_RUN_DIR;
if (!scenario || !/^[a-z0-9][a-z0-9-]*$/.test(scenario) || !runDir) throw new Error('Use pnpm demo [scenario]');
export default defineConfig({
  testDir: './scenarios', testMatch: `${scenario}.spec.ts`,
  outputDir: join(runDir, 'test-results', 'playwright'),
  timeout: 120000, globalTimeout: 150000, expect: { timeout: 10000 },
  fullyParallel: false, workers: 1, retries: 0, forbidOnly: true, maxFailures: 1,
  reporter: [['list'], ['json', { outputFile: join(runDir, 'test-results/report.json') }]],
  projects: [{ name: 'chromium', use: { browserName: 'chromium', headless: true } }],
});

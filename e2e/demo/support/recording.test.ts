import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { roles, type RecordingManifest } from '../types';
import { blackBoundary, probe, runMedia, trimStart } from './video';

for (const frameObservation of ['normal', 'delayed', 'missing'] as const) test(`real fixture calibration and tail: ${frameObservation} projection frame observation`, { timeout: 60000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'demo-recording-tail-'));
  try {
    await mkdir(join(dir, 'test-results'));
    // Synthetic static pages exercise only recording, without running a match or changing app DOM.
    await writeFile(join(dir, 'static.spec.ts'), `
      import { test as fixture, expect } from ${JSON.stringify(resolve('e2e/demo/fixtures'))};
      const test = fixture.extend({
        browser: async ({ browser }, use) => {
          const newContext = browser.newContext.bind(browser);
          let count = 0;
          let observedForMs = 0;
          browser.newContext = async options => {
            const context = await newContext(options);
            if (${frameObservation !== 'normal'} && ++count === 2) {
              const newPage = context.newPage.bind(context);
              context.newPage = async () => {
                const page = await newPage();
                // Delay readiness evidence beyond the old 150ms + 650ms hold.
                // The real recorder still runs; only the observer is gated so
                // the fixture must keep painting black until frames arrive.
                const start = page.screencast.start.bind(page.screencast);
                const stop = page.screencast.stop.bind(page.screencast);
                let startedAt = 0;
                page.screencast.start = async options => {
                  startedAt = performance.now();
                  // A cached frame from before the black paint is not readiness
                  // evidence, even if it reaches the observer immediately.
                  options?.onFrame?.({ data: Buffer.alloc(0), timestamp: Date.now() - 10000, viewportWidth: 960, viewportHeight: 1040 });
                  return start({ ...options, onFrame: frame => {
                    if (performance.now() - startedAt >= ${frameObservation === 'missing' ? 'Infinity' : 1500}) return options?.onFrame?.(frame);
                  } });
                };
                page.screencast.stop = async () => {
                  observedForMs = performance.now() - startedAt;
                  return stop();
                };
                return page;
              };
            }
            return context;
          };
          try { await use(browser); }
          finally { browser.newContext = newContext; }
          if (${frameObservation !== 'normal'}) expect(observedForMs).toBeGreaterThanOrEqual(${frameObservation === 'missing' ? 10000 : 2500});
        }
      });
      test('static recording', async ({ demo }) => {
        await demo.pages.mc.waitForTimeout(1600);
      });
    `);
    await writeFile(join(dir, 'playwright.config.ts'), `export default {
      testDir: ${JSON.stringify(dir)}, testMatch: 'static.spec.ts',
      workers: 1, retries: 0, timeout: 30000, outputDir: ${JSON.stringify(join(dir, 'test-results', 'playwright'))},
      use: { browserName: 'chromium', headless: true }
    };`);
    const run = promisify(execFile)(process.execPath, [require.resolve('@playwright/test/cli'), 'test', '--config', join(dir, 'playwright.config.ts')], {
      timeout: 45000,
      env: { ...process.env, DEMO_RUN_DIR: dir, DEMO_MC_URL: 'data:text/html;charset=utf-8,' + encodeURIComponent('<h1>ドン大喜利 MC操作卓</h1>'), DEMO_SERVER_URL: 'http://127.0.0.1', DEMO_AUDIENCE_URL: 'http://127.0.0.1' },
    });
    if (frameObservation === 'missing') {
      await assert.rejects(run, error => /Calibration black frames were not delivered for one second/.test((error as Error & { stdout: string }).stdout));
      const recording: RecordingManifest = JSON.parse(await readFile(join(dir, 'recording.json'), 'utf8'));
      assert.equal(recording.status, 'failed');
      assert.equal(recording.startedMonoMs, 0, 'must not start the scenario without calibration frames');
      assert.equal(recording.screens.projection, undefined);
      assert.ok(Number((await probe(join(dir, 'raw/projection.webm'))).format.duration) > 0, 'finalize raw video even on calibration failure');
      return;
    }
    await run;
    const recording: RecordingManifest = JSON.parse(await readFile(join(dir, 'recording.json'), 'utf8'));
    assert.equal(recording.status, 'passed');
    const duration = (recording.endedMonoMs - recording.startedMonoMs) / 1000;
    assert.ok(duration >= 1.6);
    for (const role of roles) {
      const screen = recording.screens[role];
      const file = join(dir, screen.file);
      const info = await probe(file);
      const boundary = blackBoundary(await runMedia('ffmpeg', ['-nostdin', '-threads', '2', '-i', file, '-vf', 'blackdetect=d=0.3:pix_th=0.02:pic_th=0.99', '-an', '-f', 'null', '-']));
      const start = trimStart(boundary, screen.calibration, recording.startedMonoMs);
      const tail = Number(info.format.duration) - start - duration;
      t.diagnostic(`${role}: blackEnd=${boundary.toFixed(3)}s, deliveredBlackSpan=${screen.calibration.blackFrameSpanMs?.toFixed(1)}ms, tail=${tail.toFixed(3)}s`);
      assert.ok(screen.calibration.blackFrameSpanMs! >= 1000, `${role}: must receive one second of black frames before white`);
      assert.ok(tail > 0, `${role}: expected frames after endedMonoMs, got ${tail}s`);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

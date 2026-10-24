import { test as base, expect, type BrowserContext, type Page, type Video } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { Actions, observe, type Observations } from './support/actions';
import { prepareCalibrationBlack } from './support/calibration';
import { roles, type DemoActions, type RecordingManifest, type ScreenRole } from './types';

export const test = base.extend<{ demo: DemoActions }>({
  demo: async ({ browser }, use, testInfo) => {
    const dir = process.env.DEMO_RUN_DIR;
    if (!dir) throw new Error('Run scenarios through pnpm demo');
    const contexts: Partial<Record<ScreenRole, BrowserContext>> = {};
    const pages = {} as Record<ScreenRole, Page>;
    const videos: Partial<Record<ScreenRole, Video>> = {};
    const observations = {} as Record<ScreenRole, Observations>;
    const recording: RecordingManifest = { schemaVersion: 1, status: 'failed', testCount: 1, startedMonoMs: 0, endedMonoMs: 0, screens: {} as RecordingManifest['screens'] };
    let actions: Actions | undefined;
    const teardownErrors: unknown[] = [];
    let completed = false;
    try {
      await mkdir(join(dir, 'raw'), { recursive: true });
      for (const role of roles) {
        const viewport = role === 'mc' ? { width: 1120, height: 1040 } : role === 'projection' ? { width: 960, height: 1040 } : { width: 390, height: 844 };
        const context = await browser.newContext({ viewport, recordVideo: { dir: join(dir, 'work', role), size: viewport }, deviceScaleFactor: 1, locale: 'ja-JP', timezoneId: 'Asia/Tokyo', isMobile: role === 'audience', hasTouch: role === 'audience' });
        contexts[role] = context;
        await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
        if (role === 'mc') await context.addInitScript(() => {
          const original = window.open;
          (window as Window & { __demoProjection?: string[] }).__demoProjection = [];
          window.open = function(url, ...rest) {
            if (url) {
              const parsed = new URL(String(url), location.href);
              if (parsed.origin === location.origin && parsed.searchParams.get('view') === 'projection') {
                (window as Window & { __demoProjection?: string[] }).__demoProjection!.push(parsed.toString());
                return null;
              }
            }
            return original.call(window, url, ...rest);
          };
        });
        const page = await context.newPage(); pages[role] = page;
        const video = page.video(); if (!video) throw new Error('Missing video handle'); videos[role] = video;
        observations[role] = observe(page);
        // Calibration only: never alter real app DOM, HTTP responses, storage or WS frames.
        const black = await prepareCalibrationBlack(page);
        recording.screens[role] = { role, file: `raw/${role}.webm`, viewport, calibration: { ...black, hostBeforeMs: 0, hostAfterMs: 0 } };
      }
      for (const role of roles) {
        await pages[role].screenshot(); // Flush the final black paint before switching to white.
        const hostBeforeMs = performance.now();
        await pages[role].evaluate(async () => {
          document.documentElement.style.background = '#fff'; document.body.style.background = '#fff';
          await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        });
        const hostAfterMs = performance.now();
        Object.assign(recording.screens[role].calibration, { hostBeforeMs, hostAfterMs });
        if (hostAfterMs - hostBeforeMs > 100) throw new Error(`Calibration roundtrip exceeded 100ms: ${role}`);
        await pages[role].screenshot(); // Deliver white before leaving the calibration document.
      }
      await pages.mc.waitForTimeout(500);
      recording.startedMonoMs = performance.now();
      // These waiting cards precede the real UIs and contain no fabricated match evidence.
      for (const role of ['projection', 'audience'] as const) await pages[role].setContent(`<body style="font:28px sans-serif;background:white;padding:24px">${role === 'projection' ? '試合作成待ち' : '参加待ち'}</body>`);
      const urls = { serverUrl: process.env.DEMO_SERVER_URL!, mcUrl: process.env.DEMO_MC_URL!, audienceBaseUrl: process.env.DEMO_AUDIENCE_URL! };
      actions = new Actions(pages, observations, urls);
      await pages.mc.goto(urls.mcUrl);
      await expect(pages.mc.getByRole('heading', { name: 'ドン大喜利 MC操作卓', exact: true })).toBeVisible();
      await use(actions);
      completed = true;
    } finally {
      recording.endedMonoMs = performance.now();
      // Static pages may stop emitting screencast frames. Paint after T1 and let
      // Chromium deliver the tail before closing any context; keep it outside D.
      for (const role of roles) {
        if (!pages[role]) continue;
        await pages[role].screenshot().catch(e => teardownErrors.push(e));
        await pages[role].waitForTimeout(300).catch(e => teardownErrors.push(e));
      }
      recording.matchId = actions?.match?.matchId;
      const failed = !completed || testInfo.status !== 'passed' || (recording.endedMonoMs - recording.startedMonoMs) > 90000;
      // Each context is finalized even when another screenshot/trace/close fails.
      for (const role of roles) {
        if (!contexts[role]) continue;
        if (failed && pages[role]) await pages[role].screenshot({ path: join(dir, 'test-results', `${role}-failure.png`), fullPage: true }).catch(e => teardownErrors.push(e));
        await contexts[role]!.tracing.stop(failed ? { path: join(dir, 'test-results', `${role}-trace.zip`) } : {}).catch(e => teardownErrors.push(e));
        await contexts[role]!.close().catch(e => teardownErrors.push(e));
        if (videos[role]) await videos[role]!.saveAs(join(dir, 'raw', `${role}.webm`)).catch(e => teardownErrors.push(e));
      }
      recording.status = !failed && teardownErrors.length === 0 ? 'passed' : 'failed';
      await writeFile(join(dir, 'recording.json'), JSON.stringify(recording, null, 2) + '\n');
      if (teardownErrors.length) throw new AggregateError(teardownErrors, 'Recording finalization failed');
      if (completed && !failed && contexts.mc?.pages().length) throw new Error('Context remained open');
      if (completed && recording.endedMonoMs - recording.startedMonoMs > 90000) throw new Error('Recording exceeds 90 seconds');
    }
  },
});
export { expect };

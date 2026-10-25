import type { Page } from '@playwright/test';
import { performance } from 'node:perf_hooks';

// Only used on the fixture's calibration document, before visiting any real UI.
export async function prepareCalibrationBlack(page: Page): Promise<{ blackFrameSpanMs: number }> {
  await page.goto('data:text/html,' + encodeURIComponent('<!doctype html><html><head><style>html,body{margin:0;width:100%;height:100%;background:#000;overflow:hidden;cursor:none}</style></head><body></body></html>'), { waitUntil: 'load' });
  await page.screenshot();
  // A screenshot proves paint, not delivery to the video recorder. Observe the
  // same screencast as recordVideo, ignoring cached frames from before this paint.
  const paintedWallMs = Date.now();
  let firstFrameMs: number | undefined;
  let lastFrameMs: number | undefined;
  await page.screencast.start({ onFrame: ({ timestamp }) => {
    if (timestamp < paintedWallMs) return;
    firstFrameMs ??= timestamp;
    lastFrameMs = timestamp;
  } });
  try {
    const deadline = performance.now() + 10000;
    let paint = 0;
    while (firstFrameMs === undefined || lastFrameMs! - firstFrameMs < 1000) {
      if (performance.now() >= deadline) throw new Error('Calibration black frames were not delivered for one second');
      // Static paints may be omitted by Chromium. Both colors remain below the
      // unchanged blackdetect threshold (0.02), with no extra black boundary.
      await page.evaluate(color => {
        document.documentElement.style.background = color;
        document.body.style.background = color;
      }, paint++ % 2 ? '#000' : '#010101');
      await page.screenshot();
      await page.waitForTimeout(100);
    }
    return { blackFrameSpanMs: lastFrameMs! - firstFrameMs };
  } finally {
    // Remove only this observer; context-owned recordVideo continues recording.
    await page.screencast.stop();
  }
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ProcessScope, assertPortsFree } from './processes';
import { parseDemoArgs } from './cli';
import type { DemoManifest } from '../types';

test('demo CLI handles SIGHUP with exit 129 and releases real wrangler/vite ports', { timeout: 90000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'demo-sighup-'));
  const scope = new ProcessScope();
  const log = join(dir, 'demo.log');
  let runDir: string | undefined;
  try {
    const offset = 2000 + Math.floor(Math.random() * 10000);
    const ports = Object.values(parseDemoArgs(['basic', '--port-offset', String(offset)]).ports);
    await assertPortsFree(ports);
    const child = scope.start(process.execPath, ['--import', 'tsx', resolve('scripts/demo.ts'), 'basic', '--port-offset', String(offset)], log);
    const deadline = Date.now() + 60000;
    let output = '';
    while (!child.exited && Date.now() < deadline) {
      output = await readFile(log, 'utf8');
      runDir = output.match(/^Demo basic: (.+)$/m)?.[1];
      if (output.includes('Services ready;')) break;
      await delay(100);
    }
    assert.ok(output.includes('Services ready;'), output);
    assert.ok(runDir);
    const before: DemoManifest = JSON.parse(await readFile(join(runDir, 'manifest.json'), 'utf8'));
    assert.equal(before.processes?.length, 4); // list runner + wrangler + two Vites
    child.child.kill('SIGHUP');
    await assert.rejects(child.done, /Child exit 129:/);
    const manifest: DemoManifest = JSON.parse(await readFile(join(runDir, 'manifest.json'), 'utf8'));
    assert.equal(manifest.status, 'interrupted');
    assert.match(manifest.error!.message, /SIGHUP/);
    assert.equal(manifest.output, undefined);
    for (const entry of manifest.processes!) {
      assert.ok(entry.pid);
      assert.throws(() => process.kill(-entry.pid!, 0), /ESRCH/);
    }
    await assertPortsFree(ports);
  } finally {
    // Also reap detached services if this regression test fails on an unhandled SIGHUP.
    if (runDir) {
      const manifest: DemoManifest = JSON.parse(await readFile(join(runDir, 'manifest.json'), 'utf8'));
      for (const entry of manifest.processes ?? []) {
        if (entry.pid) {
          try { process.kill(-entry.pid, 'SIGTERM'); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
        }
      }
    }
    await scope.close();
    await rm(dir, { recursive: true, force: true });
    if (runDir) await rm(runDir, { recursive: true, force: true });
  }
});

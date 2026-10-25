import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { ProcessScope, assertPortsFree, waitReady, waitForExit } from './processes';
import { parseDemoArgs, validateReport } from './cli';

test('CLI rejects traversal, unknown flags and invalid numeric options before starting', () => {
  for (const args of [['../basic'], ['basic', '--port-offset', '-1'], ['basic', '--port-offset', '60000'], ['--max-mib', '0'], ['--max-mib', 'NaN'], ['--wat'], ['basic', 'extra']]) {
    assert.throws(() => parseDemoArgs(args));
  }
  assert.equal(parseDemoArgs([]).scenario, 'basic');
  assert.equal(parseDemoArgs(['--max-mib', '.5']).maxBytes, 524288);
  assert.equal(parseDemoArgs(['other', '--port-offset', '100']).ports.mc, 15273);
});

test('report contract rejects zero, multiple, skipped, failed, retried tests', () => {
  const report = (results: object[]) => ({ suites: [{ specs: [{ tests: [{ results }] }] }] });
  assert.doesNotThrow(() => validateReport(report([{ status: 'passed', retry: 0 }])));
  assert.doesNotThrow(() => validateReport(report([]), true));
  assert.throws(() => validateReport({ suites: [{ specs: [{ tests: [{ expectedStatus: 'skipped', results: [] }] }] }] }, true));
  for (const data of [{ suites: [] }, report([{ status: 'skipped' }]), report([{ status: 'failed' }]), report([{ status: 'passed', retry: 1 }]), { suites: [{ specs: [{ tests: [{ results: [{ status: 'passed' }] }, { results: [{ status: 'passed' }] }] }] }] }]) {
    assert.throws(() => validateReport(data));
  }
});

test('occupied ports are rejected without terminating their owner', async () => {
  const server = createServer();
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  try { await assert.rejects(assertPortsFree([port]), /port|ポート/i); assert.equal(server.listening, true); }
  finally { server.close(); }
});

for (const mode of ['normal', 'timeout', 'exit', 'leader-exit', 'second-failure'] as const) {
  test(`process groups release child/grandchild ports: ${mode}`, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'demo-process-'));
    const scope = new ProcessScope();
    const portFile = join(dir, 'port');
    const grandchildPortFile = join(dir, 'grandchild-port');
    const grandchildCode = `const s=require('node:http').createServer((q,r)=>r.end('grandchild'));s.listen(0,'127.0.0.1',()=>require('node:fs').writeFileSync(${JSON.stringify(grandchildPortFile)},String(s.address().port)));`;
    const code = `const {spawn}=require('node:child_process'); const s=require('node:http').createServer((q,r)=>r.end('ready')); s.listen(0,'127.0.0.1',()=>require('node:fs').writeFileSync(${JSON.stringify(portFile)},String(s.address().port))); spawn(process.execPath,['-e',${JSON.stringify(grandchildCode)}],{stdio:'ignore'});${mode === 'leader-exit' ? 'setTimeout(()=>process.exit(0),150);' : ''}`;
    let port = 0, grandchildPort = 0;
    try {
      const child = scope.start(process.execPath, ['-e', code], join(dir, 'server.log'));
      const deadline = Date.now() + 3000;
      while ((!port || !grandchildPort) && Date.now() < deadline) {
        port = Number(await readFile(portFile, 'utf8').catch(() => '0'));
        grandchildPort = Number(await readFile(grandchildPortFile, 'utf8').catch(() => '0'));
        if (!port || !grandchildPort) await new Promise(r => setTimeout(r, 20));
      }
      assert.ok(port && grandchildPort);
      await waitReady(child, `http://127.0.0.1:${port}`, async r => await r.text() === 'ready');
      assert.equal(await (await fetch(`http://127.0.0.1:${grandchildPort}`)).text(), 'grandchild');
      if (mode === 'leader-exit') { await child.done; assert.equal(child.exited, true); assert.equal(await (await fetch(`http://127.0.0.1:${grandchildPort}`)).text(), 'grandchild'); }
      if (mode === 'timeout') await assert.rejects(waitReady(child, 'http://127.0.0.1:1', async () => true, { timeoutMs: 80 }), /timeout/i);
      if (mode === 'exit') {
        const exited = scope.start(process.execPath, ['-e', 'process.exit(3)'], join(dir, 'exit.log'));
        await assert.rejects(waitReady(exited, 'http://127.0.0.1:1', async () => true, { timeoutMs: 1000 }), /exit/i);
      }
      if (mode === 'second-failure') {
        const bad = scope.start('/nonexistent/demo-service', [], join(dir, 'bad.log'));
        await assert.rejects(bad.done);
      }
    } finally { await scope.close(); }
    for (const child of scope.children) {
      if (child.pid) assert.throws(() => process.kill(-child.pid!, 0), /ESRCH/);
    }
    await assertPortsFree([port, grandchildPort]);
    await rm(dir, { recursive: true, force: true });
  });
}

test('unknown scenarios and paths cannot resolve outside scenario directory', async () => {
  const { resolveScenario } = await import('./cli');
  assert.throws(() => resolveScenario(process.cwd(), 'missing-scenario'));
  assert.throws(() => resolveScenario(process.cwd(), '../basic'));
  assert.ok(resolveScenario(process.cwd(), 'basic').endsWith('/basic.spec.ts'));
});


test('abort during a pending child exit enters cleanup immediately', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'demo-abort-'));
  const scope = new ProcessScope();
  try {
    const child = scope.start(process.execPath, ['-e', 'setInterval(()=>{},1000)'], join(dir, 'child.log'));
    const abort = new AbortController();
    const waiting = waitForExit(child, abort.signal);
    abort.abort(new Error('interrupted while listing'));
    await assert.rejects(waiting, /interrupted while listing/);
  } finally { await scope.close(); await rm(dir, { recursive: true, force: true }); }
});

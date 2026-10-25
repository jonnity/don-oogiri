import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, mkdir, readFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';
import { parseDemoArgs, resolveScenario, scenarioNames, validateReport } from '../e2e/demo/support/cli';
import { ProcessScope, assertPortsFree, waitReady, waitForExit, type ManagedProcess } from '../e2e/demo/support/processes';
import { checkMediaTools, composeVideo } from '../e2e/demo/support/video';
import { atomicJson } from '../e2e/demo/support/publish';
import type { DemoManifest, DemoRunConfig, RecordingManifest } from '../e2e/demo/types';

const root = resolve(__dirname, '..');
const exec = promisify(execFile);
async function source() {
  const headSha = (await exec('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
  const dirty = !!(await exec('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: root })).stdout.trim();
  return { headSha, dirty };
}
async function main(): Promise<number> {
  process.chdir(root);
  let parsed: ReturnType<typeof parseDemoArgs>;
  try {
    parsed = parseDemoArgs(process.argv.slice(2));
    if (parsed.help) { console.log('pnpm demo [scenario=basic] [--port-offset N] [--max-mib N]\npnpm demo --list\nWSL2 headless recording; setup: docs/demo.md'); return 0; }
    if (parsed.list) { console.log(scenarioNames(root).join('\n')); return 0; }
    resolveScenario(root, parsed.scenario);
  } catch (e) { console.error(String(e)); return 2; }
  const runId = `${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}-${parsed.scenario}-${randomBytes(3).toString('hex')}`;
  const runDir = join(root, '.demo-artifacts', runId);
  await Promise.all(['raw', 'logs', 'work', 'test-results'].map(d => mkdir(join(runDir, d), { recursive: true })));
  const config: DemoRunConfig = { runId, scenario: parsed.scenario, runDir, ports: parsed.ports, maxBytes: parsed.maxBytes, urls: { serverUrl: `http://127.0.0.1:${parsed.ports.server}`, mcUrl: `http://127.0.0.1:${parsed.ports.mc}`, audienceBaseUrl: `http://127.0.0.1:${parsed.ports.audience}` } };
  const before = await source();
  const manifest: DemoManifest = { schemaVersion: 1, runId, scenario: config.scenario, status: 'running', createdAt: new Date().toISOString(), source: before, urls: config.urls, tools: { node: process.version, playwright: '', chromium: '', ffmpeg: '' } };
  const scope = new ProcessScope();
  const abort = new AbortController();
  let signalCode = 0, playwright: ManagedProcess | undefined, stage = 'preflight', code = 1;
  const interrupt = (signal: NodeJS.Signals) => {
    if (signalCode) return;
    signalCode = signal === 'SIGHUP' ? 129 : signal === 'SIGINT' ? 130 : 143;
    abort.abort(new Error(`Interrupted by ${signal}`));
    if (playwright) playwright.child.kill('SIGINT');
  };
  const sigint = () => interrupt('SIGINT'), sigterm = () => interrupt('SIGTERM'), sighup = () => interrupt('SIGHUP');
  process.on('SIGINT', sigint); process.on('SIGTERM', sigterm); process.on('SIGHUP', sighup);
  const deadline = setTimeout(() => abort.abort(new Error('Overall timeout (480 seconds)')), 480000);
  let monitor: ReturnType<typeof setInterval> | undefined;
  try {
    await atomicJson(join(runDir, 'manifest.json'), manifest);
    console.log(`Demo ${config.scenario}: ${runDir}`);
    if (process.platform !== 'linux' || Number(process.versions.node.split('.')[0]) < 20) throw new Error('Linux Node >=20 required (WSL2); see docs/demo.md');
    await exec('pnpm', ['--version'], { cwd: root, timeout: 10000 });
    await access(chromium.executablePath()).catch(() => { throw new Error('Chromium missing: pnpm exec playwright install --with-deps chromium'); });
    const browser = await chromium.launch({ headless: true });
    try { manifest.tools.chromium = browser.version(); } finally { await browser.close(); }
    manifest.tools.playwright = (await exec('pnpm', ['exec', 'playwright', '--version'], { cwd: root, timeout: 10000 })).stdout.trim();
    manifest.tools.ffmpeg = await checkMediaTools();
    await assertPortsFree(Object.values(config.ports));
    abort.signal.throwIfAborted();
    const env = { ...process.env, VITE_SERVER_URL: config.urls.serverUrl, VITE_AUDIENCE_URL: config.urls.audienceBaseUrl, BROWSER: 'none', WRANGLER_SEND_METRICS: 'false', CI: '1' };
    const demoEnv = { ...env, DEMO_RUN_DIR: runDir, DEMO_SCENARIO: config.scenario, DEMO_SERVER_URL: config.urls.serverUrl, DEMO_MC_URL: config.urls.mcUrl, DEMO_AUDIENCE_URL: config.urls.audienceBaseUrl };
    const listed = scope.start(process.execPath, [require.resolve('@playwright/test/cli'), 'test', '--config', 'e2e/demo/playwright.config.ts', '--list'], join(runDir, 'logs/playwright-list.log'), demoEnv);
    await waitForExit(listed, abort.signal);
    validateReport(JSON.parse(await readFile(join(runDir, 'test-results/report.json'), 'utf8')), true);
    abort.signal.throwIfAborted();
    stage = 'services';
    const server = scope.start('pnpm', ['--filter', '@don-oogiri/server', 'exec', 'wrangler', 'dev', '--ip', '127.0.0.1', '--port', String(config.ports.server), '--inspector-port', String(config.ports.inspector), '--local-protocol', 'http', '--persist-to', join(runDir, 'wrangler-state'), '--show-interactive-dev-session=false'], join(runDir, 'logs/server.log'), env);
    await waitReady(server, config.urls.serverUrl, async r => { const json = await r.json(); return json.name === 'don-oogiri-server' && json.status === 'ok'; }, { signal: abort.signal });
    const services = [server];
    monitor = setInterval(() => {
      if (abort.signal.aborted) return;
      try { scope.checkAlive(services); }
      catch (error) { abort.abort(error); if (playwright) playwright.child.kill('SIGINT'); }
    }, 100);
    for (const [name, port, url] of [['mc-ui', config.ports.mc, config.urls.mcUrl], ['audience-ui', config.ports.audience, config.urls.audienceBaseUrl]] as const) {
      const child = scope.start('pnpm', ['--filter', `@don-oogiri/${name}`, 'exec', 'vite', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], join(runDir, `logs/${name}.log`), env);
      services.push(child);
      await waitReady(child, url, async r => (await r.text()).includes('/src/main.tsx'), { signal: abort.signal });
      scope.checkAlive(services);
    }
    manifest.processes = scope.children.map(({ pid, log }) => ({ pid, log }));
    await atomicJson(join(runDir, 'manifest.json'), manifest);
    stage = 'scenario';
    console.log('Services ready; recording real MC / projection / audience UI operations.');
    playwright = scope.start(process.execPath, [require.resolve('@playwright/test/cli'), 'test', '--config', 'e2e/demo/playwright.config.ts'], join(runDir, 'logs/playwright.log'), demoEnv);
    // Abort settles promptly; finally gives Playwright up to ten seconds to save trace/video.
    await waitForExit(playwright, abort.signal);
    abort.signal.throwIfAborted();
    validateReport(JSON.parse(await readFile(join(runDir, 'test-results/report.json'), 'utf8')));
    manifest.recording = JSON.parse(await readFile(join(runDir, 'recording.json'), 'utf8')) as RecordingManifest;
    stage = 'compose';
    console.log('Recording passed; calibrating and composing MP4.');
    manifest.output = await composeVideo(runDir, manifest.recording, config.maxBytes, abort.signal);
    scope.checkAlive(services);
    abort.signal.throwIfAborted();
    manifest.status = 'passed'; code = 0;
  } catch (error) {
    code = signalCode || (stage === 'preflight' ? 2 : 1);
    manifest.status = signalCode ? 'interrupted' : 'failed';
    manifest.error = { stage, message: String(error) };
    console.error(`${manifest.error.message}\nDiagnostics: ${runDir}`);
  } finally {
    clearTimeout(deadline); if (monitor) clearInterval(monitor);
    if (playwright && !playwright.exited) {
      playwright.child.kill('SIGINT');
      await Promise.race([playwright.done.catch(() => {}), delay(10000, undefined, { ref: false })]);
    }
    await scope.close();
    if (abort.signal.aborted) {
      code = signalCode || 1;
      manifest.status = signalCode ? 'interrupted' : 'failed';
      manifest.error ??= { stage, message: String(abort.signal.reason) };
    }
    if (code !== 0) { await rm(join(runDir, 'demo.mp4'), { force: true }); delete manifest.output; }
    const after = await source();
    manifest.source.dirty = before.dirty || after.dirty || before.headSha !== after.headSha;
    if (!manifest.recording) { try { manifest.recording = JSON.parse(await readFile(join(runDir, 'recording.json'), 'utf8')); } catch { /* no completed recording on early failures */ } }
    manifest.processes = scope.children.map(({ pid, log }) => ({ pid, log }));
    await atomicJson(join(runDir, 'manifest.json'), manifest);
    process.off('SIGINT', sigint); process.off('SIGTERM', sigterm); process.off('SIGHUP', sighup);
  }
  if (code === 0 && manifest.output) {
    console.log(`MP4: ${join(runDir, 'demo.mp4')}\nManifest: ${join(runDir, 'manifest.json')}\nSize: ${manifest.output.bytes} bytes; duration: ${manifest.output.durationSeconds}s`);
    console.log(`DEMO_VIDEO=${join(runDir, 'demo.mp4')}`);
  }
  return code;
}
void main().then(code => { process.exitCode = code; }).catch(error => { console.error(String(error)); process.exitCode = 1; });

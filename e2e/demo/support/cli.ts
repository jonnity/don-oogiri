import { readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export function parseDemoArgs(args: string[]) {
  let scenario = 'basic', named = false, offset = 0, maxMiB = 9, help = false, list = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help') help = true;
    else if (arg === '--list') list = true;
    else if (arg === '--port-offset' || arg === '--max-mib') {
      const value = args[++i];
      if (!value || value.trim() !== value || !Number.isFinite(Number(value))) throw new Error(`Invalid ${arg}`);
      if (arg === '--port-offset') offset = Number(value); else maxMiB = Number(value);
    } else if (!named && /^[a-z0-9][a-z0-9-]*$/.test(arg)) { scenario = arg; named = true; }
    else throw new Error(`Invalid argument: ${arg}`);
  }
  const ports = { server: 18787 + offset, inspector: 19229 + offset, mc: 15173 + offset, audience: 15174 + offset };
  if (!Number.isSafeInteger(offset) || offset < 0 || Object.values(ports).some(p => p < 1 || p > 65535) || new Set(Object.values(ports)).size !== 4) throw new Error('Invalid port offset');
  if (!Number.isFinite(maxMiB) || maxMiB <= 0 || !Number.isSafeInteger(Math.floor(maxMiB * 1024 * 1024)) || maxMiB * 1024 * 1024 < 1) throw new Error('Invalid max MiB');
  return { scenario, ports, maxBytes: Math.floor(maxMiB * 1024 * 1024), help, list };
}
export function scenarioNames(root: string): string[] {
  return readdirSync(resolve(root, 'e2e/demo/scenarios')).filter(n => /^[a-z0-9][a-z0-9-]*\.spec\.ts$/.test(n)).map(n => n.slice(0, -8)).sort();
}
export function resolveScenario(root: string, name: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error('Invalid scenario');
  const file = resolve(root, 'e2e/demo/scenarios', `${name}.spec.ts`);
  if (!existsSync(file)) throw new Error(`Unknown scenario: ${name}; use --list`);
  return file;
}
// Validate the JSON reporter as well as the fixture: an empty/skipped/partial run is never publishable.
export function validateReport(report: unknown, listed = false): void {
  const tests: { results?: { status?: string; retry?: number }[]; expectedStatus?: string }[] = [];
  function visit(node: any): void {
    for (const spec of node.specs ?? []) tests.push(...(spec.tests ?? []));
    for (const suite of node.suites ?? []) visit(suite);
  }
  visit(report);
  if (tests.length !== 1 || tests[0].expectedStatus && tests[0].expectedStatus !== 'passed' || !listed && (tests[0].results?.length !== 1 || tests[0].results[0].status !== 'passed' || (tests[0].results[0].retry ?? 0) !== 0)) throw new Error('Scenario must contain exactly one passing, non-skipped test (no retries)');
}

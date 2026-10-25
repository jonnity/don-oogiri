import { spawn, type ChildProcess } from 'node:child_process';
import { openSync, closeSync } from 'node:fs';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

export interface ManagedProcess {
  child: ChildProcess; pid?: number; log: string; done: Promise<void>; exited: boolean; error?: Error;
}
export class ProcessScope {
  children: ManagedProcess[] = [];
  private closing?: Promise<void>;
  start(executable: string, args: string[], log: string, env: NodeJS.ProcessEnv = process.env): ManagedProcess {
    const fd = openSync(log, 'a');
    let child: ChildProcess;
    try { child = spawn(executable, args, { detached: true, shell: false, env, stdio: ['ignore', fd, fd] }); }
    finally { closeSync(fd); }
    const entry = { child, pid: child.pid, log, exited: false } as ManagedProcess;
    entry.done = new Promise((resolve, reject) => {
      child.once('error', error => { entry.exited = true; entry.error = error; reject(error); });
      child.once('exit', (code, signal) => {
        entry.exited = true;
        if (code === 0) resolve();
        else { entry.error = new Error(`Child exit ${code ?? signal}: ${executable}; log: ${log}`); reject(entry.error); }
      });
    });
    void entry.done.catch(() => {}); // Retain rejection for callers without an unhandled rejection during startup.
    this.children.push(entry);
    return entry;
  }
  checkAlive(entries = this.children): void {
    for (const child of entries) if (child.exited) throw child.error ?? new Error(`Unexpected child exit; log: ${child.log}`);
  }
  close(): Promise<void> {
    return this.closing ??= (async () => {
      // Always address the group, even when its leader has already exited.
      for (const child of this.children) signalGroup(child, 'SIGTERM');
      const deadline = Date.now() + 5000;
      while (this.children.some(groupAlive) && Date.now() < deadline) await delay(50);
      for (const child of this.children) if (groupAlive(child)) signalGroup(child, 'SIGKILL');
      await Promise.allSettled(this.children.map(c => c.done));
    })();
  }
}
export function signalGroup(child: ManagedProcess, signal: NodeJS.Signals): void {
  if (!child.pid) return;
  try { process.kill(-child.pid, signal); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
}
function groupAlive(child: ManagedProcess): boolean {
  if (!child.pid) return false;
  try { process.kill(-child.pid, 0); return true; } catch { return false; }
}
export async function assertPortsFree(ports: number[]): Promise<void> {
  for (const port of ports) {
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', error => reject(new Error(`Port ${port} unavailable: ${error.message}`)));
      server.listen(port, '127.0.0.1', () => server.close(error => error ? reject(error) : resolve()));
    });
  }
}
export async function waitReady(child: ManagedProcess, url: string, accept: (response: Response) => Promise<boolean>, options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<void> {
  const deadline = Date.now() + (options.timeoutMs ?? 60000);
  while (Date.now() < deadline) {
    options.signal?.throwIfAborted();
    if (child.exited) throw child.error ?? new Error(`Child exit before readiness: ${child.log}`);
    try {
      const response = await fetch(url, { signal: AbortSignal.any([AbortSignal.timeout(2000), ...(options.signal ? [options.signal] : [])]) });
      if (response.status === 200 && await accept(response)) {
        if (child.exited) throw new Error(`Child exit before readiness: ${child.log}`);
        return;
      }
    } catch { /* request errors are retried; child exit and abort are checked each iteration */ }
    await delay(250, undefined, { signal: options.signal });
  }
  throw new Error(`Readiness timeout: ${url}; log: ${child.log}`);
}

export async function waitForExit(child: ManagedProcess, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  let rejectAbort!: () => void;
  const interrupted = new Promise<never>((_, reject) => {
    rejectAbort = () => reject(signal.reason);
    signal.addEventListener('abort', rejectAbort, { once: true });
  });
  try { await Promise.race([child.done, interrupted]); }
  finally { signal.removeEventListener('abort', rejectAbort); }
}

import { resolve } from 'node:path';
import { publishDemo } from '../e2e/demo/support/publish';

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) { console.log('pnpm demo:publish --pr N --run <directory> [--repo owner/repo] [--allow-dirty]\nCreates/uploads to demo-videos prerelease and comments on the PR.'); return; }
  let pr = 0, runDir = '', repo: string | undefined, allowDirty = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--allow-dirty') allowDirty = true;
    else if (args[i] === '--pr') { const value = args[++i]; if (!/^\d+$/.test(value ?? '')) throw new Error('Invalid PR'); pr = Number(value); }
    else if (args[i] === '--run') runDir = args[++i] ?? '';
    else if (args[i] === '--repo') repo = args[++i];
    else throw new Error(`Unknown argument: ${args[i]}`);
  }
  if (!pr || !runDir) throw new Error('--pr and --run are required');
  const result = await publishDemo({ pr, runDir: resolve(runDir), repo, allowDirty });
  console.log(`Asset: ${result.assetUrl}\nComment: ${result.commentUrl}`);
}
void main().catch(error => { console.error(String(error)); process.exitCode = 1; });

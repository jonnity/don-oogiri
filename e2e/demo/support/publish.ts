import { execFile } from 'node:child_process';
import { readFile, writeFile, mkdir, copyFile, realpath, stat, rename } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import type { DemoManifest } from '../types';

export interface PublishOptions { pr: number; runDir: string; repo?: string; gh?: string; allowDirty: boolean }
interface Asset { id: string | number; name: string; size: number; url: string; digest?: string }
interface ShareResult { repo: string; pr: number; headSha: string; assetId: string | number; assetUrl: string; assetName: string; commentUrl?: string }
export async function atomicJson(file: string, data: unknown): Promise<void> {
  const temporary = `${file}.tmp`;
  await writeFile(temporary, JSON.stringify(data, null, 2) + '\n'); await rename(temporary, file);
}
export async function validatePublishInput(dir: string, allowDirty: boolean): Promise<DemoManifest & { output: NonNullable<DemoManifest['output']> }> {
  const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as DemoManifest;
  if (manifest.schemaVersion !== 1 || manifest.status !== 'passed' || !/^[a-z0-9][a-z0-9-]*$/.test(manifest.scenario ?? '') || !/^\d{8}T\d{6}Z-[a-z0-9-]+$/.test(manifest.runId ?? '') || !/^[a-f0-9]{40}$/.test(manifest.source?.headSha ?? '') || typeof manifest.source?.dirty !== 'boolean' || !Number.isFinite(Date.parse(manifest.createdAt)) || !manifest.output || manifest.output.file !== 'demo.mp4') throw new Error('Invalid or unsuccessful demo manifest');
  if (manifest.source.dirty && !allowDirty) throw new Error('Dirty recording: use --allow-dirty explicitly for work in progress');
  const output = manifest.output;
  const file = join(dir, output.file);
  if (await realpath(file) !== join(await realpath(dir), 'demo.mp4')) throw new Error('Video symlink outside run directory');
  const bytes = (await stat(file)).size;
  if (!Number.isSafeInteger(output.bytes) || bytes <= 0 || bytes !== output.bytes || !/^[a-f0-9]{64}$/.test(output.sha256) || createHash('sha256').update(await readFile(file)).digest('hex') !== output.sha256 || output.width !== 2560 || output.height !== 1080 || output.fps !== 25 || !Number.isFinite(output.durationSeconds) || output.durationSeconds <= 0) throw new Error('Video size/hash/format does not match manifest');
  return manifest as DemoManifest & { output: NonNullable<DemoManifest['output']> };
}
export async function publishDemo(options: PublishOptions): Promise<ShareResult> {
  const { pr, allowDirty } = options;
  if (!Number.isSafeInteger(pr) || pr < 1 || options.repo && !/^[\w.-]+\/[\w.-]+$/.test(options.repo)) throw new Error('Invalid PR/repo');
  const dir = resolve(options.runDir);
  const manifest = await validatePublishInput(dir, allowDirty);
  const share = join(dir, 'share'); await mkdir(share, { recursive: true });
  let repo = options.repo;
  async function gh(args: string[], json = false): Promise<any> {
    const fullArgs = repo && args[0] === 'repo' ? [...args, repo] : repo && ['pr', 'release'].includes(args[0]) ? [...args, '--repo', repo] : args;
    return new Promise((resolve, reject) => {
      execFile(options.gh ?? 'gh', fullArgs, { cwd: process.cwd(), env: { ...process.env, ...(repo ? { GH_REPO: repo } : {}) }, timeout: 60000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) reject(new Error(`gh ${args.slice(0, 2).join(' ')}: ${stderr || error.message}`));
        else { try { resolve(json ? JSON.parse(stdout) : stdout.trim()); } catch (e) { reject(e); } }
      });
    });
  }
  await gh(['auth', 'status']);
  const repository = await gh(['repo', 'view', '--json', 'nameWithOwner,defaultBranchRef'], true);
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository.nameWithOwner) || repo && repo.toLowerCase() !== repository.nameWithOwner.toLowerCase()) throw new Error('Repository mismatch');
  repo = repository.nameWithOwner;
  async function checkHead() {
    const target = await gh(['pr', 'view', String(pr), '--json', 'url,number,headRefOid,state'], true);
    if (target.number !== pr || target.headRefOid !== manifest.source.headSha || target.state !== 'OPEN' || !target.url?.startsWith(`https://github.com/${repo}/pull/`)) throw new Error('PR head/repository/state mismatch');
    return target;
  }
  await checkHead();
  const releaseArgs = ['release', 'view', 'demo-videos', '--json', 'isDraft,isPrerelease,assets,url'];
  let release: any;
  try { release = await gh(releaseArgs, true); }
  catch (error) {
    let missing = /HTTP 404\b/.test(String(error));
    // Some gh versions reduce a release 404 to 'release not found'. Confirm via the API;
    // never infer absence from authentication, connectivity or server errors.
    if (!missing) {
      try { await gh(['api', `repos/${repo}/releases/tags/demo-videos`], true); }
      catch (apiError) { missing = /HTTP 404\b/.test(String(apiError)); }
    }
    if (!missing) throw error;
    const branch = repository.defaultBranchRef?.name;
    if (typeof branch !== 'string') throw new Error('Missing default branch');
    const defaultSha = await gh(['api', `repos/${repo}/commits/${encodeURIComponent(branch)}`, '--jq', '.sha']);
    const notes = join(share, 'release-notes.md');
    await writeFile(notes, 'PR確認用動画の置き場です。製品リリースではありません。\n');
    try { await gh(['release', 'create', 'demo-videos', '--target', defaultSha, '--prerelease', '--latest=false', '--title', 'PR demo videos', '--notes-file', notes]); }
    catch { /* Concurrent creation is accepted only if the re-read validates the release. */ }
    release = await gh(releaseArgs, true);
  }
  const rawRelease = await gh(['api', `repos/${repo}/releases/tags/demo-videos`], true);
  if (release.isDraft !== false || release.isPrerelease !== true || rawRelease.immutable === true) throw new Error('demo-videos must be a mutable published prerelease; immutable releases are unsupported');
  const name = `pr-${pr}-${manifest.scenario}-${manifest.source.headSha.slice(0, 12)}-${manifest.runId}.mp4`;
  function verifiedAsset(assets: Asset[]): Asset | undefined {
    const asset = assets.find(a => a.name === name);
    if (asset && (asset.size !== manifest.output.bytes || asset.digest && asset.digest !== `sha256:${manifest.output.sha256}` || !asset.url?.startsWith(`https://github.com/${repo}/releases/download/demo-videos/`))) throw new Error('Existing remote asset does not match this recording');
    return asset;
  }
  let asset = verifiedAsset(release.assets);
  if (!asset) {
    const upload = join(share, name); await copyFile(join(dir, 'demo.mp4'), upload);
    await gh(['release', 'upload', 'demo-videos', upload]);
    release = await gh(releaseArgs, true);
    asset = verifiedAsset(release.assets);
    if (!asset) throw new Error('Uploaded asset not found');
  }
  const result: ShareResult = { repo: repo!, pr, headSha: manifest.source.headSha, assetId: asset.id, assetUrl: asset.url, assetName: name };
  const resultFile = join(share, 'result.json');
  await atomicJson(resultFile, result); // Upload survives comment failure/ambiguous network completion.
  const marker = `<!-- don-oogiri-demo:${manifest.runId} -->`;
  const me = await gh(['api', 'user'], true);
  // --paginate emits individual JSON arrays; --slurp makes all pages one JSON value.
  const pages = await gh(['api', `repos/${repo}/issues/${pr}/comments`, '--paginate', '--slurp'], true);
  const comments = pages.flat();
  const previous = comments.find((c: any) => c.user?.login === me.login && c.body?.includes(marker));
  await checkHead(); // Recheck immediately before posting, even when resuming a partial upload.
  if (previous) result.commentUrl = previous.html_url;
  else {
    const body = `PRデモ: ${manifest.scenario}\n\n対象 head: \`${manifest.source.headSha}\`\n撮影 (UTC): ${manifest.createdAt}\n${manifest.source.dirty ? '未コミット変更を含むローカル撮影' : 'コミット済みのクリーンな状態で撮影'}\n\nMC操作卓 / 投影画面 / 観客スマホの3画面、${manifest.output.durationSeconds.toFixed(2)}秒。\n\n[MP4をダウンロード](${asset.url}) · [動画用Release](${release.url})\n\n${marker}\n`;
    const comment = join(share, 'comment.md'); await writeFile(comment, body);
    result.commentUrl = await gh(['pr', 'comment', String(pr), '--body-file', comment]);
  }
  await atomicJson(resultFile, result);
  return result;
}

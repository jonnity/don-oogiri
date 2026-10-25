import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { publishDemo } from './publish';

// This executable is the only gh used by these tests. It has no network implementation.
const fakeGh = `#!/usr/bin/env node
const fs=require('node:fs');
const path=require('node:path');
const dir=path.dirname(process.argv[1]);
const config=JSON.parse(fs.readFileSync(path.join(dir,'fake.json')));
const statePath=path.join(dir,'state.json');
const s=fs.existsSync(statePath)?JSON.parse(fs.readFileSync(statePath)):{calls:[],release:config.existing,assets:[],comments:[]};
const a=process.argv.slice(2); s.calls.push(a);
function save(){fs.writeFileSync(statePath,JSON.stringify(s))}
function out(x){save();console.log(typeof x==='string'?x:JSON.stringify(x));}
function fail(x){save();console.error(x);process.exit(1)}
if(a[0]==='repo'&&a.includes('--repo'))fail('repo view uses a positional repository, not --repo');
if(['pr','release'].includes(a[0])&&a[a.indexOf('--repo')+1]!=='owner/repo')fail('missing repo');
if(a[0]==='auth'){if(config.authError)fail('not logged in');out('ok')}
else if(a[0]==='repo')out({nameWithOwner:'owner/repo',defaultBranchRef:{name:'main'}});
else if(a[0]==='pr'&&a[1]==='view')out({number:1,url:'https://github.com/owner/repo/pull/1',headRefOid:config.moveHead && s.assets.length ? 'b'.repeat(40):config.sha,state:'OPEN'});
else if(a[0]==='release'&&a[1]==='view'){
 if(config.releaseError)fail('HTTP 500 server error');
 if(config.friendly404&&!s.release)fail('release not found');
 if(!s.release)fail('HTTP 404: Not Found');
 out({isDraft:false,isPrerelease:!config.normal,immutable:!!config.immutable,url:'https://github.com/owner/repo/releases/tag/demo-videos',assets:s.assets});
}else if(a[0]==='release'&&a[1]==='create'){s.release=true;out('created')}
else if(a[0]==='release'&&a[1]==='upload'){
 if(config.immutable)fail('immutable');
 const f=a[3];s.assets.push({id:'asset-1',name:path.basename(f),size:fs.statSync(f).size,digest:'sha256:'+require('node:crypto').createHash('sha256').update(fs.readFileSync(f)).digest('hex'),url:'https://github.com/owner/repo/releases/download/demo-videos/'+path.basename(f)});out('uploaded');
}else if(a[0]==='pr'&&a[1]==='comment'){
 const body=fs.readFileSync(a[a.indexOf('--body-file')+1],'utf8');
 if(config.commentError){if(config.ambiguous)s.comments.push({body,user:{login:'me'},html_url:'https://github.com/comment/1'});fail('comment disconnected')}
 s.comments.push({body,user:{login:'me'},html_url:'https://github.com/comment/1'});out('https://github.com/comment/1');
}else if(a[0]==='api'){
 if(a[1]==='user')out({login:'me'});
 else if(a[1].includes('comments'))out(config.paged ? [[],s.comments] : s.comments);
 else if(a[1].includes('commits'))out('public-default-sha');
 else if(a[1].includes('releases/tags')){if(config.friendly404&&!s.release)fail('HTTP 404: Not Found');out({immutable:!!config.immutable})}
 else fail('unknown api '+a[1]);
}else fail('unknown '+a.join(' '));
`;

async function setup(options: Record<string, unknown> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'demo-publish-'));
  const sha = 'a'.repeat(40);
  await mkdir(join(dir, 'share'));
  await writeFile(join(dir, 'gh'), fakeGh); await chmod(join(dir, 'gh'), 0o755);
  const data = Buffer.from('test video bytes');
  await writeFile(join(dir, 'demo.mp4'), data);
  const manifest = { schemaVersion: 1, status: 'passed', runId: '20261025T000000Z-basic-abcdef', scenario: 'basic', createdAt: new Date().toISOString(), source: { headSha: sha, dirty: false }, output: { file: 'demo.mp4', bytes: data.length, sha256: createHash('sha256').update(data).digest('hex'), durationSeconds: 10, width: 2560, height: 1080, fps: 25 } };
  const config = { sha, ...options };
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest));
  await writeFile(join(dir, 'fake.json'), JSON.stringify(config));
  return { dir, manifest, config, args: { pr: 1, runDir: dir, repo: 'owner/repo', gh: join(dir, 'gh'), allowDirty: false } };
}

test('fake gh only: missing release creates prerelease on public default SHA, uploads once and comments once', async () => {
  const f = await setup();
  try {
    const result = await publishDemo(f.args);
    assert.equal(result.commentUrl, 'https://github.com/comment/1');
    await publishDemo(f.args);
    const s = JSON.parse(await readFile(join(f.dir, 'state.json'), 'utf8'));
    assert.equal(s.calls.filter((a: string[]) => a[0] === 'release' && a[1] === 'upload').length, 1);
    assert.equal(s.comments.length, 1);
    const create = s.calls.find((a: string[]) => a[0] === 'release' && a[1] === 'create');
    assert.ok(create.includes('public-default-sha')); assert.ok(create.includes('--latest=false'));
    assert.match(await readFile(join(f.dir, 'share/comment.md'), 'utf8'), /don-oogiri-demo:/);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

for (const option of ['authError', 'releaseError', 'normal', 'immutable', 'dirty', 'sha', 'tampered', 'failed', 'traversal']) {
  test(`publish fails closed before writes: ${option}`, async () => {
    const f = await setup({ existing: true, [option]: option === 'sha' ? 'b'.repeat(40) : true });
    try {
      if (option === 'dirty') f.manifest.source.dirty = true;
      if (option === 'failed') f.manifest.status = 'failed';
      if (option === 'traversal') f.manifest.output.file = '../demo.mp4';
      await writeFile(join(f.dir, 'manifest.json'), JSON.stringify(f.manifest));
      if (option === 'tampered') await writeFile(join(f.dir, 'demo.mp4'), 'changed');
      await assert.rejects(publishDemo(f.args));
      const s = JSON.parse(await readFile(join(f.dir, 'state.json'), 'utf8').catch(() => '{"calls":[]}'));
      assert.equal(s.calls.filter((a: string[]) => ['create', 'upload', 'comment'].includes(a[1])).length, 0);
    } finally { await rm(f.dir, { recursive: true, force: true }); }
  });
}

for (const ambiguous of [false, true]) {
  test(`comment failure preserves asset and retries without duplicate: ambiguous=${ambiguous}`, async () => {
    const f = await setup({ existing: true, commentError: true, ambiguous });
    try {
      await assert.rejects(publishDemo(f.args));
      assert.ok(JSON.parse(await readFile(join(f.dir, 'share/result.json'), 'utf8')).assetUrl);
      await writeFile(join(f.dir, 'fake.json'), JSON.stringify({ ...f.config, commentError: false }));
      await publishDemo(f.args);
      const s = JSON.parse(await readFile(join(f.dir, 'state.json'), 'utf8'));
      assert.equal(s.assets.length, 1); assert.equal(s.comments.length, 1);
    } finally { await rm(f.dir, { recursive: true, force: true }); }
  });
}

test('explicit allow-dirty marks comment, without allowing wrong head', async () => {
  const f = await setup({ existing: true });
  try {
    f.manifest.source.dirty = true;
    await writeFile(join(f.dir, 'manifest.json'), JSON.stringify(f.manifest));
    await publishDemo({ ...f.args, allowDirty: true });
    assert.match(await readFile(join(f.dir, 'share/comment.md'), 'utf8'), /未コミット変更を含むローカル撮影/);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});


test('publish CLI uses only the fake gh from PATH; successful rerun finds own marker on a later page', async () => {
  const f = await setup({ paged: true, friendly404: true });
  try {
    const exec = promisify(execFile);
    const args = ['demo:publish', '--pr', '1', '--run', f.dir, '--repo', 'owner/repo'];
    const options = { cwd: process.cwd(), env: { ...process.env, PATH: `${f.dir}:${process.env.PATH}` }, timeout: 30000 };
    const first = await exec('pnpm', args, options);
    assert.match(first.stdout, /https:\/\/github.com\/comment\/1/);
    await exec('pnpm', args, options);
    const state = JSON.parse(await readFile(join(f.dir, 'state.json'), 'utf8'));
    assert.equal(state.comments.length, 1); assert.equal(state.assets.length, 1);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test('PR head moving after upload prevents the comment and retains resumable asset', async () => {
  const f = await setup({ existing: true, moveHead: true });
  try {
    await assert.rejects(publishDemo(f.args), /head/);
    const state = JSON.parse(await readFile(join(f.dir, 'state.json'), 'utf8'));
    assert.equal(state.assets.length, 1); assert.equal(state.comments.length, 0);
    assert.ok(JSON.parse(await readFile(join(f.dir, 'share/result.json'), 'utf8')).assetUrl);
    await assert.rejects(publishDemo({ ...f.args, allowDirty: true }), /head/);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

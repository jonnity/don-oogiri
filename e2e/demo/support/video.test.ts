import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, stat, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { blackBoundary, trimStart, composeVideo, runMedia, probe } from './video';
import type { RecordingManifest, ScreenRole } from '../types';

test('calibration requires one sustained black interval and a <=100ms host roundtrip', () => {
  assert.equal(blackBoundary('black_start:0 black_end:0.8 black_duration:0.8'), .8);
  for (const text of ['', 'black_start:0 black_end:0.1 black_duration:0.1', 'black_start:0 black_end:0.8 black_duration:0.8\nblack_start:1 black_end:2 black_duration:1']) assert.throws(() => blackBoundary(text));
  assert.equal(trimStart(.8, { hostBeforeMs: 100, hostAfterMs: 140 }, 420), 1.1);
  assert.throws(() => trimStart(.8, { hostBeforeMs: 100, hostAfterMs: 201 }, 420));
});

test('real ffmpeg: offset calibration, three columns, padding, format, bounded two-pass and damaged input', { timeout: 120000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'demo-video-'));
  await Promise.all(['raw', 'work', 'logs'].map(d => mkdir(join(dir, d))));
  const recording: RecordingManifest = { schemaVersion: 1, status: 'passed', testCount: 1, startedMonoMs: 2000, endedMonoMs: 4000, screens: {} as RecordingManifest['screens'] };
  const sizes = { mc: [1120, 1040], projection: [960, 1040], audience: [390, 844] };
  try {
    for (const [i, role] of (['mc', 'projection', 'audience'] as ScreenRole[]).entries()) {
      const [width, height] = sizes[role];
      const boundary = .6 + i * .2;
      const file = `raw/${role}.webm`;
      // Same host timeline, differing recording starts. White calibration, then visible counter.
      await runMedia('ffmpeg', ['-y', '-f', 'lavfi', '-i', `color=black:s=${width}x${height}:r=25:d=${boundary}`, '-f', 'lavfi', '-i', `color=white:s=${width}x${height}:r=25:d=3.2`, '-filter_complex', `[0:v][1:v]concat=n=2:v=1:a=0,drawbox=x=0:y=0:w=iw:h=ih:color=red:t=fill:enable='between(t,${boundary + .9},${boundary + 1.3})',drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text='%{pts\\:flt\\:-${boundary}}':enable='gte(t,${boundary + .3})':x=100:y=100:fontsize=36:fontcolor=blue`, '-c:v', 'libvpx', '-threads', '2', join(dir, file)]);
      recording.screens[role] = { role, file, viewport: { width, height }, calibration: { hostBeforeMs: 1500, hostAfterMs: 1500 } };
    }
    const output = await composeVideo(dir, recording, 9 * 1024 * 1024);
    assert.equal(output.width, 2560); assert.equal(output.height, 1080);
    assert.ok(output.bytes > 0); assert.ok(Math.abs(output.durationSeconds - 2) < .2);
    assert.equal((await probe(join(dir, 'demo.mp4'))).streams[0].codec_name, 'h264');
    // A common host-time pulse must appear in all three columns after calibration.
    // Probe actual encoded pixels, including black header and phone aspect-ratio pad.
    const exec = promisify(execFile);
    for (const [seconds, red] of [[.2, false], [.6, true], [1.2, false]] as const) {
      const { stdout } = await exec('ffmpeg', ['-v', 'error', '-ss', String(seconds), '-i', join(dir, 'demo.mp4'), '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { encoding: 'buffer', maxBuffer: 10 * 1024 * 1024 });
      for (const x of [50, 1170, 2130]) {
        const offset = (300 * 2560 + x) * 3;
        assert.ok(stdout[offset] > 200);
        assert.equal(stdout[offset + 1] < 50, red, `time=${seconds}, column=${x}`);
      }
      // Label row corner is black, and the three frames start below it.
      assert.ok(stdout[(4 * 2560 + 2500) * 3] < 10);
    }
    for (const screen of Object.values(recording.screens)) assert.ok(Math.abs(screen.calibration.trimStartSeconds! - (screen.calibration.blackEndPtsSeconds! + .5)) < .001);
    await rm(join(dir, 'demo.mp4'));
    // Tiny limit must trigger exactly one two-pass attempt, then explicitly reject if insufficient.
    try { const small = await composeVideo(dir, recording, 5000); assert.ok(small.bytes <= 5000); }
    catch (error) { assert.match(String(error), /size|limit|容量|bitrate/i); }
    assert.ok((await stat(join(dir, 'work', 'pass-0.log'))).size > 0);
    // Input ends about 0.5s before this extended T1: <=1s may still use tpad.
    const padded = await composeVideo(dir, { ...recording, endedMonoMs: recording.endedMonoMs + 1200 }, 9 * 1024 * 1024);
    assert.ok(Math.abs(padded.durationSeconds - 3.2) < .2);
    await rm(join(dir, 'demo.mp4'));
    // More than one second of missing tail remains a recording error.
    await assert.rejects(composeVideo(dir, { ...recording, endedMonoMs: recording.endedMonoMs + 3000 }, 9 * 1024 * 1024), /interval too short/);
    await writeFile(join(dir, 'raw/mc.webm'), 'broken');
    await assert.rejects(composeVideo(dir, recording, 9 * 1024 * 1024));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

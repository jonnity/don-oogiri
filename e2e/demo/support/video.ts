import { execFile } from 'node:child_process';
import { appendFile, readFile, rename, stat, access } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { createHash } from 'node:crypto';
import type { DemoOutput, RecordingManifest, ScreenRecording } from '../types';
import { roles } from '../types';

export function mediaPath(kind: 'ffmpeg' | 'ffprobe'): string {
  const configured = process.env[kind === 'ffmpeg' ? 'DEMO_FFMPEG_PATH' : 'DEMO_FFPROBE_PATH'];
  if (configured && (!isAbsolute(configured) || /[\r\n]/.test(configured))) throw new Error(`DEMO_${kind.toUpperCase()}_PATH must be an absolute executable path`);
  return configured ?? kind;
}
export async function runMedia(kind: 'ffmpeg' | 'ffprobe', args: string[], signal?: AbortSignal, log?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(mediaPath(kind), ['-hide_banner', ...args], { timeout: 120000, maxBuffer: 16 * 1024 * 1024, signal }, (error, stdout, stderr) => {
      const output = stdout + stderr;
      const finish = () => error ? reject(new Error(`${kind} failed: ${error.message}\n${output.slice(-4000)}`)) : resolve(output);
      if (log) void appendFile(log, `$ ${kind} ${args.join(' ')}\n${output}\n`).then(finish, reject); else finish();
    });
  });
}
export interface ProbeResult {
  streams: { codec_type: string; codec_name: string; pix_fmt: string; width: number; height: number; r_frame_rate: string; nb_read_frames?: string; duration?: string }[];
  format: { duration: string };
}
export async function probe(file: string, signal?: AbortSignal): Promise<ProbeResult> {
  // ffprobe JSON is stdout only (warning/error diagnostics must never be parsed as JSON).
  return new Promise((resolve, reject) => {
    execFile(mediaPath('ffprobe'), ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', file], { timeout: 120000, maxBuffer: 4 * 1024 * 1024, signal }, (error, stdout, stderr) => {
      if (error) reject(new Error(`ffprobe failed: ${stderr || error.message}`));
      else { try { resolve(JSON.parse(stdout)); } catch (e) { reject(e); } }
    });
  });
}
export async function checkMediaTools(): Promise<string> {
  const [version, filters, encoders] = await Promise.all([runMedia('ffmpeg', ['-version']), runMedia('ffmpeg', ['-filters']), runMedia('ffmpeg', ['-encoders']), runMedia('ffprobe', ['-version'])]);
  for (const filter of ['blackdetect', 'trim', 'setpts', 'fps', 'scale', 'pad', 'tpad', 'drawtext', 'xstack']) {
    if (!new RegExp(`\\s${filter}\\s`).test(filters)) throw new Error(`Missing ffmpeg filter: ${filter}`);
  }
  if (!/\slibx264\s/.test(encoders)) throw new Error('Missing ffmpeg libx264 encoder');
  await access('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf');
  return version.split('\n')[0];
}
export function blackBoundary(log: string): number {
  const intervals = [...log.matchAll(/black_start:([\d.]+)\s+black_end:([\d.]+)\s+black_duration:([\d.]+)/g)].filter(m => Number(m[3]) >= .5);
  if (intervals.length !== 1 || Number(intervals[0][1]) > 2) throw new Error('Missing or ambiguous sustained calibration black boundary');
  return Number(intervals[0][2]);
}
export function trimStart(boundary: number, calibration: ScreenRecording['calibration'], startMs: number): number {
  const { hostBeforeMs: before, hostAfterMs: after } = calibration;
  if (![boundary, before, after, startMs].every(Number.isFinite) || after < before || after - before > 100 || startMs < after || boundary < 0) throw new Error('Invalid calibration timing (roundtrip must be <=100ms)');
  return boundary + (startMs - (before + after) / 2) / 1000;
}
export function videoFilter(starts: number[], duration: number): string {
  if (starts.length !== 3 || starts.some(s => !Number.isFinite(s) || s < 0) || !Number.isFinite(duration) || duration <= 0) throw new Error('Invalid trim values');
  const sizes = [1120, 960, 480];
  const labels = ['MC CONSOLE', 'PROJECTION', 'AUDIENCE'];
  return starts.map((s, i) => `[${i}:v]trim=start=${s},setpts=PTS-STARTPTS,fps=25,tpad=stop_mode=clone:stop_duration=1,trim=duration=${duration},scale=${sizes[i]}:1040${i === 2 ? ':force_original_aspect_ratio=decrease:force_divisible_by=2' : ''},pad=${sizes[i]}:1040:(ow-iw)/2:(oh-ih)/2:color=black,pad=${sizes[i]}:1080:0:40:color=black,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text='${labels[i]}':x=16:y=8:fontsize=24:fontcolor=white,setsar=1,format=yuv420p[v${i}]`).join(';') + ';[v0][v1][v2]xstack=inputs=3:layout=0_0|1120_0|2080_0:fill=black:shortest=1[out]';
}
export async function composeVideo(runDir: string, recording: RecordingManifest, maxBytes: number, signal?: AbortSignal): Promise<DemoOutput> {
  const duration = (recording.endedMonoMs - recording.startedMonoMs) / 1000;
  if (recording.schemaVersion !== 1 || recording.status !== 'passed' || recording.testCount !== 1 || !(duration > 0 && duration <= 90)) throw new Error('Invalid or failed recording');
  const starts: number[] = [];
  const inputs: string[] = [];
  const expectedSizes = { mc: [1120, 1040], projection: [960, 1040], audience: [390, 844] };
  const log = join(runDir, 'logs/ffmpeg.log');
  for (const role of roles) {
    const screen = recording.screens[role];
    if (!screen || screen.file !== `raw/${role}.webm`) throw new Error('Invalid recording file');
    const file = join(runDir, screen.file);
    const info = await probe(file, signal);
    const stream = info.streams.find(s => s.codec_type === 'video');
    const [width, height] = expectedSizes[role];
    if (!stream || stream.width !== width || stream.height !== height || Number(stream.nb_read_frames) <= 0) throw new Error(`Invalid input dimensions/frames: ${role}`);
    const detection = await runMedia('ffmpeg', ['-nostdin', '-threads', '2', '-i', file, '-vf', 'blackdetect=d=0.3:pix_th=0.02:pic_th=0.99', '-an', '-f', 'null', '-'], signal, log);
    const boundary = blackBoundary(detection);
    const start = trimStart(boundary, screen.calibration, recording.startedMonoMs);
    // At most one second of frame loss may be padded. The fixture supplies tail frames
    // after T1 rather than relaxing this recording-integrity check.
    if (!Number.isFinite(Number(info.format.duration)) || Number(info.format.duration) < start + duration - 1) throw new Error(`Recording interval too short: ${role}`);
    Object.assign(screen.calibration, { blackEndPtsSeconds: boundary, trimStartSeconds: start });
    starts.push(start); inputs.push('-threads', '2', '-i', file);
  }
  const base = ['-nostdin', '-y', ...inputs, '-filter_complex_threads', '2', '-filter_complex', videoFilter(starts, duration), '-map', '[out]', '-t', String(duration), '-an', '-c:v', 'libx264', '-threads', '2', '-preset', 'veryfast', '-pix_fmt', 'yuv420p'];
  let temporary = join(runDir, 'work/first.mp4');
  await runMedia('ffmpeg', [...base, '-crf', '23', '-movflags', '+faststart', temporary], signal, log);
  if ((await stat(temporary)).size > maxBytes) {
    const bitrate = Math.floor(maxBytes * 8 * .94 / duration);
    if (bitrate < 1000) throw new Error('Size limit too small: shorten the scenario or increase --max-mib');
    const twoPass = [...base, '-b:v', String(bitrate), '-passlogfile', join(runDir, 'work/pass')];
    await runMedia('ffmpeg', [...twoPass, '-pass', '1', '-f', 'mp4', '/dev/null'], signal, log);
    temporary = join(runDir, 'work/sized.mp4');
    await runMedia('ffmpeg', [...twoPass, '-pass', '2', '-movflags', '+faststart', temporary], signal, log);
  }
  const bytes = (await stat(temporary)).size;
  if (bytes <= 0 || bytes > maxBytes) throw new Error('Video exceeds size limit after two-pass encode; shorten scenario or increase --max-mib');
  const final = await probe(temporary, signal);
  const video = final.streams.find(s => s.codec_type === 'video');
  const actualDuration = Number(final.format.duration);
  if (!video || video.codec_name !== 'h264' || video.pix_fmt !== 'yuv420p' || video.width !== 2560 || video.height !== 1080 || video.r_frame_rate !== '25/1' || final.streams.some(s => s.codec_type === 'audio') || !Number.isFinite(actualDuration) || actualDuration <= 0 || Math.abs(actualDuration - duration) > .2) throw new Error('Final video format/duration validation failed');
  const sha256 = createHash('sha256').update(await readFile(temporary)).digest('hex');
  signal?.throwIfAborted();
  await rename(temporary, join(runDir, 'demo.mp4'));
  return { file: 'demo.mp4', bytes, sha256, durationSeconds: actualDuration, width: 2560, height: 1080, fps: 25 };
}

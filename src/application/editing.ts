import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { loadEditPlan } from '../editing/io.js';
import { createContactSheet, extractVideoFrame, inspectVideo } from '../media/inspection.js';
import type { EditPlan } from '../editing/model.js';

const exec = promisify(execFile);

export interface EditDeliveryCheck {
  id: string;
  status: 'pass' | 'fail';
  expected: unknown;
  actual: unknown;
}

function rationalNumber(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const parts = value.split('/');
  const numerator = Number(parts[0]);
  const denominator = Number(parts[1] ?? '1');
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0)
    return undefined;
  return numerator / denominator;
}

export function verifyEditDelivery(
  plan: EditPlan,
  media: Record<string, unknown>,
): { status: 'pass' | 'fail'; checks: EditDeliveryCheck[] } {
  const streams = Array.isArray(media.streams)
    ? (media.streams as Array<Record<string, unknown>>)
    : [];
  const format =
    media.format && typeof media.format === 'object'
      ? (media.format as Record<string, unknown>)
      : {};
  const video = streams.find((stream) => stream.codec_type === 'video') ?? {};
  const audio = streams.find((stream) => stream.codec_type === 'audio') ?? {};
  const totalFrames = plan.clips.reduce((sum, clip) => sum + clip.frames, 0);
  const expectedDuration = totalFrames / plan.fps;
  const actualDuration = Number(format.duration);
  const actualFrames = Number(video.nb_frames);
  const actualFps = rationalNumber(video.avg_frame_rate ?? video.r_frame_rate);
  const checks: EditDeliveryCheck[] = [];
  const add = (id: string, expected: unknown, actual: unknown, passed: boolean) =>
    checks.push({ id, status: passed ? 'pass' : 'fail', expected, actual });

  add(
    'video-codec',
    plan.delivery.codec,
    video.codec_name,
    video.codec_name === plan.delivery.codec,
  );
  add(
    'pixel-format',
    plan.delivery.pixelFormat,
    video.pix_fmt,
    video.pix_fmt === plan.delivery.pixelFormat,
  );
  add('width', plan.resolution.width, video.width, video.width === plan.resolution.width);
  add('height', plan.resolution.height, video.height, video.height === plan.resolution.height);
  add('frame-count', totalFrames, actualFrames, actualFrames === totalFrames);
  add('frame-rate', plan.fps, actualFps, actualFps === plan.fps);
  add(
    'duration',
    expectedDuration,
    actualDuration,
    Number.isFinite(actualDuration) &&
      Math.abs(actualDuration - expectedDuration) <= 0.5 / plan.fps,
  );
  add('audio-codec', 'aac', audio.codec_name, audio.codec_name === 'aac');
  add('audio-sample-rate', 48_000, Number(audio.sample_rate), Number(audio.sample_rate) === 48_000);
  add('audio-channels', 2, audio.channels, audio.channels === 2);

  return {
    status: checks.every((check) => check.status === 'pass') ? 'pass' : 'fail',
    checks,
  };
}

export async function assembleEdit(editPlanFile: string, outputDirectory: string) {
  const planFile = resolve(editPlanFile);
  const planDirectory = dirname(planFile);
  const plan = await loadEditPlan(planFile);
  const totalFrames = plan.clips.reduce((sum, clip) => sum + clip.frames, 0);
  const durationSeconds = totalFrames / plan.fps;
  const output = resolve(outputDirectory);
  await mkdir(output, { recursive: true });
  const clipPaths = plan.clips.map((clip) => resolve(planDirectory, clip.path));
  const audioPath = resolve(planDirectory, plan.audioPath);
  const video = join(output, `${plan.id.split('.').at(-1)}.mp4`);
  const concatInputs = plan.clips.map((_, index) => `[${index}:v]`).join('');
  await exec(
    'ffmpeg',
    [
      '-v',
      'error',
      ...clipPaths.flatMap((path) => ['-i', path]),
      '-i',
      audioPath,
      '-filter_complex',
      `${concatInputs}concat=n=${plan.clips.length}:v=1:a=0[v]`,
      '-map',
      '[v]',
      '-map',
      `${plan.clips.length}:a`,
      '-map_metadata',
      '-1',
      '-metadata',
      'creation_time=1970-01-01T00:00:00Z',
      '-frames:v',
      String(totalFrames),
      '-t',
      String(durationSeconds),
      '-r',
      String(plan.fps),
      '-c:v',
      'libx264',
      '-pix_fmt',
      plan.delivery.pixelFormat,
      '-threads:v',
      '1',
      '-x264-params',
      'threads=1:lookahead_threads=1:sliced_threads=0',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-threads:a',
      '1',
      '-fflags',
      '+bitexact',
      '-flags:v',
      '+bitexact',
      '-flags:a',
      '+bitexact',
      ...(plan.delivery.fastStart ? ['-movflags', '+faststart'] : []),
      '-y',
      video,
    ],
    { maxBuffer: 30 * 1024 * 1024 },
  );
  const media = await inspectVideo(video);
  const verification = verifyEditDelivery(plan, media);
  const frames = [];
  let cursor = 0;
  for (const clip of plan.clips) {
    const midpoint = (cursor + clip.frames / 2) / plan.fps;
    const path = join(output, `${String(frames.length + 1).padStart(2, '0')}-${clip.id}.png`);
    await extractVideoFrame(video, midpoint, path);
    frames.push({ clip: clip.id, frame: cursor + Math.floor(clip.frames / 2), path });
    cursor += clip.frames;
  }
  const contactSheet = join(output, 'contact-sheet.png');
  await createContactSheet(
    frames.map((frame) => frame.path),
    contactSheet,
    4,
  );
  const report = join(output, 'edit-report.json');
  await writeFile(
    report,
    `${JSON.stringify({ schemaVersion: 1, status: verification.status, planFile, totalFrames, durationSeconds, video, audioPath, frames, contactSheet, media, checks: verification.checks }, null, 2)}\n`,
    'utf8',
  );
  if (verification.status === 'fail') {
    const failed = verification.checks
      .filter((check) => check.status === 'fail')
      .map((check) => check.id);
    throw new Error(`Assembled edit failed delivery verification: ${failed.join(', ')}`);
  }
  return {
    plan: plan.id,
    totalFrames,
    durationSeconds,
    output,
    video,
    contactSheet,
    report,
    media,
    verification,
  };
}

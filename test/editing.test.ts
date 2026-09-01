import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { assembleEdit, verifyEditDelivery } from '../src/application/editing.js';
import { saveEditPlan } from '../src/editing/io.js';
import { editPlanSchema } from '../src/editing/model.js';

const exec = promisify(execFile);
let directory = '';
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = '';
});

function editPlan() {
  return editPlanSchema.parse({
    schemaVersion: 1,
    id: 'edit.delivery-test',
    fps: 24,
    resolution: { width: 540, height: 960 },
    clips: [
      { id: 'first', path: 'first.mp4', frames: 144 },
      { id: 'second', path: 'second.mp4', frames: 216 },
    ],
    audioPath: 'soundtrack.wav',
    delivery: { codec: 'h264', pixelFormat: 'yuv420p', fastStart: true },
  });
}

describe('frame-exact edit plans', () => {
  it('preserves an arbitrary ordered edit at exactly 360 frames', () => {
    const plan = editPlan();
    expect(plan.clips).toHaveLength(2);
    expect(plan.clips.reduce((sum, clip) => sum + clip.frames, 0)).toBe(360);
    expect(plan.clips.map((clip) => clip.id)).toEqual(['first', 'second']);
  });

  it('fails closed when the encoded delivery drifts from its edit contract', () => {
    const plan = editPlan();
    const passingMedia = {
      streams: [
        {
          codec_type: 'video',
          codec_name: 'h264',
          pix_fmt: 'yuv420p',
          width: 540,
          height: 960,
          avg_frame_rate: '24/1',
          nb_frames: '360',
        },
        { codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 2 },
      ],
      format: { duration: '15.000000' },
    };
    expect(verifyEditDelivery(plan, passingMedia)).toMatchObject({ status: 'pass' });

    const drifted = structuredClone(passingMedia);
    drifted.streams[0]!.nb_frames = '361';
    expect(verifyEditDelivery(plan, drifted)).toMatchObject({
      status: 'fail',
      checks: expect.arrayContaining([
        expect.objectContaining({ id: 'frame-count', status: 'fail' }),
      ]),
    });
  });

  it('assembles byte-identical delivery containers from identical persisted inputs', async () => {
    directory = await mkdtemp(join(tmpdir(), 'videoer-edit-determinism-'));
    const first = join(directory, 'first.mp4');
    const second = join(directory, 'second.mp4');
    const audio = join(directory, 'soundtrack.wav');
    await exec('ffmpeg', [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=#223355:s=64x64:r=24:d=0.5',
      '-frames:v',
      '12',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-y',
      first,
    ]);
    await exec('ffmpeg', [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=#553322:s=64x64:r=24:d=0.5',
      '-frames:v',
      '12',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-y',
      second,
    ]);
    await exec('ffmpeg', [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=220:sample_rate=48000:duration=1',
      '-ac',
      '2',
      '-c:a',
      'pcm_s24le',
      '-y',
      audio,
    ]);
    const planFile = await saveEditPlan(
      join(directory, 'edit-plan.json'),
      editPlanSchema.parse({
        schemaVersion: 1,
        id: 'edit.deterministic-fixture',
        fps: 24,
        resolution: { width: 64, height: 64 },
        clips: [
          { id: 'first', path: 'first.mp4', frames: 12 },
          { id: 'second', path: 'second.mp4', frames: 12 },
        ],
        audioPath: 'soundtrack.wav',
        delivery: { codec: 'h264', pixelFormat: 'yuv420p', fastStart: true },
      }),
    );
    const firstDelivery = await assembleEdit(planFile, join(directory, 'delivery-a'));
    const secondDelivery = await assembleEdit(planFile, join(directory, 'delivery-b'));
    const hash = async (path: string) =>
      createHash('sha256')
        .update(await readFile(path))
        .digest('hex');
    expect(await hash(secondDelivery.video)).toBe(await hash(firstDelivery.video));
  });
});

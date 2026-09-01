import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  contactSheetArgs,
  inspectBlackPixelPercentageInRegion,
  inspectBlackPixelPercentage,
  inspectWhitePixelPercentage,
  inspectWhitePixelPercentageInRegion,
  inspectImage,
} from '../src/media/inspection.js';
import { verifyImage } from '../src/verification/image.js';
import { blenderProbeDetail } from '../src/media/blender.js';
import { REQUIRED_FFMPEG_FILTERS } from '../src/media/dependencies.js';

let dir = '';
const exec = promisify(execFile);
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});
describe('media inspection', () => {
  it('doctor covers every deterministic audio-treatment filter', () => {
    expect(REQUIRED_FFMPEG_FILTERS).toEqual(
      expect.arrayContaining([
        'highpass',
        'lowpass',
        'acompressor',
        'extrastereo',
        'loudnorm',
        'afade',
        'adelay',
        'amix',
        'apad',
        'atrim',
        'aresample',
        'aformat',
      ]),
    );
  });
  it('reads PNG dimensions without a paid or network service', async () => {
    dir = await mkdtemp(join(tmpdir(), 'videoer-media-'));
    const path = join(dir, 'fixture.png');
    const bytes = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
    bytes.writeUInt32BE(320, 16);
    bytes.writeUInt32BE(180, 20);
    await writeFile(path, bytes);
    expect(await inspectImage(path)).toMatchObject({ format: 'png', width: 320, height: 180 });
    expect(await verifyImage(path, { width: 320, height: 180, formats: ['png'] })).toMatchObject({
      status: 'pass',
    });
  });
  it('builds reusable contact-sheet arguments', () => {
    expect(contactSheetArgs(['a.png', 'b.png'], 'sheet.jpg', 2)).toContain(
      'xstack=inputs=2:layout=0_0|w0_0:fill=black',
    );
    expect(contactSheetArgs(['only.png'], 'sheet.jpg', 4)).toEqual([
      '-i',
      'only.png',
      '-frames:v',
      '1',
      '-y',
      'sheet.jpg',
    ]);
  });
  it('measures black-frame coverage for fail-closed render visibility gates', async () => {
    dir = await mkdtemp(join(tmpdir(), 'videoer-black-frame-'));
    const black = join(dir, 'black.png');
    const white = join(dir, 'white.png');
    await exec('ffmpeg', [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=black:s=32x32:d=0.04',
      '-frames:v',
      '1',
      '-y',
      black,
    ]);
    await exec('ffmpeg', [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=white:s=32x32:d=0.04',
      '-frames:v',
      '1',
      '-y',
      white,
    ]);
    expect(await inspectBlackPixelPercentage(black)).toBe(100);
    expect(await inspectBlackPixelPercentage(white)).toBe(0);
    expect(await inspectWhitePixelPercentage(white)).toBe(100);
    expect(await inspectWhitePixelPercentage(black)).toBe(0);
  });
  it('measures highlight clipping inside a projected subject region', async () => {
    dir = await mkdtemp(join(tmpdir(), 'videoer-subject-highlight-'));
    const split = join(dir, 'split.png');
    await exec('ffmpeg', [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=black:s=32x16:d=0.04',
      '-vf',
      'drawbox=x=16:y=0:w=16:h=16:color=white:t=fill',
      '-frames:v',
      '1',
      '-y',
      split,
    ]);
    expect(
      await inspectWhitePixelPercentageInRegion(split, { x: 0, y: 0, width: 16, height: 16 }),
    ).toBe(0);
    expect(
      await inspectWhitePixelPercentageInRegion(split, { x: 16, y: 0, width: 16, height: 16 }),
    ).toBe(100);
    expect(
      await inspectBlackPixelPercentageInRegion(split, { x: 0, y: 0, width: 16, height: 16 }),
    ).toBe(100);
    expect(
      await inspectBlackPixelPercentageInRegion(split, { x: 16, y: 0, width: 16, height: 16 }),
    ).toBe(0);
  });
  it('explains Metal sandbox denial instead of recommending a renderer fallback', () => {
    expect(
      blenderProbeDetail({
        code: 139,
        output: 'blender::gpu::supports_barycentric_whitelist MTLCreateSystemDefaultDevice',
      }),
    ).toMatchObject({
      available: false,
      detail: expect.stringMatching(/approve host\/GPU execution.*docs\/install-blender\.md/),
    });
    expect(
      blenderProbeDetail({ code: 0, output: 'Blender 4.5.13 LTS\nVIDEOER_BLENDER_READY 4.5.13' }),
    ).toEqual({ available: true, detail: 'Blender 4.5.13 LTS' });
  });
});

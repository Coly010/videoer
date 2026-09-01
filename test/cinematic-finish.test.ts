import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cinematicFinishProfileSchema,
  createSoftAtmosphericFinishProfile,
} from '../src/finishing/model.js';
import { cinematicFinishFilter, renderCinematicFinish } from '../src/finishing/render.js';

const exec = promisify(execFile);
let directory: string | undefined;

afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

describe('renderer-independent cinematic finishing', () => {
  it('renders byte-identical restrained tonal, bloom, vignette and seeded-grain output', async () => {
    directory = await mkdtemp(join(tmpdir(), 'videoer-finish-test-'));
    const source = join(directory, 'source.mp4');
    await exec('ffmpeg', [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=320x180:rate=24:duration=0.5',
      '-frames:v',
      '12',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-threads:v',
      '1',
      '-y',
      source,
    ]);
    const profile = createSoftAtmosphericFinishProfile();
    const first = await renderCinematicFinish(source, join(directory, 'first.mp4'), profile);
    const second = await renderCinematicFinish(source, join(directory, 'second.mp4'), profile);
    expect(await readFile(first.outputVideo)).toEqual(await readFile(second.outputVideo));
    expect(await readFile(first.outputVideo)).not.toEqual(await readFile(source));
    expect(first.filter).toContain('colorchannelmixer');
    expect(first.filter).toContain('gblur');
    expect(first.filter).toContain(`all_seed=${profile.grain.seed}`);
    const stream = (first.media.streams as Array<Record<string, unknown>>)[0]!;
    expect(stream).toMatchObject({ width: 320, height: 180, nb_frames: '12' });
  }, 15_000);

  it('rejects unbounded finishing that would hide lighting or source quality', () => {
    const profile = createSoftAtmosphericFinishProfile();
    expect(() =>
      cinematicFinishProfileSchema.parse({
        ...profile,
        bloom: { ...profile.bloom, intensity: 0.8 },
      }),
    ).toThrow();
    expect(() =>
      cinematicFinishProfileSchema.parse({
        ...profile,
        grain: { ...profile.grain, strength: 30 },
      }),
    ).toThrow();
    expect(cinematicFinishFilter(profile)).toContain('[finished]');
  });
});

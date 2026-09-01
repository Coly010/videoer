import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { soundtrackPlanSchema } from '../src/audio/model.js';
import { renderSoundtrackPlan } from '../src/audio/render.js';
import { inspectVideo } from '../src/media/inspection.js';
import { renderSpeechWav } from '../src/speech/espeak.js';
import { createProductionSoundEffectRecipes } from '../src/audio/sound-effect-presets.js';
import { renderSoundEffectRecipe } from '../src/audio/sound-effect.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

describe('deterministic soundtrack planning', () => {
  it('renders provider-free speech as a first-class soundtrack cue', async () => {
    const root = await mkdtemp(join(tmpdir(), 'videoer-audio-speech-'));
    const plan = soundtrackPlanSchema.parse({
      schemaVersion: 1,
      id: 'audio.dialogue-test',
      durationSeconds: 3,
      sampleRate: 48000,
      channels: 2,
      cues: [
        {
          id: 'line-one',
          kind: 'speech',
          startSeconds: 0.25,
          endSeconds: 2.9,
          gain: 0.8,
          text: 'The next train leaves at midnight.',
          voice: 'en+f3',
          rate: 150,
          pitch: 45,
          purpose: 'dialogue conformance',
        },
      ],
    });
    const output = await renderSoundtrackPlan(plan, join(root, 'soundtrack.wav'));
    const inspection = await inspectVideo(output);
    expect(inspection).toMatchObject({
      format: expect.objectContaining({ duration: '3.000000' }),
    });
  }, 20_000);

  it('rejects speech that would be silently truncated by its cue interval', async () => {
    const root = await mkdtemp(join(tmpdir(), 'videoer-audio-speech-short-'));
    const plan = soundtrackPlanSchema.parse({
      schemaVersion: 1,
      id: 'audio.dialogue-too-short',
      durationSeconds: 1,
      sampleRate: 48000,
      channels: 2,
      cues: [
        {
          id: 'line-one',
          kind: 'speech',
          startSeconds: 0,
          endSeconds: 0.2,
          gain: 0.8,
          text: 'The next train leaves at midnight.',
          voice: 'en+f3',
          rate: 150,
          pitch: 45,
          purpose: 'negative conformance',
        },
      ],
    });
    await expect(renderSoundtrackPlan(plan, join(root, 'soundtrack.wav'))).rejects.toThrow(
      /interval is only/,
    );
  }, 20_000);

  it('mixes a resolved reusable audio artifact without regenerating it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'videoer-audio-source-'));
    const source = await renderSpeechWav(
      'Go.',
      { voice: 'en+f3', rate: 300, pitch: 45 },
      join(root, 'source.wav'),
    );
    const plan = soundtrackPlanSchema.parse({
      schemaVersion: 1,
      id: 'audio.reuse-test',
      durationSeconds: 1,
      sampleRate: 48000,
      channels: 2,
      cues: [
        {
          id: 'reused-line',
          kind: 'audio-source',
          source: 'dialogue-source',
          startSeconds: 0,
          endSeconds: 1,
          gain: 0.8,
          purpose: 'immutable library audio reuse',
        },
      ],
    });
    const output = await renderSoundtrackPlan(plan, join(root, 'mix.wav'), {
      audioSources: { 'dialogue-source': source },
    });
    expect(await inspectVideo(output)).toMatchObject({
      format: expect.objectContaining({ duration: '1.000000' }),
    });
    await expect(renderSoundtrackPlan(plan, join(root, 'missing.wav'))).rejects.toThrow(
      /no resolved source/,
    );
  }, 20_000);

  it('preserves independent stereo channels from reusable sound-effect sources', async () => {
    const root = await mkdtemp(join(tmpdir(), 'videoer-audio-stereo-source-'));
    const source = join(root, 'rain.wav');
    await renderSoundEffectRecipe(createProductionSoundEffectRecipes()[0]!, source);
    const plan = soundtrackPlanSchema.parse({
      schemaVersion: 1,
      id: 'audio.stereo-source-test',
      durationSeconds: 8,
      sampleRate: 48000,
      channels: 2,
      cues: [
        {
          id: 'rain-source',
          kind: 'audio-source',
          source: 'rain',
          startSeconds: 0,
          endSeconds: 8,
          gain: 0.8,
          purpose: 'stereo preservation regression',
        },
      ],
    });
    const output = await renderSoundtrackPlan(plan, join(root, 'mix.wav'), {
      audioSources: { rain: source },
    });
    const difference = await exec('ffmpeg', [
      '-v',
      'info',
      '-i',
      output,
      '-filter_complex',
      '[0:a]pan=mono|c0=c0-c1,volumedetect',
      '-f',
      'null',
      '-',
    ]);
    const maximumDifferenceDb = Number(
      difference.stderr.match(/max_volume:\s*(-?[0-9.]+) dB/u)?.[1],
    );
    expect(Number.isFinite(maximumDifferenceDb)).toBe(true);
    expect(maximumDifferenceDb).toBeGreaterThan(-50);
  }, 20_000);
});

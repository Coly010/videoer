import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { soundtrackPlanSchema } from '../src/audio/model.js';
import { renderSoundtrackPlan } from '../src/audio/render.js';
import {
  audioTreatmentSchema,
  renderAudioTreatment,
  verifyAudioTreatment,
} from '../src/audio/treatment.js';
import { sha256File } from '../src/assets/library.js';

describe('renderer-independent cinematic audio treatments', () => {
  it('derives a deterministic exact-duration master while preserving temporal structure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'videoer-audio-treatment-'));
    const source = join(root, 'source.wav');
    await renderSoundtrackPlan(
      soundtrackPlanSchema.parse({
        schemaVersion: 1,
        id: 'audio.treatment-fixture',
        durationSeconds: 4,
        sampleRate: 48000,
        channels: 2,
        cues: [
          {
            id: 'bed',
            kind: 'noise-bed',
            startSeconds: 0,
            endSeconds: 4,
            gain: 0.08,
            seed: 481,
            purpose: 'Deterministic temporal bed',
          },
          {
            id: 'accent',
            kind: 'tonal-accent',
            startSeconds: 1,
            endSeconds: 1.6,
            gain: 0.2,
            frequencyHz: 220,
            purpose: 'Measurable temporal accent',
          },
        ],
      }),
      source,
    );
    const treatment = audioTreatmentSchema.parse({
      kind: 'cinematic-audio-treatment-v1',
      assetId: 'audio.treatment-fixture-derived',
      sourceStartSeconds: 0.5,
      durationSeconds: 2.5,
      highpassHz: 90,
      lowpassHz: 9000,
      gainDb: -1.5,
      compressor: { thresholdDb: -20, ratio: 2, attackMs: 18, releaseMs: 180 },
      stereoWidth: 1.15,
      fadeInSeconds: 0.05,
      fadeOutSeconds: 0.12,
      targetIntegratedLufs: -18,
      truePeakDb: -1.5,
    });
    const first = join(root, 'first.wav');
    const second = join(root, 'second.wav');
    await renderAudioTreatment(source, first, treatment);
    await renderAudioTreatment(source, second, treatment);
    expect(await sha256File(first)).toBe(await sha256File(second));
    const verification = await verifyAudioTreatment(source, first, treatment);
    expect(verification).toMatchObject({
      valid: true,
      issues: [],
      adapted: { durationSeconds: 2.5, sampleRate: 48000, channels: 2, codec: 'pcm_s24le' },
      compatibility: {
        selectedIntervalPreserved: true,
        sampleRatePreservedAt48kHz: true,
        stereoPreserved: true,
        temporalEnvelopePreserved: true,
        deterministicRenderMatched: true,
      },
    });
  });

  it('rejects a candidate rendered from altered treatment semantics', async () => {
    const root = await mkdtemp(join(tmpdir(), 'videoer-audio-treatment-forgery-'));
    const source = join(root, 'source.wav');
    await renderSoundtrackPlan(
      soundtrackPlanSchema.parse({
        schemaVersion: 1,
        id: 'audio.treatment-forgery-fixture',
        durationSeconds: 2,
        sampleRate: 48000,
        channels: 2,
        cues: [
          {
            id: 'tone',
            kind: 'tone-bed',
            startSeconds: 0,
            endSeconds: 2,
            gain: 0.12,
            frequencyHz: 180,
            purpose: 'Forgery fixture',
          },
        ],
      }),
      source,
    );
    const declared = audioTreatmentSchema.parse({
      kind: 'cinematic-audio-treatment-v1',
      assetId: 'audio.treatment-forgery-derived',
      durationSeconds: 2,
      highpassHz: 50,
      lowpassHz: 12000,
      gainDb: -2,
      fadeInSeconds: 0.04,
      fadeOutSeconds: 0.08,
    });
    const candidate = join(root, 'candidate.wav');
    await renderAudioTreatment(source, candidate, { ...declared, gainDb: 6 });
    const verification = await verifyAudioTreatment(source, candidate, declared);
    expect(verification.valid).toBe(false);
    expect(verification.issues).toContain(
      'adapted output does not match deterministic treatment rendering',
    );
  });
});

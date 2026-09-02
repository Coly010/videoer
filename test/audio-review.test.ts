import { describe, expect, it } from 'vitest';
import { soundtrackPlanSchema } from '../src/audio/model.js';
import { soundMixReviewSchema, validateSoundMixReview } from '../src/audio/review.js';

const hash = 'a'.repeat(64);
const plan = soundtrackPlanSchema.parse({
  schemaVersion: 1,
  id: 'audio.portable-mix',
  durationSeconds: 4,
  sampleRate: 48000,
  channels: 2,
  cues: [
    {
      id: 'voice',
      kind: 'speech',
      startSeconds: 0,
      endSeconds: 2,
      gain: 0.8,
      text: 'Move.',
      voice: 'en+f3',
      rate: 220,
      pitch: 45,
      purpose: 'foreground direction',
    },
    {
      id: 'rain',
      kind: 'noise-bed',
      startSeconds: 0,
      endSeconds: 4,
      gain: 0.2,
      seed: 4,
      purpose: 'background weather',
    },
  ],
});
function candidate(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    decision: 'accepted',
    reviewer: 'independent listener',
    reviewedAt: '2026-09-02T12:00:00.000Z',
    asset: {
      id: 'audio.portable-mix',
      version: '1.0.0',
      masterPath: 'audio.wav',
      masterSha256: hash,
      provenancePath: 'provenance/source.yaml',
    },
    plan: { id: 'audio.portable-mix', sha256: hash },
    evidence: {
      isolated: ['verification/isolated/waveform.png', 'verification/isolated/spectrogram.png'],
      integrated: ['verification/integrated/contact-sheet.png', 'verification/integrated/mix.wav'],
      motion: ['verification/integrated/motion.mp4'],
    },
    hierarchy: { foregroundCueIds: ['voice'], supportCueIds: ['rain'] },
    masking: [
      {
        cueIds: ['voice', 'rain'],
        status: 'controlled',
        evidence: 'verification/integrated/mix.wav',
      },
    ],
    spatialDepth: [
      { cueId: 'voice', plane: 'foreground', evidence: 'verification/integrated/mix.wav' },
      { cueId: 'rain', plane: 'background', evidence: 'verification/integrated/mix.wav' },
    ],
    sync: [
      {
        cueId: 'voice',
        event: 'spoken direction onset',
        expectedSeconds: 0,
        observedSeconds: 0.02,
        toleranceSeconds: 0.05,
      },
    ],
    continuity: [
      {
        fromCueId: 'voice',
        toCueId: 'rain',
        status: 'intentional-cut',
        evidence: 'verification/integrated/motion.mp4',
      },
    ],
    materialIdentity: [
      {
        cueId: 'rain',
        intendedMaterial: 'rainfall',
        status: 'credible',
        evidence: 'verification/isolated/spectrogram.png',
      },
    ],
    strengths: ['speech remains legible over atmosphere'],
    limitations: ['not a surround or binaural approval'],
    notes: 'Reviewed in isolation and against picture.',
    ...overrides,
  };
}
describe('provenance-bound sound mix review', () => {
  it('accepts a reusable review tied to isolated, integrated, and motion evidence', () =>
    expect(validateSoundMixReview(soundMixReviewSchema.parse(candidate()), plan)).toMatchObject({
      valid: true,
      issues: [],
    }));
  it('rejects acceptance that hides unresolved masking', () =>
    expect(() =>
      soundMixReviewSchema.parse(
        candidate({
          masking: [
            {
              cueIds: ['voice', 'rain'],
              status: 'unresolved',
              evidence: 'verification/integrated/mix.wav',
            },
          ],
        }),
      ),
    ).toThrow(/unresolved masking/));
  it('does not let a review claim cues missing from the deterministic plan', () =>
    expect(
      validateSoundMixReview(
        soundMixReviewSchema.parse(
          candidate({
            spatialDepth: [
              {
                cueId: 'missing',
                plane: 'background',
                evidence: 'verification/integrated/mix.wav',
              },
            ],
          }),
        ),
        plan,
      ),
    ).toMatchObject({ valid: false, issues: ["spatial depth references unknown cue 'missing'"] }));
});

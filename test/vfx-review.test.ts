import { describe, expect, it } from 'vitest';
import { atmosphericVfxCandidateReviewSchema } from '../src/vfx/review.js';

describe('atmospheric VFX qualitative review', () => {
  it('records evidence, intended distance, strengths, and limitations', () => {
    const review = atmosphericVfxCandidateReviewSchema.parse({
      schemaVersion: 1,
      assetId: 'vfx.rainy-dusk-depth',
      decision: 'accepted',
      reviewer: 'Codex visual review',
      reviewedAt: '2026-09-01T05:00:00.000Z',
      intendedShotDistance: 'medium',
      evidence: ['a.png', 'b.png', 'c.mp4'],
      strengths: ['restrained scale'],
      limitations: ['not macro rain photography'],
      notes: 'Accepted only after full temporal and two-set transfer review.',
    });
    expect(review.decision).toBe('accepted');
  });

  it('rejects acceptance without a declared limitation', () => {
    expect(() =>
      atmosphericVfxCandidateReviewSchema.parse({
        schemaVersion: 1,
        assetId: 'vfx.rainy-dusk-depth',
        decision: 'accepted',
        reviewer: 'Codex visual review',
        reviewedAt: '2026-09-01T05:00:00.000Z',
        intendedShotDistance: 'medium',
        evidence: ['a.png', 'b.png', 'c.mp4'],
        strengths: ['restrained scale'],
        limitations: [],
        notes: 'Missing limitation must fail.',
      }),
    ).toThrow();
  });
});

import { describe, expect, it } from 'vitest';
import { lightingCandidateReviewSchema } from '../src/lighting/review.js';

describe('lighting candidate qualitative review', () => {
  it('requires explicit evidence, limitations, and portability judgement', () => {
    const review = lightingCandidateReviewSchema.parse({
      schemaVersion: 1,
      assetId: 'lighting.bookshop-warm-interior',
      decision: 'accepted',
      reviewer: 'codex-visual-inspection',
      reviewedAt: '2026-09-01T02:25:00.000Z',
      portableWithoutEnvironment: true,
      evidence: ['bookshop/contact-sheet.png', 'gallery/contact-sheet.png'],
      strengths: ['warm/cool separation survives unrelated set transfer'],
      limitations: ['not a candlelight or daylight rig'],
      notes: 'Accepted only for warm-interior key/fill/rim use.',
    });
    expect(review.decision).toBe('accepted');
    expect(review.portableWithoutEnvironment).toBe(true);
    expect(review.sourceEvidenceDirectory).toBe('verification');
    expect(review.transferEvidenceDirectory).toBe('verification/transfer/gallery');
  });

  it('rejects transfer evidence traversal outside the candidate', () => {
    expect(() =>
      lightingCandidateReviewSchema.parse({
        schemaVersion: 1,
        assetId: 'lighting.bookshop-warm-interior',
        decision: 'accepted',
        reviewer: 'codex',
        reviewedAt: '2026-09-01T02:25:00.000Z',
        portableWithoutEnvironment: true,
        transferEvidenceDirectory: '../forged-transfer',
        evidence: ['verification/source.png', 'verification/transfer.png'],
        strengths: ['bounded transfer'],
        limitations: ['not universal'],
        notes: 'Path must remain scoped.',
      }),
    ).toThrow(/inside the candidate directory/);
  });

  it('rejects unqualified acceptance with no limitations', () => {
    expect(() =>
      lightingCandidateReviewSchema.parse({
        schemaVersion: 1,
        assetId: 'lighting.bookshop-warm-interior',
        decision: 'accepted',
        reviewer: 'codex',
        reviewedAt: '2026-09-01T02:25:00.000Z',
        portableWithoutEnvironment: true,
        evidence: ['one.png'],
        strengths: [],
        limitations: [],
        notes: 'fine',
      }),
    ).toThrow();
  });
});

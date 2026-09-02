import { describe, expect, it } from 'vitest';
import { finishedVideoReviewSchema, qualityDomainIds, qualityScorecardSchema } from '../src/quality/model.js';

const domain = (id: (typeof import('../src/quality/model.js').qualityDomainIds)[number]) => ({
  id,
  status: 'baseline' as const,
  scores: { structuralCorrectness: 1, stillImageAppearance: 1, temporalBehaviour: 1, transfer: 1, reuseOutsideBenchmark: 1, visibleDeltaFromBaseline: 0 },
  canonicalProbes: [{ id: 'probe', evidence: ['evidence.png'] }],
  integratedEvidence: ['integrated.png'],
  findings: ['Known gap.'],
  nextAction: 'Improve it.',
});

describe('quality scorecard', () => {
  it('requires every production domain exactly once', () => {
    expect(() => qualityScorecardSchema.parse({ schemaVersion: 1, id: 'scorecard', baselineId: 'baseline', updatedAt: '2026-09-02', purpose: 'test', reviewCriteria: ['silhouette', 'scale', 'material-response', 'lighting-hierarchy', 'motion', 'continuity', 'atmosphere', 'compositing', 'audio'], domains: qualityDomainIds.map(domain), iterations: [] })).not.toThrow();
    expect(() => qualityScorecardSchema.parse({ schemaVersion: 1, id: 'scorecard', baselineId: 'baseline', updatedAt: '2026-09-02', purpose: 'test', reviewCriteria: ['silhouette', 'scale', 'material-response', 'lighting-hierarchy', 'motion', 'continuity', 'atmosphere', 'compositing', 'audio'], domains: qualityDomainIds.slice(0, -1).map(domain), iterations: [] })).toThrow();
  });

  it('no longer requires transfer/reuseOutsideBenchmark scores', () => {
    const withoutTransfer = domain(qualityDomainIds[0]);
    withoutTransfer.scores = { structuralCorrectness: 1, stillImageAppearance: 1, temporalBehaviour: 1, visibleDeltaFromBaseline: 0 } as never;
    expect(() =>
      qualityScorecardSchema.parse({
        schemaVersion: 1,
        id: 'scorecard',
        baselineId: 'baseline',
        updatedAt: '2026-09-02',
        purpose: 'test',
        reviewCriteria: ['silhouette', 'scale', 'material-response', 'lighting-hierarchy', 'motion', 'continuity', 'atmosphere', 'compositing', 'audio'],
        domains: [withoutTransfer, ...qualityDomainIds.slice(1).map(domain)],
        iterations: [],
      }),
    ).not.toThrow();
  });
});

describe('finished video review', () => {
  it('accepts a whole-video review with primary finished-output dimensions', () => {
    expect(() =>
      finishedVideoReviewSchema.parse({
        schemaVersion: 1,
        id: 'review-001',
        campaignId: 'campaigns/examples/saas-promo',
        renderReference: 'renders/final.mp4',
        reviewedAt: '2026-09-02',
        verdict: 'postable',
        scores: {
          hookStrength: 4,
          visualQuality: 4,
          shotCoherence: 4,
          motionQuality: 3,
          pacing: 4,
          typographyReadability: 5,
          audioImpact: 3,
          messageClarity: 4,
          ctaQuality: 4,
        },
        defects: [],
        economics: {
          techniqueSuitability: 'Screenshots + kinetic typography suited the feature announcement.',
          iterationCount: 2,
          visibleImprovementFromPreviousRevision: 'Tightened pacing on the hook beat.',
        },
        findings: ['Reads as a coherent product announcement.'],
        nextAction: 'Ship.',
      }),
    ).not.toThrow();
  });
});

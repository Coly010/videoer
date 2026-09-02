import { describe, expect, it } from 'vitest';
import { qualityDomainIds, qualityScorecardSchema } from '../src/quality/model.js';

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
});

import { z } from 'zod';

export const qualityDomainIds = [
  'environment-geometry-and-dressing',
  'portable-props',
  'materials-and-textures',
  'lighting',
  'atmosphere-compositing-and-vfx',
  'production-characters',
  'clothing-and-hair',
  'animation-and-interaction',
  'cameras',
  'sound-design-and-layering',
  'renderer-settings-and-final-image',
  'cross-renderer-runtime-transfer',
] as const;

const scoreSchema = z.object({
  structuralCorrectness: z.number().int().min(0).max(5),
  stillImageAppearance: z.number().int().min(0).max(5),
  temporalBehaviour: z.number().int().min(0).max(5),
  visibleDeltaFromBaseline: z.number().int().min(0).max(5),
  // Reuse/transfer are secondary engineering signals, not a substitute for finished-output
  // quality. See docs/quality-model.md and docs/product-principles.md.
  transfer: z.number().int().min(0).max(5).optional(),
  reuseOutsideBenchmark: z.number().int().min(0).max(5).optional(),
});

export const qualityScorecardSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(1),
    baselineId: z.string().min(1),
    updatedAt: z.string().date(),
    purpose: z.string().min(1),
    reviewCriteria: z.array(
      z.enum([
        'silhouette',
        'scale',
        'material-response',
        'lighting-hierarchy',
        'motion',
        'continuity',
        'atmosphere',
        'compositing',
        'audio',
      ]),
    ).min(9),
    domains: z
      .array(
        z.object({
          id: z.enum(qualityDomainIds),
          status: z.enum(['baseline', 'accepted', 'blocked', 'rejected']),
          scores: scoreSchema,
          canonicalProbes: z.array(z.object({ id: z.string().min(1), evidence: z.array(z.string().min(1)).min(1) })).min(1),
          integratedEvidence: z.array(z.string().min(1)).min(1),
          findings: z.array(z.string().min(1)).min(1),
          nextAction: z.string().min(1),
        }),
      )
      .length(qualityDomainIds.length),
    iterations: z.array(
      z.object({
        id: z.string().min(1),
        domains: z.array(z.enum(qualityDomainIds)).min(1),
        decision: z.enum(['accepted', 'rejected', 'queued']),
        evidence: z.array(z.string().min(1)).min(1),
        finding: z.string().min(1),
      }),
    ),
  })
  .superRefine((value, context) => {
    const ids = value.domains.map((domain) => domain.id);
    const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
    if (duplicate)
      context.addIssue({ code: 'custom', path: ['domains'], message: `duplicate domain '${duplicate}'` });
  });

export type QualityScorecard = z.infer<typeof qualityScorecardSchema>;

/**
 * Primary acceptance surface: does the finished, assembled video work as a marketing piece?
 * This outranks the subsystem scorecard above — see docs/product-principles.md priority order.
 */
export const finishedVideoReviewSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  campaignId: z.string().min(1),
  renderReference: z.string().min(1),
  reviewedAt: z.string().date(),
  verdict: z.enum(['postable', 'needs-revision', 'rejected']),
  scores: z.object({
    hookStrength: z.number().int().min(0).max(5),
    visualQuality: z.number().int().min(0).max(5),
    shotCoherence: z.number().int().min(0).max(5),
    motionQuality: z.number().int().min(0).max(5),
    pacing: z.number().int().min(0).max(5),
    typographyReadability: z.number().int().min(0).max(5),
    audioImpact: z.number().int().min(0).max(5),
    messageClarity: z.number().int().min(0).max(5),
    ctaQuality: z.number().int().min(0).max(5),
  }),
  defects: z.array(z.string().min(1)),
  economics: z.object({
    techniqueSuitability: z.string().min(1),
    iterationCount: z.number().int().min(0),
    renderCostMinutes: z.number().min(0).optional(),
    providerCostUsd: z.number().min(0).optional(),
    visibleImprovementFromPreviousRevision: z.string().min(1),
  }),
  findings: z.array(z.string().min(1)).min(1),
  nextAction: z.string().min(1),
});

export type FinishedVideoReview = z.infer<typeof finishedVideoReviewSchema>;

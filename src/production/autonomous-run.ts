import { z } from 'zod';

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const pathSchema = z.string().min(1);

export const productionReviewDimensionSchema = z.object({
  status: z.enum(['pass', 'fail', 'not-applicable']),
  observation: z.string().min(1),
});

export const cinematicProductionReviewSchema = z
  .object({
    schemaVersion: z.literal(1),
    campaignId: z.string().min(1),
    sourceSha256: sha256Schema,
    reviewer: z.string().min(1),
    reviewedAt: z.string().datetime(),
    shots: z.array(
      z.object({
        id: z.string().regex(/^[a-z][a-z0-9-]*$/),
        inputSha256: sha256Schema,
        contactSheet: pathSchema,
        dimensions: z.object({
          framing: productionReviewDimensionSchema,
          motion: productionReviewDimensionSchema,
          continuity: productionReviewDimensionSchema,
          lighting: productionReviewDimensionSchema,
          editorial: productionReviewDimensionSchema,
        }),
        verdict: z.enum(['pass', 'fail']),
        repair: z.string().min(1).optional(),
      }),
    ),
    final: z.object({
      deliveryInputSha256: sha256Schema,
      contactSheet: pathSchema,
      dimensions: z.object({
        pacing: productionReviewDimensionSchema,
        continuity: productionReviewDimensionSchema,
        audio: productionReviewDimensionSchema,
        editorial: productionReviewDimensionSchema,
        composition: productionReviewDimensionSchema,
      }),
      verdict: z.enum(['pass', 'fail']),
      repair: z.string().min(1).optional(),
    }),
  })
  .superRefine((review, context) => {
    const shotIds = new Set<string>();
    review.shots.forEach((shot, index) => {
      if (shotIds.has(shot.id))
        context.addIssue({
          code: 'custom',
          path: ['shots', index, 'id'],
          message: `duplicate reviewed shot '${shot.id}'`,
        });
      shotIds.add(shot.id);
      const failedDimension = Object.values(shot.dimensions).some(
        (dimension) => dimension.status === 'fail',
      );
      if ((failedDimension || shot.verdict === 'fail') && !shot.repair)
        context.addIssue({
          code: 'custom',
          path: ['shots', index, 'repair'],
          message: 'failed shot review requires a concrete repair instruction',
        });
      if (shot.verdict === 'pass' && failedDimension)
        context.addIssue({
          code: 'custom',
          path: ['shots', index, 'verdict'],
          message: 'shot cannot pass while a review dimension fails',
        });
    });
    const finalFailure = Object.values(review.final.dimensions).some(
      (dimension) => dimension.status === 'fail',
    );
    if ((finalFailure || review.final.verdict === 'fail') && !review.final.repair)
      context.addIssue({
        code: 'custom',
        path: ['final', 'repair'],
        message: 'failed final review requires a concrete repair instruction',
      });
    if (review.final.verdict === 'pass' && finalFailure)
      context.addIssue({
        code: 'custom',
        path: ['final', 'verdict'],
        message: 'final review cannot pass while a review dimension fails',
      });
  });

export type CinematicProductionReview = z.infer<typeof cinematicProductionReviewSchema>;

const shotStateSchema = z.object({
  id: z.string(),
  inputSha256: sha256Schema,
  renderInputSha256: sha256Schema.optional(),
  videoSha256: sha256Schema.optional(),
  status: z.enum(['pass', 'fail']),
  renderedAt: z.string().datetime(),
  evidenceRefreshedAt: z.string().datetime().optional(),
  video: pathSchema.optional(),
  contactSheet: pathSchema.optional(),
  report: pathSchema.optional(),
  error: z.string().optional(),
});

const attemptSchema = z.object({
  id: z.string(),
  kind: z.enum(['initial', 'repair', 'resume']),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  elapsedMilliseconds: z.number().nonnegative(),
  sourceSha256: sha256Schema,
  requestedShots: z.array(z.string()),
  staleShots: z.array(z.string()),
  renderedShots: z.array(z.string()),
  evidenceRefreshedShots: z.array(z.string()).default([]),
  reusedShots: z.array(z.string()),
  failedShots: z.array(z.string()),
  deliveryAssembled: z.boolean(),
  stages: z.array(
    z.object({
      id: z.enum([
        'analyse',
        'plan',
        'resolve',
        'build-assets',
        'build-scenes',
        'render-shots',
        'objective-inspection',
        'assemble-delivery',
        'qualitative-review',
        'publish-ready',
      ]),
      status: z.enum(['pass', 'fail', 'skipped', 'awaiting-review']),
      artifacts: z.array(pathSchema).default([]),
      detail: z.string().min(1),
    }),
  ),
});

export const cinematicProductionRunSchema = z.object({
  schemaVersion: z.literal(1),
  campaignId: z.string(),
  campaignFile: pathSchema,
  sourceSha256: sha256Schema,
  status: z.enum(['needs-repair', 'awaiting-review', 'completed']),
  productionPlan: pathSchema,
  assetManifest: pathSchema,
  buildReport: pathSchema,
  reviewTemplate: pathSchema,
  deliveryInputSha256: sha256Schema.optional(),
  delivery: pathSchema.optional(),
  finalContactSheet: pathSchema.optional(),
  shots: z.array(shotStateSchema),
  attempts: z.array(attemptSchema),
  acceptedReview: pathSchema.optional(),
  updatedAt: z.string().datetime(),
});

export type CinematicProductionRun = z.infer<typeof cinematicProductionRunSchema>;

export function selectStaleProductionShots(
  current: Array<{ id: string; inputSha256: string }>,
  previous: Array<{ id: string; inputSha256: string; status: 'pass' | 'fail' }>,
  requested: string[] = [],
) {
  const previousById = new Map(previous.map((shot) => [shot.id, shot]));
  const requestedSet = new Set(requested);
  return current
    .filter((shot) => {
      const prior = previousById.get(shot.id);
      return (
        requestedSet.has(shot.id) ||
        !prior ||
        prior.status !== 'pass' ||
        prior.inputSha256 !== shot.inputSha256
      );
    })
    .map((shot) => shot.id);
}

export function selectCinematicProductionWork(
  current: Array<{ id: string; inputSha256: string; renderInputSha256: string }>,
  previous: Array<{
    id: string;
    inputSha256: string;
    renderInputSha256?: string;
    status: 'pass' | 'fail';
    videoAvailable: boolean;
    evidenceAvailable: boolean;
  }>,
  requested: string[] = [],
) {
  const previousById = new Map(previous.map((shot) => [shot.id, shot]));
  const requestedSet = new Set(requested);
  const renderShots: string[] = [];
  const evidenceShots: string[] = [];
  for (const shot of current) {
    const prior = previousById.get(shot.id);
    const renderStale =
      requestedSet.has(shot.id) ||
      !prior ||
      !prior.videoAvailable ||
      prior.renderInputSha256 !== shot.renderInputSha256;
    const evidenceStale =
      renderStale ||
      !prior ||
      !prior.evidenceAvailable ||
      prior.status !== 'pass' ||
      prior.inputSha256 !== shot.inputSha256;
    if (renderStale) renderShots.push(shot.id);
    if (evidenceStale) evidenceShots.push(shot.id);
  }
  return {
    renderShots,
    evidenceShots,
    evidenceOnlyShots: evidenceShots.filter((shot) => !renderShots.includes(shot)),
  };
}

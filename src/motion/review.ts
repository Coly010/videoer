import { resolve, relative, isAbsolute } from 'node:path';
import { z } from 'zod';
import { sha256File } from '../assets/library.js';

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const evidenceRoleSchema = z.enum([
  'motion',
  'mechanical-report',
  'side-video',
  'side-contact-sheet',
  'three-quarter-video',
  'three-quarter-contact-sheet',
]);

export const motionReviewDimensionSchema = z.object({
  status: z.enum(['pass', 'fail', 'not-applicable']),
  observation: z.string().min(1),
});

export const motionVisualReviewSchema = z
  .object({
    schemaVersion: z.literal(1),
    motionId: z.string().min(1),
    reviewer: z.string().min(1),
    reviewedAt: z.string().datetime(),
    evidence: z
      .array(
        z.object({
          role: evidenceRoleSchema,
          path: z.string().min(1),
          sha256: sha256Schema,
        }),
      )
      .length(evidenceRoleSchema.options.length),
    dimensions: z.object({
      directionality: motionReviewDimensionSchema,
      anatomicalFootOrder: motionReviewDimensionSchema,
      temporalSmoothness: motionReviewDimensionSchema,
      plantedContact: motionReviewDimensionSchema,
      weightTransfer: motionReviewDimensionSchema,
      torsoCountermotion: motionReviewDimensionSchema,
      armDynamics: motionReviewDimensionSchema,
      footRoll: motionReviewDimensionSchema,
      silhouetteSeparation: motionReviewDimensionSchema,
      humanDeformation: motionReviewDimensionSchema,
    }),
    verdict: z.enum(['accepted', 'rejected']),
    repairs: z.array(z.string().min(1)),
  })
  .superRefine((review, context) => {
    const roles = new Set(review.evidence.map((artifact) => artifact.role));
    for (const role of evidenceRoleSchema.options) {
      if (!roles.has(role))
        context.addIssue({
          code: 'custom',
          path: ['evidence'],
          message: `motion review lacks '${role}' evidence`,
        });
    }
    if (roles.size !== review.evidence.length)
      context.addIssue({
        code: 'custom',
        path: ['evidence'],
        message: 'motion review evidence roles must be unique',
      });

    const failed = Object.values(review.dimensions).some(
      (dimension) => dimension.status === 'fail',
    );
    if (review.verdict === 'accepted' && failed)
      context.addIssue({
        code: 'custom',
        path: ['verdict'],
        message: 'motion cannot be accepted while a visual dimension fails',
      });
    if (review.verdict === 'rejected' && !failed)
      context.addIssue({
        code: 'custom',
        path: ['verdict'],
        message: 'motion cannot be rejected without a failed visual dimension',
      });
    if (review.verdict === 'rejected' && review.repairs.length === 0)
      context.addIssue({
        code: 'custom',
        path: ['repairs'],
        message: 'rejected motion requires at least one concrete repair instruction',
      });
  });

export type MotionVisualReview = z.infer<typeof motionVisualReviewSchema>;

function containedEvidencePath(baseDirectory: string, path: string) {
  const target = resolve(baseDirectory, path);
  const relation = relative(resolve(baseDirectory), target);
  if (
    isAbsolute(path) ||
    relation === '..' ||
    relation.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
  )
    throw new Error(`Motion review evidence escapes its review root: ${path}`);
  return target;
}

export async function verifyMotionReviewEvidence(
  review: MotionVisualReview,
  reviewRootDirectory: string,
) {
  const checked = await Promise.all(
    review.evidence.map(async (artifact) => {
      const actualSha256 = await sha256File(
        containedEvidencePath(reviewRootDirectory, artifact.path),
      );
      return {
        ...artifact,
        actualSha256,
        valid: actualSha256 === artifact.sha256,
      };
    }),
  );
  return {
    valid: checked.every((artifact) => artifact.valid),
    artifacts: checked,
  };
}

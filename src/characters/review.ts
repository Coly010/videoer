import { isAbsolute, relative, resolve } from 'node:path';
import { z } from 'zod';
import { sha256File } from '../assets/library.js';

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const evidenceRoleSchema = z.enum([
  'geometry',
  'anatomy-report',
  'canonical-contact-sheet',
  'face-close-up',
  'turntable',
  'walk-report',
  'walk-side-contact-sheet',
  'walk-three-quarter-contact-sheet',
  'walk-side-video',
  'walk-three-quarter-video',
]);

const visualDimensionSchema = z.object({
  status: z.enum(['pass', 'fail', 'not-applicable']),
  observation: z.string().min(1),
});

export const characterVisualReviewSchema = z
  .object({
    schemaVersion: z.literal(1),
    characterId: z.string().min(1),
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
      topologyContinuity: visualDimensionSchema,
      deformationMechanics: visualDimensionSchema,
      bodyProportions: visualDimensionSchema,
      jointContours: visualDimensionSchema,
      hands: visualDimensionSchema,
      feet: visualDimensionSchema,
      face: visualDimensionSchema,
      hair: visualDimensionSchema,
      silhouette: visualDimensionSchema,
      motionNaturalism: visualDimensionSchema,
      materialResponse: visualDimensionSchema,
    }),
    verdict: z.enum(['accepted', 'rejected']),
    repairs: z.array(z.string().min(1)),
  })
  .superRefine((review, context) => {
    const roles = new Set(review.evidence.map((artifact) => artifact.role));
    for (const role of evidenceRoleSchema.options)
      if (!roles.has(role))
        context.addIssue({
          code: 'custom',
          path: ['evidence'],
          message: `character review lacks '${role}' evidence`,
        });
    if (roles.size !== review.evidence.length)
      context.addIssue({
        code: 'custom',
        path: ['evidence'],
        message: 'character review evidence roles must be unique',
      });
    const failed = Object.values(review.dimensions).some(
      (dimension) => dimension.status === 'fail',
    );
    if (review.verdict === 'accepted' && failed)
      context.addIssue({
        code: 'custom',
        path: ['verdict'],
        message: 'character cannot be accepted while a visual dimension fails',
      });
    if (review.verdict === 'rejected' && !failed)
      context.addIssue({
        code: 'custom',
        path: ['verdict'],
        message: 'character cannot be rejected without a failed visual dimension',
      });
    if (review.verdict === 'rejected' && review.repairs.length === 0)
      context.addIssue({
        code: 'custom',
        path: ['repairs'],
        message: 'rejected character requires concrete repair instructions',
      });
  });

export type CharacterVisualReview = z.infer<typeof characterVisualReviewSchema>;

function containedPath(rootDirectory: string, path: string) {
  const root = resolve(rootDirectory);
  const target = resolve(root, path);
  const relation = relative(root, target);
  if (
    isAbsolute(path) ||
    relation === '..' ||
    relation.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
  )
    throw new Error(`Character review evidence escapes its review root: ${path}`);
  return target;
}

export async function verifyCharacterReviewEvidence(
  review: CharacterVisualReview,
  rootDirectory: string,
) {
  const artifacts = await Promise.all(
    review.evidence.map(async (artifact) => {
      const actualSha256 = await sha256File(containedPath(rootDirectory, artifact.path));
      return { ...artifact, actualSha256, valid: artifact.sha256 === actualSha256 };
    }),
  );
  return { valid: artifacts.every((artifact) => artifact.valid), artifacts };
}

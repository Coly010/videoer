import { isAbsolute, relative, resolve } from 'node:path';
import { z } from 'zod';
import { sha256File } from '../assets/library.js';

export const faceEvidenceRoles = [
  'geometry',
  'mechanical-report',
  'neutral-front',
  'neutral-three-quarter',
  'smile',
  'jaw-open',
  'blink',
] as const;
const evidenceRoleSchema = z.enum(faceEvidenceRoles);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const dimensionSchema = z.object({
  status: z.enum(['pass', 'fail']),
  observation: z.string().min(1),
});

export const faceVisualReviewSchema = z
  .object({
    schemaVersion: z.literal(1),
    characterId: z.string().min(1),
    reviewer: z.string().min(1),
    reviewedAt: z.string().datetime(),
    evidence: z
      .array(z.object({ role: evidenceRoleSchema, path: z.string().min(1), sha256: sha256Schema }))
      .length(faceEvidenceRoles.length),
    dimensions: z.object({
      identityDifferentiation: dimensionSchema,
      craniumJawAndChin: dimensionSchema,
      eyesBrowsAndLids: dimensionSchema,
      noseAndCheeks: dimensionSchema,
      lipsAndOralCavity: dimensionSchema,
      expressionDeformation: dimensionSchema,
      skinAndLandmarkResponse: dimensionSchema,
    }),
    verdict: z.enum(['accepted', 'rejected']),
    repairs: z.array(z.string().min(1)),
  })
  .superRefine((review, context) => {
    const roles = new Set(review.evidence.map((artifact) => artifact.role));
    for (const role of faceEvidenceRoles)
      if (!roles.has(role))
        context.addIssue({
          code: 'custom',
          path: ['evidence'],
          message: `face review lacks '${role}' evidence`,
        });
    if (roles.size !== review.evidence.length)
      context.addIssue({
        code: 'custom',
        path: ['evidence'],
        message: 'face review evidence roles must be unique',
      });
    const failed = Object.values(review.dimensions).some(
      (dimension) => dimension.status === 'fail',
    );
    if (review.verdict === 'accepted' && failed)
      context.addIssue({
        code: 'custom',
        path: ['verdict'],
        message: 'face cannot be accepted while a visual dimension fails',
      });
    if (review.verdict === 'rejected' && !failed)
      context.addIssue({
        code: 'custom',
        path: ['verdict'],
        message: 'face cannot be rejected without a failed visual dimension',
      });
    if (review.verdict === 'rejected' && review.repairs.length === 0)
      context.addIssue({
        code: 'custom',
        path: ['repairs'],
        message: 'rejected face requires concrete repair instructions',
      });
  });

export type FaceVisualReview = z.infer<typeof faceVisualReviewSchema>;

function containedPath(rootDirectory: string, path: string) {
  const root = resolve(rootDirectory);
  const target = resolve(root, path);
  const relation = relative(root, target);
  if (
    isAbsolute(path) ||
    relation === '..' ||
    relation.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
  )
    throw new Error(`Face review evidence escapes its review root: ${path}`);
  return target;
}

export async function verifyFaceReviewEvidence(review: FaceVisualReview, rootDirectory: string) {
  const artifacts = await Promise.all(
    review.evidence.map(async (artifact) => {
      const actualSha256 = await sha256File(containedPath(rootDirectory, artifact.path));
      return { ...artifact, actualSha256, valid: artifact.sha256 === actualSha256 };
    }),
  );
  return { valid: artifacts.every((artifact) => artifact.valid), artifacts };
}

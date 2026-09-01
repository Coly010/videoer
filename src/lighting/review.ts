import { z } from 'zod';

const relativeEvidencePathSchema = z
  .string()
  .min(1)
  .refine((value) => !value.startsWith('/') && !value.split('/').includes('..'), {
    message: 'lighting evidence paths must remain inside the candidate directory',
  });

export const lightingCandidateReviewSchema = z.object({
  schemaVersion: z.literal(1),
  assetId: z.string().regex(/^lighting\.[a-z0-9-]+(?:\.[a-z0-9-]+)*$/),
  decision: z.enum(['accepted', 'rejected']),
  reviewer: z.string().min(1),
  reviewedAt: z.string().datetime(),
  portableWithoutEnvironment: z.boolean(),
  sourceEvidenceDirectory: relativeEvidencePathSchema.default('verification'),
  transferEvidenceDirectory: relativeEvidencePathSchema.default('verification/transfer/gallery'),
  evidence: z.array(relativeEvidencePathSchema).min(2),
  strengths: z.array(z.string().min(1)).min(1),
  limitations: z.array(z.string().min(1)).min(1),
  notes: z.string().min(1),
});

export type LightingCandidateReview = z.infer<typeof lightingCandidateReviewSchema>;

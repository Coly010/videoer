import { z } from 'zod';

export const hairCandidateReviewSchema = z.object({
  schemaVersion: z.literal(1),
  assetId: z.string().regex(/^hair\.[a-z0-9-]+(?:\.[a-z0-9-]+)*$/),
  decision: z.enum(['accepted', 'rejected']),
  reviewer: z.string().min(1),
  reviewedAt: z.string().datetime(),
  intendedShotDistance: z.literal('medium'),
  evidence: z.array(z.string().min(1)).min(4),
  assessments: z.object({
    silhouette: z.enum(['pass', 'fail']),
    hairlineAndScalpCoverage: z.enum(['pass', 'fail']),
    crownToNapeFlow: z.enum(['pass', 'fail']),
    bunIntegration: z.enum(['pass', 'fail']),
    materialResponse: z.enum(['pass', 'fail']),
    unrelatedTargetTransfer: z.enum(['pass', 'fail']),
  }),
  strengths: z.array(z.string().min(1)).min(1),
  limitations: z.array(z.string().min(1)).min(1),
  notes: z.string().min(1),
});

export type HairCandidateReview = z.infer<typeof hairCandidateReviewSchema>;

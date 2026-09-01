import { z } from 'zod';

export const portableFixtureCandidateReviewSchema = z.object({
  schemaVersion: z.literal(1),
  assetId: z.string().regex(/^prop\.[a-z0-9-]+(?:\.[a-z0-9-]+)*$/),
  fixtureId: z.string().regex(/^fixture\.[a-z0-9-]+(?:\.[a-z0-9-]+)*$/),
  decision: z.enum(['accepted', 'rejected']),
  reviewer: z.string().min(1),
  reviewedAt: z.string().datetime(),
  intendedShotDistance: z.enum(['background', 'medium', 'close', 'hero-close']),
  evidence: z.array(z.string().min(1)).min(2),
  strengths: z.array(z.string().min(1)).min(1),
  limitations: z.array(z.string().min(1)).min(1),
  notes: z.string().min(1),
});

import { z } from 'zod';

export const environmentalSurfaceSuiteReviewSchema = z.object({
  schemaVersion: z.literal(1),
  materialAssetIds: z.array(z.string().regex(/^material\.[a-z0-9-]+(?:\.[a-z0-9-]+)*$/)).length(7),
  decision: z.enum(['accepted', 'rejected']),
  reviewer: z.string().min(1),
  reviewedAt: z.string().datetime(),
  intendedShotDistance: z.enum(['background', 'medium', 'close', 'hero-close']),
  strengths: z.array(z.string().min(1)).min(1),
  limitations: z.array(z.string().min(1)).min(1),
  notes: z.string().min(1),
});

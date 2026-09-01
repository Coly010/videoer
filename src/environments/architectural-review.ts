import { z } from 'zod';

export const architecturalWindowCandidateReviewSchema = z.object({
  schemaVersion: z.literal(1),
  assetId: z.string().regex(/^prop\.[a-z0-9-]+(?:\.[a-z0-9-]+)*$/),
  decision: z.enum(['accepted', 'rejected']),
  reviewer: z.string().min(1),
  reviewedAt: z.string().datetime(),
  intendedShotDistance: z.enum(['background', 'medium', 'close', 'hero-close']),
  evidence: z.array(z.string().min(1)).min(6),
  strengths: z.array(z.string().min(1)).min(1),
  limitations: z.array(z.string().min(1)).min(1),
  notes: z.string().min(1),
});

export const architecturalRainwaterCandidateReviewSchema = z.object({
  schemaVersion: z.literal(1),
  assetId: z.literal('prop.architectural-rainwater-system'),
  decision: z.enum(['accepted', 'rejected']),
  reviewer: z.string().min(1),
  reviewedAt: z.string().datetime(),
  intendedShotDistance: z.enum(['background', 'medium', 'close', 'hero-close']),
  evidence: z.array(z.string().min(1)).min(6),
  strengths: z.array(z.string().min(1)).min(1),
  limitations: z.array(z.string().min(1)).min(1),
  notes: z.string().min(1),
});

export const projectingSignCandidateReviewSchema = z.object({
  schemaVersion: z.literal(1),
  assetId: z.literal('prop.projecting-hanging-sign'),
  decision: z.enum(['accepted', 'rejected']),
  reviewer: z.string().min(1),
  reviewedAt: z.string().datetime(),
  intendedShotDistance: z.enum(['background', 'medium', 'close', 'hero-close']),
  evidence: z.array(z.string().min(1)).min(6),
  strengths: z.array(z.string().min(1)).min(1),
  limitations: z.array(z.string().min(1)).min(1),
  notes: z.string().min(1),
});

export const projectingCanopyCandidateReviewSchema = z.object({
  schemaVersion: z.literal(1),
  assetId: z.literal('prop.projecting-supported-canopy'),
  decision: z.enum(['accepted', 'rejected']),
  reviewer: z.string().min(1),
  reviewedAt: z.string().datetime(),
  intendedShotDistance: z.enum(['background', 'medium', 'close', 'hero-close']),
  evidence: z.array(z.string().min(1)).min(6),
  strengths: z.array(z.string().min(1)).min(1),
  limitations: z.array(z.string().min(1)).min(1),
  notes: z.string().min(1),
});

import { z } from 'zod';
import { soundtrackPlanSchema, type SoundtrackPlan } from './model.js';

const relativeEvidencePathSchema = z
  .string()
  .min(1)
  .refine((value) => !value.startsWith('/') && !value.split('/').includes('..'), {
    message: 'sound review evidence must remain inside the published audio asset directory',
  });
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const cueIdsSchema = z.array(z.string().regex(/^[a-z][a-z0-9-]*$/)).min(1);

/** A human judgement bound to immutable audio and deterministic render evidence. */
export const soundMixReviewSchema = z
  .object({
    schemaVersion: z.literal(1),
    decision: z.enum(['accepted', 'rejected']),
    reviewer: z.string().min(1),
    reviewedAt: z.string().datetime(),
    asset: z.object({
      id: z.string().regex(/^audio\.[a-z0-9-]+(?:\.[a-z0-9-]+)*$/),
      version: z.string().regex(/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/),
      masterPath: relativeEvidencePathSchema,
      masterSha256: sha256Schema,
      provenancePath: relativeEvidencePathSchema,
    }),
    plan: z.object({
      id: z.string().regex(/^audio\.[a-z0-9-]+(?:\.[a-z0-9-]+)*$/),
      sha256: sha256Schema,
    }),
    evidence: z.object({
      isolated: z.array(relativeEvidencePathSchema).min(2),
      integrated: z.array(relativeEvidencePathSchema).min(2),
      motion: z.array(relativeEvidencePathSchema).min(1),
    }),
    hierarchy: z.object({ foregroundCueIds: cueIdsSchema, supportCueIds: cueIdsSchema }),
    masking: z
      .array(
        z.object({
          cueIds: cueIdsSchema,
          status: z.enum(['controlled', 'unresolved']),
          evidence: relativeEvidencePathSchema,
        }),
      )
      .min(1),
    spatialDepth: z
      .array(
        z.object({
          cueId: z.string().regex(/^[a-z][a-z0-9-]*$/),
          plane: z.enum(['foreground', 'midground', 'background', 'offscreen']),
          evidence: relativeEvidencePathSchema,
        }),
      )
      .min(1),
    sync: z
      .array(
        z.object({
          cueId: z.string().regex(/^[a-z][a-z0-9-]*$/),
          event: z.string().min(1),
          expectedSeconds: z.number().nonnegative(),
          observedSeconds: z.number().nonnegative(),
          toleranceSeconds: z.number().positive().max(0.25),
        }),
      )
      .min(1),
    continuity: z
      .array(
        z.object({
          fromCueId: z.string().regex(/^[a-z][a-z0-9-]*$/),
          toCueId: z.string().regex(/^[a-z][a-z0-9-]*$/),
          status: z.enum(['continuous', 'intentional-cut', 'broken']),
          evidence: relativeEvidencePathSchema,
        }),
      )
      .min(1),
    materialIdentity: z
      .array(
        z.object({
          cueId: z.string().regex(/^[a-z][a-z0-9-]*$/),
          intendedMaterial: z.string().min(1),
          status: z.enum(['credible', 'unclear', 'wrong']),
          evidence: relativeEvidencePathSchema,
        }),
      )
      .min(1),
    strengths: z.array(z.string().min(1)).min(1),
    limitations: z.array(z.string().min(1)).min(1),
    notes: z.string().min(1),
  })
  .superRefine((review, context) => {
    if (review.decision !== 'accepted') return;
    if (review.masking.some((check) => check.status !== 'controlled'))
      context.addIssue({
        code: 'custom',
        path: ['masking'],
        message: 'accepted mixes cannot retain unresolved masking',
      });
    if (review.continuity.some((check) => check.status === 'broken'))
      context.addIssue({
        code: 'custom',
        path: ['continuity'],
        message: 'accepted mixes cannot retain broken continuity',
      });
    if (review.materialIdentity.some((check) => check.status !== 'credible'))
      context.addIssue({
        code: 'custom',
        path: ['materialIdentity'],
        message: 'accepted mixes require credible material identity',
      });
    if (
      review.sync.some(
        (check) => Math.abs(check.expectedSeconds - check.observedSeconds) > check.toleranceSeconds,
      )
    )
      context.addIssue({
        code: 'custom',
        path: ['sync'],
        message: 'accepted mixes require every sync observation within tolerance',
      });
  });
export type SoundMixReview = z.infer<typeof soundMixReviewSchema>;

/** Validates review claims against the deterministic soundtrack plan that was heard. */
export function validateSoundMixReview(input: SoundMixReview, soundtrack: SoundtrackPlan) {
  const review = soundMixReviewSchema.parse(input);
  const plan = soundtrackPlanSchema.parse(soundtrack);
  const cueIds = new Set(plan.cues.map((cue) => cue.id));
  const issues: string[] = [];
  if (review.asset.id !== plan.id)
    issues.push('review asset id must match the reviewed soundtrack plan id');
  const check = (ids: string[], label: string) =>
    ids.forEach((id) => {
      if (!cueIds.has(id)) issues.push(`${label} references unknown cue '${id}'`);
    });
  check(review.hierarchy.foregroundCueIds, 'hierarchy');
  check(review.hierarchy.supportCueIds, 'hierarchy');
  for (const id of review.hierarchy.foregroundCueIds)
    if (review.hierarchy.supportCueIds.includes(id))
      issues.push(`hierarchy cue '${id}' cannot be both foreground and support`);
  review.masking.forEach((value) => check(value.cueIds, 'masking'));
  review.spatialDepth.forEach((value) => check([value.cueId], 'spatial depth'));
  review.sync.forEach((value) => {
    check([value.cueId], 'sync');
    if (
      value.expectedSeconds > plan.durationSeconds ||
      value.observedSeconds > plan.durationSeconds
    )
      issues.push(`sync event '${value.event}' lies outside the soundtrack duration`);
  });
  review.continuity.forEach((value) => check([value.fromCueId, value.toCueId], 'continuity'));
  review.materialIdentity.forEach((value) => check([value.cueId], 'material identity'));
  return { valid: issues.length === 0, issues, review, soundtrack: plan };
}

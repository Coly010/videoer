import { access, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import YAML from 'yaml';
import { z } from 'zod';

export const productionQualityReviewCriteria = [
  'silhouette',
  'scale',
  'material-response',
  'lighting-hierarchy',
  'motion',
  'continuity',
  'atmosphere',
  'compositing',
  'audio',
] as const;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const relativePathSchema = z
  .string()
  .min(1)
  .refine((value) => !value.startsWith('/'), {
    message: 'review evidence must be relative to its review record',
  });
const evidenceSchema = z.object({ path: relativePathSchema, sha256: sha256Schema });

/**
 * A second, delivery-focused record for the production-quality reel. The normal
 * cinematic review binds semantic scene/edit inputs; this record additionally
 * binds the exact pixels, clips, gate reports, and scorecard used for review.
 */
export const productionQualityReelReviewSchema = z
  .object({
    schemaVersion: z.literal(1),
    campaignId: z.literal('campaign.production-quality-reel'),
    decision: z.enum(['accepted', 'rejected']),
    reviewer: z.string().min(1),
    reviewedAt: z.string().datetime(),
    campaign: evidenceSchema,
    scorecard: evidenceSchema.extend({ baselineId: z.string().min(1) }),
    shots: z
      .array(
        z.object({
          id: z.enum([
            'wet-street-establish',
            'practical-material-detail',
            'character-crossing',
            'threshold-resolve',
          ]),
          contactSheet: evidenceSchema,
          motionClip: evidenceSchema,
          renderGateReport: evidenceSchema,
        }),
      )
      .length(4),
    delivery: z.object({
      contactSheet: evidenceSchema,
      video: evidenceSchema,
      editReport: evidenceSchema,
    }),
    criteria: z
      .array(
        z.object({
          id: z.enum(productionQualityReviewCriteria),
          status: z.enum(['pass', 'fail']),
          observation: z.string().min(1),
          evidence: z.array(relativePathSchema).min(1),
        }),
      )
      .length(productionQualityReviewCriteria.length),
    baselineComparison: z.object({
      visibleChange: z.enum(['material-improvement', 'no-material-change', 'regression']),
      observation: z.string().min(1),
    }),
    strengths: z.array(z.string().min(1)).min(1),
    limitations: z.array(z.string().min(1)).min(1),
    repair: z.string().min(1).optional(),
  })
  .superRefine((review, context) => {
    const shotIds = review.shots.map((shot) => shot.id);
    const duplicateShot = shotIds.find((id, index) => shotIds.indexOf(id) !== index);
    if (duplicateShot)
      context.addIssue({
        code: 'custom',
        path: ['shots'],
        message: `duplicate shot '${duplicateShot}'`,
      });
    const criterionIds = review.criteria.map((criterion) => criterion.id);
    const duplicateCriterion = criterionIds.find((id, index) => criterionIds.indexOf(id) !== index);
    if (duplicateCriterion)
      context.addIssue({
        code: 'custom',
        path: ['criteria'],
        message: `duplicate criterion '${duplicateCriterion}'`,
      });
    const knownEvidence = new Set([
      review.campaign.path,
      review.scorecard.path,
      ...review.shots.flatMap((shot) => [
        shot.contactSheet.path,
        shot.motionClip.path,
        shot.renderGateReport.path,
      ]),
      review.delivery.contactSheet.path,
      review.delivery.video.path,
      review.delivery.editReport.path,
    ]);
    review.criteria.forEach((criterion, index) => {
      criterion.evidence.forEach((path) => {
        if (!knownEvidence.has(path))
          context.addIssue({
            code: 'custom',
            path: ['criteria', index, 'evidence'],
            message: `criterion '${criterion.id}' cites unbound evidence '${path}'`,
          });
      });
    });
    const hasFailure = review.criteria.some((criterion) => criterion.status === 'fail');
    if ((review.decision === 'rejected' || hasFailure) && !review.repair)
      context.addIssue({
        code: 'custom',
        path: ['repair'],
        message: 'rejected or failed reviews require a concrete repair instruction',
      });
    if (review.decision === 'accepted' && hasFailure)
      context.addIssue({
        code: 'custom',
        path: ['decision'],
        message: 'accepted review cannot retain failed criteria',
      });
    if (
      review.decision === 'accepted' &&
      review.baselineComparison.visibleChange !== 'material-improvement'
    )
      context.addIssue({
        code: 'custom',
        path: ['baselineComparison', 'visibleChange'],
        message: 'accepted review requires a material visible improvement over baseline',
      });
  });

export type ProductionQualityReelReview = z.infer<typeof productionQualityReelReviewSchema>;

async function sha256File(path: string) {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

/** Fails closed if a reviewed pixel, report, source manifest, or scorecard drifts. */
export async function validateProductionQualityReelReview(path: string) {
  const absolute = resolve(path);
  const review = productionQualityReelReviewSchema.parse(
    YAML.parse(await readFile(absolute, 'utf8')),
  );
  const root = dirname(absolute);
  const evidence = [
    review.campaign,
    review.scorecard,
    ...review.shots.flatMap((shot) => [shot.contactSheet, shot.motionClip, shot.renderGateReport]),
    review.delivery.contactSheet,
    review.delivery.video,
    review.delivery.editReport,
  ];
  await Promise.all(
    evidence.map(async (item) => {
      const file = resolve(root, item.path);
      await access(file);
      const actual = await sha256File(file);
      if (actual !== item.sha256) throw new Error(`Review evidence hash mismatch: ${item.path}`);
    }),
  );
  return { campaignId: review.campaignId, decision: review.decision, evidence: evidence.length };
}

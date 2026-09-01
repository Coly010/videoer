import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { SkeletonJoint } from '../geometry/model.js';

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);

export const productionRigProfileSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^rig-profile\.[a-z][a-z0-9-]*$/u),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u),
  status: z.enum(['experimental', 'validated', 'verified']),
  backend: z.literal('blender-rigify'),
  canonicalSkeleton: z.literal('videoer.canonical-humanoid-52'),
  source: z.object({
    project: z.literal('makehumancommunity/mpfb2'),
    commit: z.string().regex(/^[0-9a-f]{40}$/u),
    mpfbVersion: z.string().regex(/^\d+\.\d+\.\d+$/u),
    rig: z.literal('rigify.human_toes'),
    codeLicence: z.literal('GPL-3.0-or-later'),
    assetLicence: z.literal('CC0-1.0'),
    baseSha256: sha256Schema,
    rigSha256: sha256Schema,
    weightsSha256: sha256Schema,
  }),
  transfer: z.object({
    mode: z.literal('canonical-world-to-rigify-controls-v1'),
    translationJoints: z.array(z.string()).min(1),
    legTransfer: z.literal('rigify-ik-snap-contact-solve-no-stretch'),
    finalSurfaceGrounding: z.literal('evaluated-body-sole-with-support-foot-regions'),
    coordinateConversion: z.object({
      canonical: z.literal('x-left-y-up-forward-negative-z'),
      backend: z.literal('mpfb-blender-x-left-z-up-forward-negative-y'),
      matrix: z
        .array(z.array(z.number()).length(4))
        .length(4)
        .refine(
          (matrix) =>
            JSON.stringify(matrix) ===
            JSON.stringify([
              [1, 0, 0, 0],
              [0, 0, 1, 0],
              [0, 1, 0, 0],
              [0, 0, 0, 1],
            ]),
          'MPFB coordinate conversion must preserve its authored -Y facing direction',
        ),
    }),
  }),
  canonicalToControl: z
    .record(z.string(), z.string())
    .refine(
      (mapping) => Object.keys(mapping).length === 52,
      'Production Rigify profile must map all 52 canonical joints',
    ),
});

export type ProductionRigProfile = z.infer<typeof productionRigProfileSchema>;

export async function loadProductionRigProfile(path: string) {
  return productionRigProfileSchema.parse(JSON.parse(await readFile(path, 'utf8')));
}

export function verifyProductionRigProfileSkeleton(
  profile: ProductionRigProfile,
  skeleton: SkeletonJoint[],
) {
  const skeletonIds = new Set(skeleton.map((joint) => joint.id));
  const mappedIds = new Set(Object.keys(profile.canonicalToControl));
  const missing = [...skeletonIds].filter((joint) => !mappedIds.has(joint));
  const extra = [...mappedIds].filter((joint) => !skeletonIds.has(joint));
  return {
    valid: missing.length === 0 && extra.length === 0,
    issues: [
      ...(missing.length ? [`rig profile omits canonical joints: ${missing.join(', ')}`] : []),
      ...(extra.length
        ? [`rig profile contains unknown canonical joints: ${extra.join(', ')}`]
        : []),
    ],
    checks: {
      skeletonJoints: skeleton.length,
      mappedJoints: mappedIds.size,
      uniqueControls: new Set(Object.values(profile.canonicalToControl)).size,
    },
  };
}

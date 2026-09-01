import { z } from 'zod';

export const assetKinds = [
  'character',
  'environment',
  'prop',
  'material',
  'clothing',
  'hair',
  'motion',
  'vfx',
  'audio',
  'lighting',
  'editorial',
] as const;
export const assetKindSchema = z.enum(assetKinds);
export type AssetKind = z.infer<typeof assetKindSchema>;

export const assetReferenceSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9]*(?:\.[a-z0-9-]+)+$/),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/),
});
export type AssetReference = z.infer<typeof assetReferenceSchema>;

export const acquisitionStrategies = ['unresolved', 'reuse', 'adapt', 'create'] as const;

export const assetRequirementSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    type: assetKindSchema,
    description: z.string().min(1),
    requiredShots: z.array(z.string().regex(/^[a-z0-9-]+$/)).min(1),
    tags: z.array(z.string().min(1)).default([]),
    capabilities: z.array(z.string().min(1)).default([]),
    constraints: z.record(z.string(), z.unknown()).default({}),
    preferredAsset: assetReferenceSchema.optional(),
    acquisition: z.enum(acquisitionStrategies).default('unresolved'),
    resolvedAsset: assetReferenceSchema.optional(),
  })
  .superRefine((requirement, ctx) => {
    if (
      (requirement.acquisition === 'reuse' || requirement.acquisition === 'adapt') &&
      !requirement.resolvedAsset
    )
      ctx.addIssue({
        code: 'custom',
        path: ['resolvedAsset'],
        message: `${requirement.acquisition} requires a resolvedAsset`,
      });
    if (
      (requirement.acquisition === 'unresolved' || requirement.acquisition === 'create') &&
      requirement.resolvedAsset
    )
      ctx.addIssue({
        code: 'custom',
        path: ['resolvedAsset'],
        message: `${requirement.acquisition} cannot reference a resolvedAsset`,
      });
  });

const shotActionSchema = z.object({
  actor: z.string().optional(),
  motion: z.string().min(1),
  target: z.string().optional(),
  startSeconds: z.number().nonnegative().default(0),
  durationSeconds: z.number().positive().optional(),
  params: z.record(z.string(), z.unknown()).default({}),
});

export const productionShotSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  storyboardShotId: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .optional(),
  purpose: z.string().min(1),
  durationSeconds: z.number().positive(),
  requirements: z.array(z.string().regex(/^[a-z0-9-]+$/)).default([]),
  actions: z.array(shotActionSchema).default([]),
  camera: z.record(z.string(), z.unknown()).default({}),
  lighting: z.record(z.string(), z.unknown()).default({}),
  continuityGroup: z.string().min(1).optional(),
});

export const productionPlanSchema = z
  .object({
    schemaVersion: z.literal(1),
    campaignId: z.string().regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9-]+)*$/),
    title: z.string().min(1),
    summary: z.string().min(1),
    createdAt: z.string().datetime().optional(),
    shots: z.array(productionShotSchema).min(1),
    requirements: z.array(assetRequirementSchema).min(1),
  })
  .superRefine((plan, ctx) => {
    const shotIds = new Set<string>();
    for (const [index, shot] of plan.shots.entries()) {
      if (shotIds.has(shot.id))
        ctx.addIssue({
          code: 'custom',
          path: ['shots', index, 'id'],
          message: `duplicate shot id: ${shot.id}`,
        });
      shotIds.add(shot.id);
    }
    const requirementIds = new Set<string>();
    for (const [index, requirement] of plan.requirements.entries()) {
      if (requirementIds.has(requirement.id))
        ctx.addIssue({
          code: 'custom',
          path: ['requirements', index, 'id'],
          message: `duplicate requirement id: ${requirement.id}`,
        });
      requirementIds.add(requirement.id);
      for (const shotId of requirement.requiredShots)
        if (!shotIds.has(shotId))
          ctx.addIssue({
            code: 'custom',
            path: ['requirements', index, 'requiredShots'],
            message: `unknown shot id: ${shotId}`,
          });
    }
    for (const [index, shot] of plan.shots.entries())
      for (const requirementId of shot.requirements)
        if (!requirementIds.has(requirementId))
          ctx.addIssue({
            code: 'custom',
            path: ['shots', index, 'requirements'],
            message: `unknown requirement id: ${requirementId}`,
          });
  });

export type ProductionPlan = z.infer<typeof productionPlanSchema>;
export type AssetRequirement = z.infer<typeof assetRequirementSchema>;

const resolutionCandidateSchema = z.object({
  asset: assetReferenceSchema,
  score: z.number().nonnegative(),
  matchedTags: z.array(z.string()),
  missingCapabilities: z.array(z.string()),
});

export const assetManifestSchema = z.object({
  schemaVersion: z.literal(1),
  campaignId: z.string(),
  productionPlan: z.string(),
  library: z.string(),
  generatedAt: z.string().datetime(),
  resolutions: z.array(
    z.object({
      requirementId: z.string(),
      decision: z.enum(['reuse', 'adapt', 'create']),
      asset: assetReferenceSchema.optional(),
      candidates: z.array(resolutionCandidateSchema).default([]),
      reason: z.string(),
    }),
  ),
});
export type AssetManifest = z.infer<typeof assetManifestSchema>;

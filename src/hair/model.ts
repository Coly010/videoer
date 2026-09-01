import { z } from 'zod';

const colorSchema = z.tuple([
  z.number().min(0).max(1),
  z.number().min(0).max(1),
  z.number().min(0).max(1),
]);

export const hairAssetDefinitionSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(/^hair\.[a-z0-9-]+(?:\.[a-z0-9-]+)*$/),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    style: z.enum(['pulled-back-low-bun']),
    representation: z.enum([
      'layered-mesh-masses',
      'scalp-shell-plus-bun',
      'dedicated-scalp-layered-cards',
    ]),
    compatibleSkeleton: z.literal('canonical-humanoid-v1'),
    anchorJoint: z.literal('head'),
    fit: z.object({
      scalpClearanceMeters: z.number().min(0).max(0.03),
      headWidthMeters: z.number().positive(),
      headHeightMeters: z.number().positive(),
      headDepthMeters: z.number().positive(),
    }),
    cardSystem: z
      .object({
        scalpTopology: z.literal('parametric-continuous-cap-v1'),
        cardCount: z.number().int().min(12),
        segmentsPerCard: z.number().int().min(3),
        widthMinimumMeters: z.number().positive(),
        widthMaximumMeters: z.number().positive(),
        rootLiftMeters: z.number().positive(),
        silhouetteBreakupMeters: z.number().positive(),
      })
      .optional(),
    material: z.object({
      melaninColor: colorSchema,
      roughness: z.number().min(0).max(1),
      anisotropy: z.number().min(0).max(1),
    }),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .superRefine((definition, context) => {
    if (definition.representation === 'dedicated-scalp-layered-cards' && !definition.cardSystem)
      context.addIssue({
        code: 'custom',
        path: ['cardSystem'],
        message: 'dedicated layered-card hair requires an explicit card system',
      });
    if (
      definition.cardSystem &&
      definition.cardSystem.widthMinimumMeters > definition.cardSystem.widthMaximumMeters
    )
      context.addIssue({
        code: 'custom',
        path: ['cardSystem', 'widthMinimumMeters'],
        message: 'card minimum width cannot exceed maximum width',
      });
  });

export type HairAssetDefinition = z.infer<typeof hairAssetDefinitionSchema>;

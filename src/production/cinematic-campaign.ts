import { z } from 'zod';
import { soundtrackPlanSchema } from '../audio/model.js';
import { audioTreatmentSchema } from '../audio/treatment.js';
import { lightingRigAdaptationSchema } from '../lighting/adaptation.js';
import { editorialTreatmentAdaptationSchema } from '../titles/adaptation.js';
import {
  cinematicAtmosphereSchema,
  cinematicIdentifierSchema,
  cinematicLandmarkSchema,
  cinematicLightSchema,
  cinematicQualityGateSchema,
  cinematicRenderGateSchema,
  cinematicResolutionSchema,
  cinematicVec3Schema,
} from '../cinematic/model.js';
import { geometryMaterialSchema } from '../geometry/model.js';
import { sceneTransformSchema } from '../interactions/model.js';
import { assetKindSchema, assetReferenceSchema } from './model.js';

const localIdSchema = z.string().regex(/^[a-z][a-z0-9-]*$/);
const relativePathSchema = z
  .string()
  .min(1)
  .refine((value) => !value.startsWith('/'), 'campaign artifact paths must be relative');

const libraryRequirementSchema = z.object({
  type: assetKindSchema,
  query: z.string().min(1),
  tags: z.array(z.string().min(1)).default([]),
  capabilities: z.array(z.string().min(1)).default([]),
  preferredAsset: assetReferenceSchema.optional(),
  artifactRole: z.string().min(1),
});

const attachmentSchema = z.object({
  position: cinematicVec3Schema,
  rotation: cinematicVec3Schema.default([0, 0, 0]),
  bone: z.string().default('root'),
});

export const campaignAssetPublicationSchema = z.object({
  assetId: cinematicIdentifierSchema,
  version: assetReferenceSchema.shape.version,
  type: z.enum([
    'character',
    'environment',
    'prop',
    'clothing',
    'material',
    'motion',
    'vfx',
    'audio',
    'lighting',
    'editorial',
  ]),
  title: z.string().min(1),
  description: z.string().min(1),
  tags: z.array(z.string().min(1)).default([]),
  capabilities: z.array(z.string().min(1)).min(1),
  generator: z.string().min(1),
  coordinateSystem: z.string().default('right-handed-y-up-forward-negative-z-metres'),
  renderers: z.array(z.string().min(1)).min(1).default(['blender-headless']),
  verification: z.object({
    checks: z.array(z.string().min(1)).min(1),
    shots: z.array(localIdSchema).min(1),
  }),
});

const audioSourceSchema = z
  .object({
    id: localIdSchema,
    path: relativePathSchema.optional(),
    library: libraryRequirementSchema,
    adaptation: audioTreatmentSchema
      .safeExtend({
        providesCapabilities: z.array(z.string().min(1)).min(1),
        publication: campaignAssetPublicationSchema,
      })
      .optional(),
  })
  .superRefine((source, context) => {
    if (source.adaptation && !source.path)
      context.addIssue({
        code: 'custom',
        path: ['path'],
        message: 'audio adaptation requires an output path',
      });
    if (source.adaptation) {
      if (source.library.type !== 'audio')
        context.addIssue({
          code: 'custom',
          path: ['library', 'type'],
          message: 'audio adaptation requires an audio library source',
        });
      if (source.adaptation.publication.type !== 'audio')
        context.addIssue({
          code: 'custom',
          path: ['adaptation', 'publication', 'type'],
          message: 'audio adaptation publication must use audio type',
        });
      if (source.adaptation.publication.assetId !== source.adaptation.assetId)
        context.addIssue({
          code: 'custom',
          path: ['adaptation', 'publication', 'assetId'],
          message: 'audio adaptation publication assetId must match adapted assetId',
        });
    }
  });

const lightingSourceSchema = z
  .object({
    id: localIdSchema,
    path: relativePathSchema.optional(),
    library: libraryRequirementSchema,
    adaptation: lightingRigAdaptationSchema
      .safeExtend({
        providesCapabilities: z.array(z.string().min(1)).min(1),
        publication: campaignAssetPublicationSchema,
      })
      .optional(),
  })
  .superRefine((source, context) => {
    if (source.adaptation && !source.path)
      context.addIssue({
        code: 'custom',
        path: ['path'],
        message: 'lighting adaptation requires an output path',
      });
    if (!['environment', 'lighting'].includes(source.library.type))
      context.addIssue({
        code: 'custom',
        path: ['library', 'type'],
        message: 'lighting source requirements must use lighting or legacy environment type',
      });
    if (source.adaptation) {
      if (source.adaptation.publication.type !== 'lighting')
        context.addIssue({
          code: 'custom',
          path: ['adaptation', 'publication', 'type'],
          message: 'lighting adaptation publication must use lighting type',
        });
      if (source.adaptation.publication.assetId !== source.adaptation.assetId)
        context.addIssue({
          code: 'custom',
          path: ['adaptation', 'publication', 'assetId'],
          message: 'lighting adaptation publication assetId must match adapted assetId',
        });
    }
  });

const geometryPublicationTypes = new Set(['character', 'environment', 'prop', 'clothing']);

const vfxAdaptationSchema = z
  .object({
    kind: z.literal('atmospheric-treatment'),
    assetId: cinematicIdentifierSchema,
    providesCapabilities: z.array(z.string().min(1)).min(1),
    worldColor: cinematicVec3Schema.optional(),
    fog: z
      .object({
        density: z.number().min(0).max(0.2).optional(),
        color: cinematicVec3Schema.optional(),
      })
      .optional(),
    rain: z
      .object({
        enabled: z.boolean().optional(),
        layers: z
          .array(
            z.object({
              id: z.enum(['foreground', 'midground', 'background']),
              count: z.number().int().positive().optional(),
              streakLengthMeters: z.number().positive().optional(),
              streakRadiusMeters: z.number().positive().optional(),
              fallSpeedMetersPerSecond: z.number().positive().optional(),
              opacity: z.number().min(0).max(1).optional(),
              color: cinematicVec3Schema.optional(),
            }),
          )
          .default([]),
      })
      .optional(),
    metadata: z.record(z.string(), z.unknown()).default({}),
    publication: campaignAssetPublicationSchema.optional(),
  })
  .superRefine((adaptation, ctx) => {
    const changed =
      adaptation.worldColor !== undefined ||
      adaptation.fog?.density !== undefined ||
      adaptation.fog?.color !== undefined ||
      adaptation.rain?.enabled !== undefined ||
      Boolean(adaptation.rain?.layers.length);
    if (!changed)
      ctx.addIssue({
        code: 'custom',
        path: [],
        message: 'VFX adaptation requires a treatment change',
      });
    const ids = adaptation.rain?.layers.map((layer) => layer.id) ?? [];
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({
        code: 'custom',
        path: ['rain', 'layers'],
        message: 'VFX layer overrides must be unique',
      });
    adaptation.rain?.layers.forEach((layer, index) => {
      if (Object.keys(layer).length === 1)
        ctx.addIssue({
          code: 'custom',
          path: ['rain', 'layers', index],
          message: 'VFX layer override must change at least one parameter',
        });
    });
  });

const vfxSourceSchema = z
  .object({
    id: localIdSchema,
    path: relativePathSchema.optional(),
    library: libraryRequirementSchema.optional(),
    adaptation: vfxAdaptationSchema.optional(),
  })
  .superRefine((source, ctx) => {
    if (!source.library && !source.path)
      ctx.addIssue({ code: 'custom', path: ['path'], message: 'local VFX requires a path' });
    if (source.adaptation && !source.library)
      ctx.addIssue({
        code: 'custom',
        path: ['adaptation'],
        message: 'VFX adaptation requires a library source',
      });
    if (source.adaptation && !source.path)
      ctx.addIssue({
        code: 'custom',
        path: ['path'],
        message: 'VFX adaptation requires an output path',
      });
    if (source.path && !source.path.endsWith('.json'))
      ctx.addIssue({ code: 'custom', path: ['path'], message: 'VFX path must end in .json' });
    if (source.library && source.library.type !== 'vfx')
      ctx.addIssue({
        code: 'custom',
        path: ['library', 'type'],
        message: 'VFX requirements must use vfx type',
      });
    if (source.adaptation?.publication) {
      if (source.adaptation.publication.type !== 'vfx')
        ctx.addIssue({
          code: 'custom',
          path: ['adaptation', 'publication', 'type'],
          message: 'VFX adaptation publication must use vfx type',
        });
      if (source.adaptation.publication.assetId !== source.adaptation.assetId)
        ctx.addIssue({
          code: 'custom',
          path: ['adaptation', 'publication', 'assetId'],
          message: 'VFX publication assetId must match adapted assetId',
        });
    }
  });

const finishSourceSchema = z
  .object({
    id: localIdSchema,
    path: relativePathSchema.optional(),
    library: libraryRequirementSchema.optional(),
  })
  .superRefine((source, ctx) => {
    if (!source.library && !source.path)
      ctx.addIssue({
        code: 'custom',
        path: ['path'],
        message: 'cinematic finish requires a local path or library source',
      });
    if (source.library && source.path)
      ctx.addIssue({
        code: 'custom',
        path: ['path'],
        message: 'cinematic finish must use either a local path or library source, not both',
      });
    if (source.path && !source.path.endsWith('.json'))
      ctx.addIssue({
        code: 'custom',
        path: ['path'],
        message: 'cinematic finish path must end in .json',
      });
    if (source.library && source.library.type !== 'vfx')
      ctx.addIssue({
        code: 'custom',
        path: ['library', 'type'],
        message: 'cinematic finish requirements must use vfx type',
      });
  });

const materialAdaptationSchema = z
  .object({
    kind: z.literal('surface-treatment'),
    assetId: cinematicIdentifierSchema,
    providesCapabilities: z.array(z.string().min(1)).min(1),
    baseColor: z
      .object({
        colors: z
          .array(
            z
              .tuple([z.number(), z.number(), z.number(), z.number()])
              .refine(
                (color) => color.every((channel) => channel >= 0 && channel <= 1),
                'material color channels must be between zero and one',
              ),
          )
          .min(1)
          .optional(),
        scaleMeters: z.number().positive().optional(),
        seed: z.number().int().optional(),
      })
      .optional(),
    normal: z
      .object({
        strength: z.number().min(0).max(2).optional(),
        scaleMeters: z.number().positive().optional(),
      })
      .optional(),
    roughness: z
      .object({
        minimum: z.number().min(0).max(1).optional(),
        maximum: z.number().min(0).max(1).optional(),
        variationScaleMeters: z.number().positive().optional(),
        wetness: z.number().min(0).max(1).optional(),
      })
      .optional(),
    metallic: z.number().min(0).max(1).optional(),
    metadata: z.record(z.string(), z.unknown()).default({}),
    publication: campaignAssetPublicationSchema.optional(),
  })
  .superRefine((adaptation, ctx) => {
    const changed =
      adaptation.baseColor !== undefined ||
      adaptation.normal !== undefined ||
      adaptation.roughness !== undefined ||
      adaptation.metallic !== undefined;
    if (!changed)
      ctx.addIssue({
        code: 'custom',
        path: [],
        message: 'material adaptation requires a surface treatment change',
      });
    for (const field of ['baseColor', 'normal', 'roughness'] as const)
      if (adaptation[field] && Object.keys(adaptation[field]).length === 0)
        ctx.addIssue({
          code: 'custom',
          path: [field],
          message: `${field} treatment must change at least one parameter`,
        });
  });

const materialSourceSchema = z
  .object({
    id: localIdSchema,
    path: relativePathSchema.optional(),
    library: libraryRequirementSchema.optional(),
    adaptation: materialAdaptationSchema.optional(),
  })
  .superRefine((source, ctx) => {
    if (!source.library && !source.path)
      ctx.addIssue({ code: 'custom', path: ['path'], message: 'local material requires a path' });
    if (source.adaptation && !source.library)
      ctx.addIssue({
        code: 'custom',
        path: ['adaptation'],
        message: 'material adaptation requires a library source',
      });
    if (source.adaptation && !source.path)
      ctx.addIssue({
        code: 'custom',
        path: ['path'],
        message: 'material adaptation requires an output path',
      });
    if (source.path && !source.path.endsWith('.json'))
      ctx.addIssue({ code: 'custom', path: ['path'], message: 'material path must end in .json' });
    if (source.library && source.library.type !== 'material')
      ctx.addIssue({
        code: 'custom',
        path: ['library', 'type'],
        message: 'material requirements must use material type',
      });
    if (source.adaptation?.publication) {
      if (source.adaptation.publication.type !== 'material')
        ctx.addIssue({
          code: 'custom',
          path: ['adaptation', 'publication', 'type'],
          message: 'material adaptation publication must use material type',
        });
      if (source.adaptation.publication.assetId !== source.adaptation.assetId)
        ctx.addIssue({
          code: 'custom',
          path: ['adaptation', 'publication', 'assetId'],
          message: 'material publication assetId must match adapted assetId',
        });
    }
  });

const clothingAdaptationSchema = z.object({
  kind: z.literal('canonical-clothing-fit'),
  assetId: cinematicIdentifierSchema,
  targetGeometry: localIdSchema,
  clearanceMeters: z.number().min(0.001).max(0.05).default(0.008),
  skinningPolicy: z.enum(['preserve', 'long-dress-drape-v1']).default('preserve'),
  providesCapabilities: z.array(z.string().min(1)).min(1),
  metadata: z.record(z.string(), z.unknown()).default({}),
  publication: campaignAssetPublicationSchema.optional(),
});

const clothingSourceSchema = z
  .object({
    id: localIdSchema,
    path: relativePathSchema.optional(),
    library: libraryRequirementSchema.optional(),
    adaptation: clothingAdaptationSchema.optional(),
  })
  .superRefine((source, ctx) => {
    if (!source.library && !source.path)
      ctx.addIssue({ code: 'custom', path: ['path'], message: 'local clothing requires a path' });
    if (source.adaptation && !source.library)
      ctx.addIssue({
        code: 'custom',
        path: ['adaptation'],
        message: 'clothing adaptation requires a library source',
      });
    if (source.adaptation && !source.path)
      ctx.addIssue({
        code: 'custom',
        path: ['path'],
        message: 'clothing adaptation requires an output path',
      });
    if (source.path && !source.path.endsWith('.json'))
      ctx.addIssue({ code: 'custom', path: ['path'], message: 'clothing path must end in .json' });
    if (source.library && source.library.type !== 'clothing')
      ctx.addIssue({
        code: 'custom',
        path: ['library', 'type'],
        message: 'clothing requirements must use clothing type',
      });
    if (source.adaptation?.publication) {
      if (source.adaptation.publication.type !== 'clothing')
        ctx.addIssue({
          code: 'custom',
          path: ['adaptation', 'publication', 'type'],
          message: 'clothing adaptation publication must use clothing type',
        });
      if (source.adaptation.publication.assetId !== source.adaptation.assetId)
        ctx.addIssue({
          code: 'custom',
          path: ['adaptation', 'publication', 'assetId'],
          message: 'clothing publication assetId must match adapted assetId',
        });
    }
  });

const geometryPrimitiveSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('box'),
    minimum: cinematicVec3Schema,
    maximum: cinematicVec3Schema,
    materialId: localIdSchema,
  }),
  z.object({
    kind: z.literal('capsule'),
    start: cinematicVec3Schema,
    end: cinematicVec3Schema,
    radiusX: z.number().positive(),
    radiusZ: z.number().positive(),
    materialId: localIdSchema,
    capSegments: z.number().int().min(2).max(16).default(4),
    radialSegments: z.number().int().min(6).max(64).default(16),
  }),
  z.object({
    kind: z.literal('ellipsoid'),
    start: cinematicVec3Schema,
    end: cinematicVec3Schema,
    radiusX: z.number().positive(),
    radiusZ: z.number().positive(),
    materialId: localIdSchema,
    latSegments: z.number().int().min(4).max(32).default(10),
    radialSegments: z.number().int().min(6).max(64).default(16),
  }),
]);

const geometryAdaptationSchema = z
  .object({
    assetId: cinematicIdentifierSchema,
    providesCapabilities: z.array(z.string().min(1)).min(1),
    addAttachments: z.record(localIdSchema, attachmentSchema).default({}),
    materialOverrides: z
      .array(
        z.object({
          materialId: localIdSchema,
          baseColor: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
          roughness: z.number().min(0).max(1).optional(),
          metallic: z.number().min(0).max(1).optional(),
          emission: cinematicVec3Schema.optional(),
          emissionStrength: z.number().nonnegative().optional(),
        }),
      )
      .default([]),
    speechMorphs: z.object({ kind: z.literal('english-visemes-v1') }).optional(),
    metadata: z.record(z.string(), z.unknown()).default({}),
    publication: campaignAssetPublicationSchema.optional(),
  })
  .superRefine((adaptation, ctx) => {
    if (
      !Object.keys(adaptation.addAttachments).length &&
      !adaptation.materialOverrides.length &&
      !adaptation.speechMorphs
    )
      ctx.addIssue({
        code: 'custom',
        path: [],
        message: 'geometry adaptation requires an attachment or material operation',
      });
    adaptation.materialOverrides.forEach((override, index) => {
      if (Object.keys(override).length === 1)
        ctx.addIssue({
          code: 'custom',
          path: ['materialOverrides', index],
          message: 'material override must change at least one material property',
        });
    });
  });

const geometrySourceSchema = z
  .object({
    id: localIdSchema,
    path: relativePathSchema.optional(),
    productionRigProfilePath: relativePathSchema.optional(),
    library: libraryRequirementSchema.optional(),
    adaptation: geometryAdaptationSchema.optional(),
    materialBindings: z
      .array(
        z.object({
          targetMaterialId: localIdSchema,
          material: localIdSchema,
        }),
      )
      .default([]),
    recipe: z
      .object({
        assetId: cinematicIdentifierSchema,
        primitives: z.array(geometryPrimitiveSchema).min(1),
        materials: z.array(geometryMaterialSchema).min(1),
        attachments: z.record(localIdSchema, attachmentSchema).default({}),
        metadata: z.record(z.string(), z.unknown()).default({}),
        publication: campaignAssetPublicationSchema.optional(),
      })
      .optional(),
  })
  .superRefine((source, ctx) => {
    if (source.recipe && source.library)
      ctx.addIssue({ code: 'custom', path: [], message: 'geometry cannot use recipe and library' });
    if (source.recipe && source.adaptation)
      ctx.addIssue({
        code: 'custom',
        path: [],
        message: 'geometry cannot use recipe and adaptation',
      });
    if (source.adaptation && !source.library)
      ctx.addIssue({
        code: 'custom',
        path: ['adaptation'],
        message: 'geometry adaptation requires a library source',
      });
    if (!source.library && !source.path)
      ctx.addIssue({ code: 'custom', path: ['path'], message: 'local geometry requires a path' });
    if (source.recipe && !source.path)
      ctx.addIssue({
        code: 'custom',
        path: ['path'],
        message: 'geometry recipe requires an output path',
      });
    if (source.adaptation && !source.path)
      ctx.addIssue({
        code: 'custom',
        path: ['path'],
        message: 'geometry adaptation requires an output path',
      });
    if (source.materialBindings.length && !source.path)
      ctx.addIssue({
        code: 'custom',
        path: ['path'],
        message: 'material-bound geometry requires an output path',
      });
    if (source.materialBindings.length && !source.library && !source.recipe && !source.adaptation)
      ctx.addIssue({
        code: 'custom',
        path: ['materialBindings'],
        message:
          'binding a material to local geometry requires an explicit derived geometry source',
      });
    const targetMaterials = source.materialBindings.map((binding) => binding.targetMaterialId);
    if (new Set(targetMaterials).size !== targetMaterials.length)
      ctx.addIssue({
        code: 'custom',
        path: ['materialBindings'],
        message: 'geometry material bindings must target unique material ids',
      });
    if (
      source.materialBindings.length &&
      (source.recipe?.publication || source.adaptation?.publication)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['materialBindings'],
        message:
          'material-bound geometry publication requires a separate composite derivation contract',
      });
    if (source.path && !source.path.endsWith('.json'))
      ctx.addIssue({ code: 'custom', path: ['path'], message: 'geometry path must end in .json' });
    if (source.recipe?.publication) {
      if (!geometryPublicationTypes.has(source.recipe.publication.type))
        ctx.addIssue({
          code: 'custom',
          path: ['recipe', 'publication', 'type'],
          message: 'geometry publication must use a geometry asset type',
        });
      if (source.recipe.publication.assetId !== source.recipe.assetId)
        ctx.addIssue({
          code: 'custom',
          path: ['recipe', 'publication', 'assetId'],
          message: 'geometry publication assetId must match recipe assetId',
        });
      if (!source.recipe.publication.assetId.startsWith(`${source.recipe.publication.type}.`))
        ctx.addIssue({
          code: 'custom',
          path: ['recipe', 'publication', 'assetId'],
          message: 'publication assetId must begin with its asset type',
        });
    }
    if (source.adaptation?.publication) {
      if (!geometryPublicationTypes.has(source.adaptation.publication.type))
        ctx.addIssue({
          code: 'custom',
          path: ['adaptation', 'publication', 'type'],
          message: 'geometry adaptation publication must use a geometry asset type',
        });
      if (source.adaptation.publication.assetId !== source.adaptation.assetId)
        ctx.addIssue({
          code: 'custom',
          path: ['adaptation', 'publication', 'assetId'],
          message: 'adaptation publication assetId must match adapted assetId',
        });
    }
  });

const motionAdaptationSchema = z.object({
  kind: z.literal('gait-retarget'),
  assetId: cinematicIdentifierSchema,
  targetGeometry: localIdSchema,
  providesCapabilities: z.array(z.string().min(1)).min(1),
  metadata: z.record(z.string(), z.unknown()).default({}),
  publication: campaignAssetPublicationSchema.optional(),
});

const motionSourceSchema = z
  .object({
    id: localIdSchema,
    path: relativePathSchema.optional(),
    library: libraryRequirementSchema.optional(),
    adaptation: motionAdaptationSchema.optional(),
    recipe: z
      .discriminatedUnion('kind', [
        z.object({
          kind: z.literal('walk-style'),
          style: z.enum(['neutral', 'cautious', 'confident']),
        }),
        z.object({
          kind: z.literal('turn'),
          direction: z.enum(['left', 'right']),
          scope: z.enum(['head', 'body', 'head-and-body']).default('head-and-body'),
        }),
        z.object({
          kind: z.literal('targeted-turn'),
          actorTransform: sceneTransformSchema,
          target: z.object({
            geometry: localIdSchema,
            attachmentId: localIdSchema,
            transform: sceneTransformSchema.default({
              position: [0, 0, 0],
              rotation: [0, 0, 0],
              scale: [1, 1, 1],
            }),
          }),
          scope: z.enum(['head', 'body', 'head-and-body']).default('head-and-body'),
          durationSeconds: z.number().positive().default(1.4),
          maximumYawRadians: z
            .number()
            .positive()
            .max(Math.PI)
            .default(Math.PI * 0.48),
        }),
        z.object({
          kind: z.literal('speech-visemes'),
          soundtrackCue: localIdSchema,
          targetGeometry: localIdSchema,
        }),
      ])
      .optional(),
    publication: campaignAssetPublicationSchema.optional(),
  })
  .superRefine((source, ctx) => {
    if (source.recipe && source.library)
      ctx.addIssue({ code: 'custom', path: [], message: 'motion cannot use recipe and library' });
    if (source.recipe && source.adaptation)
      ctx.addIssue({
        code: 'custom',
        path: [],
        message: 'motion cannot use recipe and adaptation',
      });
    if (source.adaptation && !source.library)
      ctx.addIssue({
        code: 'custom',
        path: ['adaptation'],
        message: 'motion adaptation requires a library source',
      });
    if (!source.library && !source.path)
      ctx.addIssue({ code: 'custom', path: ['path'], message: 'local motion requires a path' });
    if (source.recipe && !source.path)
      ctx.addIssue({
        code: 'custom',
        path: ['path'],
        message: 'motion recipe requires an output path',
      });
    if (source.adaptation && !source.path)
      ctx.addIssue({
        code: 'custom',
        path: ['path'],
        message: 'motion adaptation requires an output path',
      });
    if (source.publication && source.publication.type !== 'motion')
      ctx.addIssue({
        code: 'custom',
        path: ['publication', 'type'],
        message: 'motion publication must use motion type',
      });
    if (source.adaptation?.publication) {
      if (source.adaptation.publication.type !== 'motion')
        ctx.addIssue({
          code: 'custom',
          path: ['adaptation', 'publication', 'type'],
          message: 'motion adaptation publication must use motion type',
        });
      if (source.adaptation.publication.assetId !== source.adaptation.assetId)
        ctx.addIssue({
          code: 'custom',
          path: ['adaptation', 'publication', 'assetId'],
          message: 'motion adaptation publication assetId must match adapted assetId',
        });
    }
  });

const motionTimelineSchema = z.object({
  id: localIdSchema,
  clipId: cinematicIdentifierSchema,
  path: relativePathSchema,
  frames: z.number().int().positive(),
  layers: z
    .array(
      z.object({
        id: localIdSchema,
        motion: localIdSchema,
        mode: z.enum(['base', 'additive', 'override']),
        startFrame: z.number().int().nonnegative(),
        endFrame: z.number().int().positive(),
        playback: z.enum(['once', 'loop', 'hold']),
        sourceStartSeconds: z.number().nonnegative().optional(),
        sourceEndSeconds: z.number().positive().optional(),
        weight: z.number().min(0).max(1).default(1),
        fadeInFrames: z.number().int().nonnegative().default(0),
        fadeOutFrames: z.number().int().nonnegative().default(0),
        joints: z.array(localIdSchema).optional(),
        morphTargets: z.array(localIdSchema).optional(),
        minimumContribution: z.number().positive().optional(),
      }),
    )
    .min(1),
  metadata: z.record(z.string(), z.unknown()).default({}),
  publication: campaignAssetPublicationSchema.optional(),
  derivation: z
    .object({
      kind: z.literal('layered-performance'),
      targetGeometry: localIdSchema,
      providesCapabilities: z.array(z.string().min(1)).min(1),
      publication: campaignAssetPublicationSchema,
    })
    .optional(),
});

const pointReferenceSchema = z.union([
  z.object({ world: cinematicVec3Schema }),
  z.object({
    entityId: localIdSchema,
    attachmentId: localIdSchema,
    offset: cinematicVec3Schema.default([0, 0, 0]),
  }),
]);

const optionalAtmosphereSchema = z
  .preprocess(
    (value) => (value === undefined ? null : value),
    z.union([cinematicAtmosphereSchema, z.null()]),
  )
  .transform((value) => value ?? undefined);

const cameraTemplateKeyframeSchema = z.object({
  time: z.number().nonnegative(),
  position: pointReferenceSchema,
  target: pointReferenceSchema,
  lensMillimeters: z.number().min(12).max(300),
  easing: z.enum(['linear', 'ease-in-out']).default('ease-in-out'),
});

const generatedTextOverlaySchema = z.object({
  id: localIdSchema,
  path: relativePathSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  font: z.object({
    family: z.literal('Cormorant Garamond'),
    licence: z.literal('OFL-1.1'),
  }),
  lines: z
    .array(
      z.object({
        text: z.string().min(1),
        y: z.number().int().nonnegative(),
        fontSize: z.number().int().positive(),
        color: z.string().regex(/^0x[0-9a-fA-F]{6}(?:@[0-9.]+)?$/),
        borderWidth: z.number().int().nonnegative().default(0),
        borderColor: z.string().default('black@0.0'),
      }),
    )
    .min(1),
});

const libraryImageOverlaySchema = z.object({
  id: localIdSchema,
  library: libraryRequirementSchema,
});

const adaptedEditorialOverlaySchema = z
  .object({
    id: localIdSchema,
    path: relativePathSchema,
    treatmentPath: relativePathSchema,
    library: libraryRequirementSchema,
    adaptation: editorialTreatmentAdaptationSchema.safeExtend({
      providesCapabilities: z.array(z.string().min(1)).min(1),
      publication: campaignAssetPublicationSchema,
    }),
  })
  .superRefine((source, context) => {
    if (!['material', 'editorial'].includes(source.library.type))
      context.addIssue({
        code: 'custom',
        path: ['library', 'type'],
        message: 'editorial adaptation requires an editorial or legacy material parent',
      });
    if (source.adaptation.publication.type !== 'editorial')
      context.addIssue({
        code: 'custom',
        path: ['adaptation', 'publication', 'type'],
        message: 'editorial adaptation publication must use editorial type',
      });
    if (source.adaptation.publication.assetId !== source.adaptation.assetId)
      context.addIssue({
        code: 'custom',
        path: ['adaptation', 'publication', 'assetId'],
        message: 'editorial adaptation publication assetId must match adapted assetId',
      });
  });

const overlaySourceSchema = z.union([
  generatedTextOverlaySchema,
  adaptedEditorialOverlaySchema,
  libraryImageOverlaySchema,
]);

const shotEntitySchema = z.object({
  id: localIdSchema,
  geometry: localIdSchema,
  role: z.enum(['environment', 'character', 'prop', 'set-dressing']),
  transform: sceneTransformSchema.default({
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  }),
  placement: z
    .object({
      entityId: localIdSchema,
      attachmentId: localIdSchema,
      offset: cinematicVec3Schema.default([0, 0, 0]),
    })
    .optional(),
  motion: z
    .object({
      source: localIdSchema,
      startFrame: z.number().int().nonnegative().default(0),
      endFrame: z.number().int().positive().optional(),
      sourceStartSeconds: z.number().nonnegative().default(0),
      sourceEndSeconds: z.number().positive().optional(),
    })
    .optional(),
  wardrobe: z
    .array(
      z.object({
        clothing: localIdSchema,
      }),
    )
    .default([]),
});

const campaignShotSchema = z
  .object({
    id: localIdSchema,
    frames: z.number().int().positive(),
    entities: z.array(shotEntitySchema).min(1),
    camera: z.object({ keyframes: z.array(cameraTemplateKeyframeSchema).min(2) }),
    lighting: localIdSchema.optional(),
    lights: z.array(cinematicLightSchema).default([]),
    atmosphere: optionalAtmosphereSchema,
    vfx: localIdSchema.optional(),
    finish: localIdSchema.optional(),
    overlays: z
      .array(
        z.object({
          overlay: localIdSchema,
          startSeconds: z.number().nonnegative(),
          endSeconds: z.number().positive(),
          opacity: z.number().min(0).max(1).default(1),
          fadeInSeconds: z.number().nonnegative().default(0),
          fadeOutSeconds: z.number().nonnegative().default(0),
        }),
      )
      .default([]),
    renderGates: z.array(cinematicRenderGateSchema).default([]),
    qualityGates: z.array(cinematicQualityGateSchema).default([]),
    landmarks: z.array(cinematicLandmarkSchema).min(2),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .superRefine((shot, ctx) => {
    if (!shot.lighting && !shot.lights.length)
      ctx.addIssue({
        code: 'custom',
        path: ['lights'],
        message: 'shot requires a lighting source or at least one inline light',
      });
    if (shot.atmosphere && shot.vfx)
      ctx.addIssue({
        code: 'custom',
        path: ['atmosphere'],
        message: 'shot cannot combine inline atmosphere and a reusable VFX source',
      });
  });

export const declarativeCinematicCampaignSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(/^campaign\.[a-z0-9-]+(?:\.[a-z0-9-]+)*$/),
    fps: z.number().int().min(12).max(120),
    resolution: cinematicResolutionSchema,
    assetLibrary: relativePathSchema.default('../../library'),
    geometry: z.array(geometrySourceSchema).min(1),
    audioSources: z.array(audioSourceSchema).default([]),
    vfxSources: z.array(vfxSourceSchema).default([]),
    finishSources: z.array(finishSourceSchema).default([]),
    materialSources: z.array(materialSourceSchema).default([]),
    clothingSources: z.array(clothingSourceSchema).default([]),
    lightingSources: z.array(lightingSourceSchema).default([]),
    motions: z.array(motionSourceSchema).default([]),
    motionTimelines: z.array(motionTimelineSchema).default([]),
    overlays: z.array(overlaySourceSchema).default([]),
    soundtrack: soundtrackPlanSchema,
    soundtrackPath: relativePathSchema,
    speechPublications: z
      .array(
        z.object({
          cue: localIdSchema,
          publication: campaignAssetPublicationSchema,
        }),
      )
      .default([]),
    audiovisualBindings: z
      .array(
        z.object({
          id: localIdSchema,
          motion: localIdSchema,
          audioCue: localIdSchema,
          targetGeometry: localIdSchema,
          toleranceFrames: z.number().int().min(0).max(2).default(1),
        }),
      )
      .default([]),
    shots: z.array(campaignShotSchema).min(1),
    delivery: z.object({
      id: z.string().regex(/^edit\.[a-z0-9-]+(?:\.[a-z0-9-]+)*$/),
      directory: relativePathSchema.default('delivery'),
      codec: z.literal('h264').default('h264'),
      pixelFormat: z.literal('yuv420p').default('yuv420p'),
      fastStart: z.boolean().default(true),
    }),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .superRefine((campaign, ctx) => {
    const unique = (values: string[], path: string) => {
      const seen = new Set<string>();
      values.forEach((value, index) => {
        if (seen.has(value))
          ctx.addIssue({
            code: 'custom',
            path: [path, index, 'id'],
            message: `duplicate ${path} id`,
          });
        seen.add(value);
      });
      return seen;
    };
    const geometry = unique(
      campaign.geometry.map((item) => item.id),
      'geometry',
    );
    const motions = unique(
      campaign.motions.map((item) => item.id),
      'motions',
    );
    const timelines = unique(
      campaign.motionTimelines.map((item) => item.id),
      'motionTimelines',
    );
    const allMotions = new Set([...motions, ...timelines]);
    const overlays = unique(
      campaign.overlays.map((item) => item.id),
      'overlays',
    );
    const shots = unique(
      campaign.shots.map((item) => item.id),
      'shots',
    );
    const audioSources = unique(
      campaign.audioSources.map((item) => item.id),
      'audioSources',
    );
    const vfxSources = unique(
      campaign.vfxSources.map((item) => item.id),
      'vfxSources',
    );
    const finishSources = unique(
      campaign.finishSources.map((item) => item.id),
      'finishSources',
    );
    const materialSources = unique(
      campaign.materialSources.map((item) => item.id),
      'materialSources',
    );
    const clothingSources = unique(
      campaign.clothingSources.map((item) => item.id),
      'clothingSources',
    );
    const lightingSources = unique(
      campaign.lightingSources.map((item) => item.id),
      'lightingSources',
    );
    const validatePublication = (
      publication: z.infer<typeof campaignAssetPublicationSchema> | undefined,
      path: (string | number)[],
    ) => {
      if (!publication) return;
      if (!publication.assetId.startsWith(`${publication.type}.`))
        ctx.addIssue({
          code: 'custom',
          path: [...path, 'assetId'],
          message: 'publication assetId must begin with its asset type',
        });
      for (const shot of publication.verification.shots)
        if (!shots.has(shot))
          ctx.addIssue({
            code: 'custom',
            path: [...path, 'verification', 'shots'],
            message: `publication references unknown verification shot '${shot}'`,
          });
    };
    campaign.geometry.forEach((source, index) =>
      validatePublication(source.recipe?.publication, ['geometry', index, 'recipe', 'publication']),
    );
    campaign.geometry.forEach((source, index) =>
      validatePublication(source.adaptation?.publication, [
        'geometry',
        index,
        'adaptation',
        'publication',
      ]),
    );
    campaign.geometry.forEach((source, sourceIndex) =>
      source.materialBindings.forEach((binding, bindingIndex) => {
        if (!materialSources.has(binding.material))
          ctx.addIssue({
            code: 'custom',
            path: ['geometry', sourceIndex, 'materialBindings', bindingIndex, 'material'],
            message: `geometry references unknown material source '${binding.material}'`,
          });
      }),
    );
    campaign.motions.forEach((source, index) =>
      validatePublication(source.publication, ['motions', index, 'publication']),
    );
    campaign.motions.forEach((source, index) => {
      validatePublication(source.adaptation?.publication, [
        'motions',
        index,
        'adaptation',
        'publication',
      ]);
      if (source.adaptation && !geometry.has(source.adaptation.targetGeometry))
        ctx.addIssue({
          code: 'custom',
          path: ['motions', index, 'adaptation', 'targetGeometry'],
          message: `unknown motion retarget geometry '${source.adaptation.targetGeometry}'`,
        });
    });
    campaign.motionTimelines.forEach((timeline, index) => {
      validatePublication(timeline.publication, ['motionTimelines', index, 'publication']);
      validatePublication(timeline.derivation?.publication, [
        'motionTimelines',
        index,
        'derivation',
        'publication',
      ]);
      if (timeline.publication && timeline.derivation)
        ctx.addIssue({
          code: 'custom',
          path: ['motionTimelines', index],
          message: 'motion timeline cannot use both publication and derivation publication',
        });
      if (timeline.publication && timeline.publication.type !== 'motion')
        ctx.addIssue({
          code: 'custom',
          path: ['motionTimelines', index, 'publication', 'type'],
          message: 'motion timeline publication must use motion type',
        });
      if (timeline.derivation) {
        if (timeline.derivation.publication.type !== 'motion')
          ctx.addIssue({
            code: 'custom',
            path: ['motionTimelines', index, 'derivation', 'publication', 'type'],
            message: 'layered performance publication must use motion type',
          });
        if (timeline.derivation.publication.assetId !== timeline.clipId)
          ctx.addIssue({
            code: 'custom',
            path: ['motionTimelines', index, 'derivation', 'publication', 'assetId'],
            message: 'layered performance publication assetId must match timeline clipId',
          });
        const target = campaign.geometry.find(
          (source) => source.id === timeline.derivation!.targetGeometry,
        );
        if (!target)
          ctx.addIssue({
            code: 'custom',
            path: ['motionTimelines', index, 'derivation', 'targetGeometry'],
            message: `unknown layered performance target geometry '${timeline.derivation.targetGeometry}'`,
          });
        else if (!target.library)
          ctx.addIssue({
            code: 'custom',
            path: ['motionTimelines', index, 'derivation', 'targetGeometry'],
            message: 'layered performance derivation requires a verified library target geometry',
          });
        for (const [layerIndex, layer] of timeline.layers.entries()) {
          const source = campaign.motions.find((motion) => motion.id === layer.motion);
          if (source && (!source.library || source.adaptation))
            ctx.addIssue({
              code: 'custom',
              path: ['motionTimelines', index, 'layers', layerIndex, 'motion'],
              message:
                'layered performance derivation requires directly reused verified library motion inputs',
            });
          if (layer.mode !== 'base' && !layer.joints?.length && !layer.morphTargets?.length)
            ctx.addIssue({
              code: 'custom',
              path: ['motionTimelines', index, 'layers', layerIndex, 'joints'],
              message:
                'derived non-base motion layers require an explicit joint or morph-target mask',
            });
          if (layer.mode !== 'base' && layer.minimumContribution === undefined)
            ctx.addIssue({
              code: 'custom',
              path: ['motionTimelines', index, 'layers', layerIndex, 'minimumContribution'],
              message: 'derived non-base motion layers require a minimum measurable contribution',
            });
        }
      }
    });
    const publishedSpeechCues = new Set<string>();
    campaign.speechPublications.forEach((speech, index) => {
      validatePublication(speech.publication, ['speechPublications', index, 'publication']);
      if (speech.publication.type !== 'audio')
        ctx.addIssue({
          code: 'custom',
          path: ['speechPublications', index, 'publication', 'type'],
          message: 'speech publication must use audio type',
        });
      const cue = campaign.soundtrack.cues.find((candidate) => candidate.id === speech.cue);
      if (!cue || cue.kind !== 'speech')
        ctx.addIssue({
          code: 'custom',
          path: ['speechPublications', index, 'cue'],
          message: 'speech publication requires a declared speech cue',
        });
      if (publishedSpeechCues.has(speech.cue))
        ctx.addIssue({
          code: 'custom',
          path: ['speechPublications', index, 'cue'],
          message: `duplicate speech publication for cue '${speech.cue}'`,
        });
      publishedSpeechCues.add(speech.cue);
    });
    campaign.audioSources.forEach((source, index) => {
      if (source.library.type !== 'audio')
        ctx.addIssue({
          code: 'custom',
          path: ['audioSources', index, 'library', 'type'],
          message: 'audio source requirements must use audio type',
        });
    });
    campaign.lightingSources.forEach((source, index) => {
      if (!['environment', 'lighting'].includes(source.library.type))
        ctx.addIssue({
          code: 'custom',
          path: ['lightingSources', index, 'library', 'type'],
          message: 'lighting source requirements must use lighting or legacy environment type',
        });
      validatePublication(source.adaptation?.publication, [
        'lightingSources',
        index,
        'adaptation',
        'publication',
      ]);
    });
    campaign.overlays.forEach((source, index) => {
      if ('library' in source && !['material', 'editorial'].includes(source.library.type))
        ctx.addIssue({
          code: 'custom',
          path: ['overlays', index, 'library', 'type'],
          message: 'library image overlay requirements must use editorial or legacy material type',
        });
      if ('adaptation' in source)
        validatePublication(source.adaptation.publication, [
          'overlays',
          index,
          'adaptation',
          'publication',
        ]);
    });
    campaign.vfxSources.forEach((source, index) =>
      validatePublication(source.adaptation?.publication, [
        'vfxSources',
        index,
        'adaptation',
        'publication',
      ]),
    );
    campaign.materialSources.forEach((source, index) =>
      validatePublication(source.adaptation?.publication, [
        'materialSources',
        index,
        'adaptation',
        'publication',
      ]),
    );
    campaign.clothingSources.forEach((source, index) => {
      validatePublication(source.adaptation?.publication, [
        'clothingSources',
        index,
        'adaptation',
        'publication',
      ]);
      if (source.adaptation && !geometry.has(source.adaptation.targetGeometry))
        ctx.addIssue({
          code: 'custom',
          path: ['clothingSources', index, 'adaptation', 'targetGeometry'],
          message: `unknown clothing-fit target geometry '${source.adaptation.targetGeometry}'`,
        });
      if (source.adaptation?.publication) {
        const target = campaign.geometry.find(
          (geometrySource) => geometrySource.id === source.adaptation!.targetGeometry,
        );
        if (target && !target.library)
          ctx.addIssue({
            code: 'custom',
            path: ['clothingSources', index, 'adaptation', 'targetGeometry'],
            message: 'published clothing fit requires a verified library target geometry',
          });
      }
    });
    campaign.soundtrack.cues.forEach((cue, index) => {
      if (cue.kind === 'audio-source' && (!cue.source || !audioSources.has(cue.source)))
        ctx.addIssue({
          code: 'custom',
          path: ['soundtrack', 'cues', index, 'source'],
          message: `audio cue references unknown source '${cue.source}'`,
        });
    });
    unique(
      campaign.audiovisualBindings.map((item) => item.id),
      'audiovisualBindings',
    );
    campaign.audiovisualBindings.forEach((binding, index) => {
      if (!allMotions.has(binding.motion))
        ctx.addIssue({
          code: 'custom',
          path: ['audiovisualBindings', index, 'motion'],
          message: `audiovisual binding references unknown motion '${binding.motion}'`,
        });
      if (!geometry.has(binding.targetGeometry))
        ctx.addIssue({
          code: 'custom',
          path: ['audiovisualBindings', index, 'targetGeometry'],
          message: `audiovisual binding references unknown geometry '${binding.targetGeometry}'`,
        });
      const cue = campaign.soundtrack.cues.find((candidate) => candidate.id === binding.audioCue);
      if (!cue || (cue.kind !== 'speech' && cue.kind !== 'audio-source'))
        ctx.addIssue({
          code: 'custom',
          path: ['audiovisualBindings', index, 'audioCue'],
          message: 'audiovisual binding requires a speech or audio-source cue',
        });
      if (cue) {
        const placements = campaign.shots.flatMap((shot, shotIndex) => {
          const priorFrames = campaign.shots
            .slice(0, shotIndex)
            .reduce((sum, candidate) => sum + candidate.frames, 0);
          return shot.entities.flatMap((entity) =>
            entity.geometry === binding.targetGeometry && entity.motion?.source === binding.motion
              ? [
                  {
                    startSeconds: (priorFrames + entity.motion.startFrame) / campaign.fps,
                    endSeconds:
                      (priorFrames + (entity.motion.endFrame ?? shot.frames)) / campaign.fps,
                  },
                ]
              : [],
          );
        });
        const tolerance = binding.toleranceFrames / campaign.fps;
        if (
          placements.length === 0 ||
          placements.some(
            (placement) =>
              Math.abs(placement.startSeconds - cue.startSeconds) > tolerance + 1e-8 ||
              Math.abs(placement.endSeconds - cue.endSeconds) > tolerance + 1e-8,
          )
        )
          ctx.addIssue({
            code: 'custom',
            path: ['audiovisualBindings', index],
            message: `audiovisual binding '${binding.id}' is not aligned within ${binding.toleranceFrames} frame(s)`,
          });
      }
    });
    for (const [sourceIndex, source] of campaign.motions.entries()) {
      if (source.recipe?.kind === 'targeted-turn' && !geometry.has(source.recipe.target.geometry))
        ctx.addIssue({
          code: 'custom',
          path: ['motions', sourceIndex, 'recipe', 'target', 'geometry'],
          message: `unknown target geometry '${source.recipe.target.geometry}'`,
        });
      if (source.recipe?.kind === 'speech-visemes') {
        const recipe = source.recipe;
        if (!geometry.has(source.recipe.targetGeometry))
          ctx.addIssue({
            code: 'custom',
            path: ['motions', sourceIndex, 'recipe', 'targetGeometry'],
            message: `unknown speech target geometry '${source.recipe.targetGeometry}'`,
          });
        const cue = campaign.soundtrack.cues.find(
          (candidate) => candidate.id === recipe.soundtrackCue,
        );
        if (!cue || cue.kind !== 'speech')
          ctx.addIssue({
            code: 'custom',
            path: ['motions', sourceIndex, 'recipe', 'soundtrackCue'],
            message: `speech motion requires a declared speech soundtrack cue`,
          });
        else if (
          Math.abs(
            Math.round((cue.endSeconds - cue.startSeconds) * campaign.fps) / campaign.fps -
              (cue.endSeconds - cue.startSeconds),
          ) > 1e-8
        )
          ctx.addIssue({
            code: 'custom',
            path: ['soundtrack', 'cues'],
            message: `speech cue '${cue.id}' interval must resolve to an exact frame count`,
          });
        if (cue?.kind === 'speech') {
          const bindings = campaign.shots.flatMap((shot, shotIndex) => {
            const precedingFrames = campaign.shots
              .slice(0, shotIndex)
              .reduce((sum, candidate) => sum + candidate.frames, 0);
            return shot.entities.flatMap((entity) => {
              if (!entity.motion || entity.motion.source !== source.id) return [];
              return [
                {
                  shot: shot.id,
                  startSeconds: (precedingFrames + entity.motion.startFrame) / campaign.fps,
                  endSeconds:
                    (precedingFrames + (entity.motion.endFrame ?? shot.frames)) / campaign.fps,
                },
              ];
            });
          });
          if (!bindings.length)
            ctx.addIssue({
              code: 'custom',
              path: ['motions', sourceIndex],
              message: `speech motion '${source.id}' is not bound to any shot entity`,
            });
          for (const binding of bindings)
            if (
              Math.abs(binding.startSeconds - cue.startSeconds) > 1 / campaign.fps + 1e-8 ||
              Math.abs(binding.endSeconds - cue.endSeconds) > 1 / campaign.fps + 1e-8
            )
              ctx.addIssue({
                code: 'custom',
                path: ['motions', sourceIndex],
                message: `speech motion '${source.id}' in shot '${binding.shot}' is not aligned to cue '${cue.id}' within one frame`,
              });
        }
      }
    }
    for (const [timelineIndex, timeline] of campaign.motionTimelines.entries())
      for (const [layerIndex, layer] of timeline.layers.entries()) {
        if (!motions.has(layer.motion))
          ctx.addIssue({
            code: 'custom',
            path: ['motionTimelines', timelineIndex, 'layers', layerIndex, 'motion'],
            message: `unknown source motion '${layer.motion}'`,
          });
        if (layer.startFrame >= layer.endFrame || layer.endFrame > timeline.frames)
          ctx.addIssue({
            code: 'custom',
            path: ['motionTimelines', timelineIndex, 'layers', layerIndex],
            message: 'motion layer must occupy a positive frame interval inside its timeline',
          });
        if (layer.fadeInFrames + layer.fadeOutFrames > layer.endFrame - layer.startFrame)
          ctx.addIssue({
            code: 'custom',
            path: ['motionTimelines', timelineIndex, 'layers', layerIndex],
            message: 'motion layer fades exceed its interval',
          });
      }
    for (const [shotIndex, shot] of campaign.shots.entries()) {
      if (shot.lighting && !lightingSources.has(shot.lighting))
        ctx.addIssue({
          code: 'custom',
          path: ['shots', shotIndex, 'lighting'],
          message: `shot references unknown lighting source '${shot.lighting}'`,
        });
      if (shot.vfx && !vfxSources.has(shot.vfx))
        ctx.addIssue({
          code: 'custom',
          path: ['shots', shotIndex, 'vfx'],
          message: `shot references unknown VFX source '${shot.vfx}'`,
        });
      if (shot.finish && !finishSources.has(shot.finish))
        ctx.addIssue({
          code: 'custom',
          path: ['shots', shotIndex, 'finish'],
          message: `shot references unknown cinematic finish source '${shot.finish}'`,
        });
      const duration = shot.frames / campaign.fps;
      const entities = unique(
        shot.entities.map((item) => item.id),
        `shots.${shotIndex}.entities`,
      );
      for (const [entityIndex, entity] of shot.entities.entries()) {
        if (!geometry.has(entity.geometry))
          ctx.addIssue({
            code: 'custom',
            path: ['shots', shotIndex, 'entities', entityIndex, 'geometry'],
            message: `unknown geometry source '${entity.geometry}'`,
          });
        else if (entity.motion && !allMotions.has(entity.motion.source))
          ctx.addIssue({
            code: 'custom',
            path: ['shots', shotIndex, 'entities', entityIndex, 'motion', 'source'],
            message: `unknown motion '${entity.motion.source}'`,
          });
        else if (
          entity.motion &&
          (entity.motion.startFrame >= (entity.motion.endFrame ?? shot.frames) ||
            (entity.motion.endFrame ?? shot.frames) > shot.frames)
        )
          ctx.addIssue({
            code: 'custom',
            path: ['shots', shotIndex, 'entities', entityIndex, 'motion'],
            message: 'entity motion binding must occupy a positive frame interval inside the shot',
          });
        entity.wardrobe.forEach((item, wardrobeIndex) => {
          if (!clothingSources.has(item.clothing))
            ctx.addIssue({
              code: 'custom',
              path: ['shots', shotIndex, 'entities', entityIndex, 'wardrobe', wardrobeIndex],
              message: `entity references unknown clothing source '${item.clothing}'`,
            });
        });
        if (entity.placement && !entities.has(entity.placement.entityId))
          ctx.addIssue({
            code: 'custom',
            path: ['shots', shotIndex, 'entities', entityIndex, 'placement', 'entityId'],
            message: `unknown placement entity '${entity.placement.entityId}'`,
          });
        if (entity.placement?.entityId === entity.id)
          ctx.addIssue({
            code: 'custom',
            path: ['shots', shotIndex, 'entities', entityIndex, 'placement', 'entityId'],
            message: 'entity cannot place itself from its own attachment',
          });
      }
      for (const [keyframeIndex, keyframe] of shot.camera.keyframes.entries()) {
        if (keyframe.time > duration)
          ctx.addIssue({
            code: 'custom',
            path: ['shots', shotIndex, 'camera', 'keyframes', keyframeIndex, 'time'],
            message: 'camera keyframe exceeds shot duration',
          });
        for (const field of ['position', 'target'] as const) {
          const reference = keyframe[field];
          if ('entityId' in reference && !entities.has(reference.entityId))
            ctx.addIssue({
              code: 'custom',
              path: ['shots', shotIndex, 'camera', 'keyframes', keyframeIndex, field],
              message: `semantic point references unknown entity '${reference.entityId}'`,
            });
        }
      }
      if (shot.camera.keyframes[0]?.time !== 0 || shot.camera.keyframes.at(-1)?.time !== duration)
        ctx.addIssue({
          code: 'custom',
          path: ['shots', shotIndex, 'camera'],
          message: 'camera must span exactly from zero to the frame-derived shot duration',
        });
      for (const [overlayIndex, use] of shot.overlays.entries())
        if (!overlays.has(use.overlay))
          ctx.addIssue({
            code: 'custom',
            path: ['shots', shotIndex, 'overlays', overlayIndex, 'overlay'],
            message: `unknown overlay '${use.overlay}'`,
          });
    }
    const totalFrames = campaign.shots.reduce((sum, shot) => sum + shot.frames, 0);
    if (Math.abs(campaign.soundtrack.durationSeconds - totalFrames / campaign.fps) > 1e-8)
      ctx.addIssue({
        code: 'custom',
        path: ['soundtrack', 'durationSeconds'],
        message: 'soundtrack duration must equal the frame-derived edit duration',
      });
  });

export type DeclarativeCinematicCampaign = z.infer<typeof declarativeCinematicCampaignSchema>;

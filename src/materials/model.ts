import { z } from 'zod';
import { materialTextureChannelSchema, sourceSha256Schema } from '../assets/sources/model.js';

const colorSchema = z.tuple([
  z.number().min(0).max(1),
  z.number().min(0).max(1),
  z.number().min(0).max(1),
  z.number().min(0).max(1),
]);

const surfaceAxisSchema = z.enum(['x', 'y', 'z']);

export const textureSurfaceCompositionSchema = z.enum([
  'continuous-layout-scan',
  'homogeneous-unit-material',
  'facade-course-pattern',
]);

export const constructionDomainSchema = z.enum([
  'flat-ground-surface',
  'modeled-paving-unit',
  'paving-joint-substrate',
  'flat-facade-surface',
  'modeled-masonry-unit',
  'monolithic-architectural-surface',
  'natural-rock-surface',
  'prop-surface',
]);

export const textureMaterialSuitabilitySchema = z
  .object({
    composition: textureSurfaceCompositionSchema,
    intendedConstructionDomains: z.array(constructionDomainSchema).min(1),
    rationale: z.string().min(1),
  })
  .superRefine((suitability, ctx) => {
    if (
      new Set(suitability.intendedConstructionDomains).size !==
      suitability.intendedConstructionDomains.length
    )
      ctx.addIssue({
        code: 'custom',
        path: ['intendedConstructionDomains'],
        message: 'intended construction domains must be unique',
      });
  });

const boundedTextureAppearanceSchema = z.object({
  exposureStops: z.number().min(-1).max(1),
  saturationScale: z.number().min(0.65).max(1.35),
  hueShiftDegrees: z.number().min(-12).max(12),
  roughnessScale: z.number().min(0.7).max(1.3),
  roughnessOffset: z.number().min(-0.2).max(0.2),
  weatheringAmount: z.number().min(0).max(1),
});

const textureMacroVariationSchema = z
  .object({
    seed: z.number().int(),
    scaleMeters: z.number().positive(),
    valueAmplitude: z.number().min(0).max(0.25),
    saturationAmplitude: z.number().min(0).max(0.25),
    hueAmplitudeDegrees: z.number().min(0).max(12),
    roughnessAmplitude: z.number().min(0).max(0.2),
    weatheringAmplitude: z.number().min(0).max(0.75),
  })
  .superRefine((variation, ctx) => {
    if (
      variation.valueAmplitude === 0 &&
      variation.saturationAmplitude === 0 &&
      variation.hueAmplitudeDegrees === 0 &&
      variation.roughnessAmplitude === 0 &&
      variation.weatheringAmplitude === 0
    )
      ctx.addIssue({
        code: 'custom',
        path: [],
        message: 'texture placement requires at least one bounded macro variation',
      });
  });

export const textureMaterialPlacementSchema = z.object({
  scalePolicy: z.literal('preserve-source-physical-scale'),
  orientation: z.enum([
    'uv-authored',
    'unit-local-uv-meters',
    'world-horizontal',
    'world-vertical',
  ]),
  offsetMeters: z.tuple([z.number().finite(), z.number().finite()]),
  rotationDegrees: z.number().min(-180).max(180),
  appearance: boundedTextureAppearanceSchema,
  macroVariation: textureMacroVariationSchema,
});

export const textureMaterialApplicationSchema = z.object({
  constructionDomain: constructionDomainSchema,
  placement: textureMaterialPlacementSchema,
});

export const hashBoundTextureMapSetSchema = z
  .object({
    kind: z.literal('hash-bound'),
    source: z.object({
      provider: z.enum(['ambientcg', 'poly-haven']),
      sourceIdentitySha256: sourceSha256Schema,
      manifestSha256: sourceSha256Schema,
      licenceSpdx: z.literal('CC0-1.0'),
    }),
    physicalScale: z.object({
      widthMeters: z.number().positive(),
      heightMeters: z.number().positive(),
    }),
    suitability: textureMaterialSuitabilitySchema,
    application: textureMaterialApplicationSchema.optional(),
    channels: z.array(materialTextureChannelSchema).min(3),
  })
  .superRefine((textureMaps, ctx) => {
    const semantics = textureMaps.channels.map((channel) => channel.semantic);
    if (new Set(semantics).size !== semantics.length)
      ctx.addIssue({
        code: 'custom',
        path: ['channels'],
        message: 'texture-map channel semantics must be unique',
      });
    for (const required of ['base-color', 'normal', 'roughness'] as const)
      if (!semantics.includes(required))
        ctx.addIssue({
          code: 'custom',
          path: ['channels'],
          message: `texture-map set requires ${required}`,
        });
    for (const [index, channel] of textureMaps.channels.entries()) {
      const expectedColorSpace = channel.semantic === 'base-color' ? 'srgb-texture' : 'non-color';
      if (channel.colorSpace !== expectedColorSpace)
        ctx.addIssue({
          code: 'custom',
          path: ['channels', index, 'colorSpace'],
          message: `${channel.semantic} texture must use ${expectedColorSpace}`,
        });
      if (channel.semantic === 'normal' && channel.normalConvention !== 'opengl-positive-green')
        ctx.addIssue({
          code: 'custom',
          path: ['channels', index, 'normalConvention'],
          message: 'normal texture must use the canonical OpenGL convention',
        });
    }
  });

const surfacePatternSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('isotropic') }),
  z.object({
    kind: z.literal('masonry-bond'),
    projectionAxes: z
      .tuple([surfaceAxisSchema, surfaceAxisSchema])
      .refine(([horizontal, vertical]) => horizontal !== vertical, {
        message: 'masonry projection axes must be distinct',
      }),
    unitWidthMeters: z.number().positive(),
    unitHeightMeters: z.number().positive(),
    mortarWidthMeters: z.number().positive(),
    rowOffset: z.number().min(0).max(1).default(0.5),
    mortarColor: colorSchema,
    edgeReliefMeters: z.number().min(0).max(0.03).default(0.004),
    irregularityMeters: z.number().min(0).max(0.03).default(0.003),
  }),
  z.object({
    kind: z.literal('directional-wood'),
    grainAxis: surfaceAxisSchema,
    grainWidthMeters: z.number().positive(),
    longitudinalScaleMeters: z.number().positive(),
    distortion: z.number().min(0).max(20).default(4),
    ringContrast: z.number().min(0).max(1).default(0.55),
  }),
  z.object({
    kind: z.literal('mineral-plaster'),
    trowelScaleMeters: z.number().positive(),
    aggregateScaleMeters: z.number().positive(),
    trowelContrast: z.number().min(0).max(1),
    porosity: z.number().min(0).max(1),
  }),
  z.object({
    kind: z.literal('cut-stone'),
    beddingAxis: surfaceAxisSchema,
    beddingScaleMeters: z.number().positive(),
    grainScaleMeters: z.number().positive(),
    veinContrast: z.number().min(0).max(1),
    poreAmount: z.number().min(0).max(1),
  }),
  z.object({
    kind: z.literal('architectural-glazing'),
    ior: z.number().min(1).max(2.5),
    transmission: z.number().min(0).max(1),
    thicknessMeters: z.number().positive(),
    microScratchScaleMeters: z.number().positive(),
    dirtAmount: z.number().min(0).max(1),
  }),
  z.object({
    kind: z.literal('woven-textile'),
    warpAxis: surfaceAxisSchema,
    warpSpacingMeters: z.number().positive(),
    weftSpacingMeters: z.number().positive(),
    threadContrast: z.number().min(0).max(1),
    fuzzAmount: z.number().min(0).max(1),
  }),
  z.object({
    kind: z.literal('brushed-metal'),
    brushAxis: surfaceAxisSchema,
    brushSpacingMeters: z.number().positive(),
    scratchContrast: z.number().min(0).max(1),
    patinaAmount: z.number().min(0).max(1),
  }),
  z.object({
    kind: z.literal('glazed-ceramic'),
    glazeAmount: z.number().min(0).max(1),
    glazeRoughness: z.number().min(0).max(1),
    speckleScaleMeters: z.number().positive(),
    speckleAmount: z.number().min(0).max(1),
  }),
]);

export const surfaceMaterialSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(/^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)*$/),
    shadingModel: z.literal('metallic-roughness'),
    baseColor: z.object({
      kind: z.enum(['constant', 'procedural-palette']),
      colors: z.array(colorSchema).min(1),
      scaleMeters: z.number().positive().default(0.45),
      seed: z.number().int().default(1),
    }),
    normal: z.object({
      kind: z.enum(['flat', 'geometry-relief', 'procedural-noise']),
      strength: z.number().min(0).max(2),
      scaleMeters: z.number().positive(),
    }),
    roughness: z.object({
      minimum: z.number().min(0).max(1),
      maximum: z.number().min(0).max(1),
      variationScaleMeters: z.number().positive(),
      wetness: z.number().min(0).max(1).default(0),
    }),
    surfaceWaterResponse: z
      .object({
        absorption: z.object({
          capacityMeters: z.number().nonnegative().max(0.2),
          rateMetersPerSecond: z.number().nonnegative().max(0.02),
          initialSaturation: z.number().min(0).max(1).default(0),
        }),
        retention: z.object({
          filmCapacityMeters: z.number().nonnegative().max(0.02),
          edgeCapacityMeters: z.number().nonnegative().max(0.05),
          maximumPuddleDepthMeters: z.number().nonnegative().max(0.25),
        }),
        wetRoughness: z.object({
          multiplier: z.number().min(0).max(1),
          floor: z.number().min(0).max(1),
        }),
        splash: z.object({
          minimumFreeWaterDepthMeters: z.number().nonnegative().max(0.05),
          maximumSlopeDegrees: z.number().min(0).max(45),
        }),
      })
      .optional(),
    pattern: surfacePatternSchema.default({ kind: 'isotropic' }),
    weathering: z
      .object({
        verticalStreaks: z
          .object({
            amount: z.number().min(0).max(1),
            widthMeters: z.number().positive(),
            lengthMeters: z.number().positive(),
          })
          .optional(),
        lowerDamp: z
          .object({
            amount: z.number().min(0).max(1),
            heightMeters: z.number().positive(),
          })
          .optional(),
        surfaceDirt: z
          .object({
            amount: z.number().min(0).max(1),
            scaleMeters: z.number().positive(),
          })
          .optional(),
      })
      .optional(),
    metallic: z.number().min(0).max(1).default(0),
    textureMaps: hashBoundTextureMapSetSchema.optional(),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .superRefine((material, ctx) => {
    if (material.roughness.minimum > material.roughness.maximum)
      ctx.addIssue({
        code: 'custom',
        path: ['roughness'],
        message: 'roughness minimum must not exceed maximum',
      });
    if (
      material.pattern.kind === 'masonry-bond' &&
      material.pattern.mortarWidthMeters >=
        Math.min(material.pattern.unitWidthMeters, material.pattern.unitHeightMeters) * 0.5
    )
      ctx.addIssue({
        code: 'custom',
        path: ['pattern', 'mortarWidthMeters'],
        message: 'masonry mortar must be narrower than half the smallest masonry unit dimension',
      });
  });

export type SurfaceMaterial = z.infer<typeof surfaceMaterialSchema>;
export type SurfaceWaterMaterialResponse = NonNullable<SurfaceMaterial['surfaceWaterResponse']>;
export type HashBoundTextureMapSet = z.infer<typeof hashBoundTextureMapSetSchema>;
export type ConstructionDomain = z.infer<typeof constructionDomainSchema>;
export type TextureMaterialSuitability = z.infer<typeof textureMaterialSuitabilitySchema>;
export type TextureMaterialApplication = z.infer<typeof textureMaterialApplicationSchema>;

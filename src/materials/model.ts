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
  'paving-border',
  'flat-facade-surface',
  'modeled-masonry-unit',
  'monolithic-architectural-surface',
  'natural-rock-surface',
  'prop-surface',
]);

export const surfaceHistoryV3ParticipationSchema = z.discriminatedUnion('policy', [
  z.object({ policy: z.literal('optical-response') }),
  z.object({
    policy: z.literal('transport-only'),
    rationale: z.string().trim().min(1),
  }),
]);

const constructionNormalResponseSchema = z.object({
  intactStrengthScale: z.number().min(0).max(2),
  changedStrengthScale: z.number().min(0).max(2),
});

export const constructionSurfaceResponseSchema = z
  .discriminatedUnion('kind', [
    z.object({
      kind: z.literal('natural-joint'),
      geometryBasis: z.literal('authored-joint-recession'),
      clogging: z.object({
        driver: z.literal('dirt-coverage'),
        looseWeight: z.number().min(0).max(4),
        persistentWeight: z.number().min(0).max(4),
        onsetCoverage: z.number().min(0).max(1),
        saturationCoverage: z.number().min(0).max(1),
        maximumFillFractionOfRecession: z.number().min(0).max(1),
      }),
      normal: constructionNormalResponseSchema,
    }),
    z.object({
      kind: z.literal('polymeric-joint'),
      geometryBasis: z.literal('authored-joint-recession'),
      coherentFailure: z.object({
        driver: z.literal('traffic-and-throughflow'),
        trafficWeight: z.number().min(0).max(4),
        throughflowWeight: z.number().min(0).max(4),
        onset: z.number().min(0).max(1),
        saturation: z.number().min(0).max(1),
        coherenceScaleMeters: z.number().positive().max(20),
        seed: z.number().int(),
        maximumAdditionalRecessionFraction: z.number().min(0).max(1),
      }),
      normal: constructionNormalResponseSchema,
    }),
    z.object({
      kind: z.literal('paving-border'),
      geometryBasis: z.literal('authored-border-profile'),
      historyFaces: z
        .array(z.enum(['top', 'paving-facing', 'outer-facing']))
        .min(1)
        .refine((faces) => new Set(faces).size === faces.length, 'history faces must be unique'),
      faceTransitionCosine: z.number().min(0).max(1),
      gutterZones: z
        .object({
          coreWidthFraction: z.number().positive().max(1),
          transitionWidthFraction: z.number().nonnegative().max(0.5),
          coreThroughflowCleaning: z.number().min(0).max(1),
          marginRetainedDeposition: z.number().min(0).max(2),
        })
        .optional(),
    }),
    z.object({
      kind: z.literal('exposed-substrate'),
      activation: z.literal('active-history-cells-only'),
      normal: z.object({ strengthScale: z.number().min(0).max(2) }),
      dirtDepositionScale: z.number().min(0).max(2),
    }),
  ])
  .superRefine((response, context) => {
    if (response.kind === 'natural-joint') {
      if (response.clogging.looseWeight + response.clogging.persistentWeight <= 0)
        context.addIssue({
          code: 'custom',
          path: ['clogging'],
          message: 'natural-joint clogging requires at least one positive dirt weight',
        });
      if (response.clogging.saturationCoverage <= response.clogging.onsetCoverage)
        context.addIssue({
          code: 'custom',
          path: ['clogging', 'saturationCoverage'],
          message: 'natural-joint clogging saturation must exceed onset',
        });
    }
    if (response.kind === 'polymeric-joint') {
      if (response.coherentFailure.trafficWeight + response.coherentFailure.throughflowWeight <= 0)
        context.addIssue({
          code: 'custom',
          path: ['coherentFailure'],
          message: 'polymeric-joint failure requires at least one positive causal weight',
        });
      if (response.coherentFailure.saturation <= response.coherentFailure.onset)
        context.addIssue({
          code: 'custom',
          path: ['coherentFailure', 'saturation'],
          message: 'polymeric-joint failure saturation must exceed onset',
        });
    }
    if (
      response.kind === 'paving-border' &&
      response.gutterZones &&
      response.gutterZones.coreWidthFraction + response.gutterZones.transitionWidthFraction * 2 > 1
    )
      context.addIssue({
        code: 'custom',
        path: ['gutterZones', 'transitionWidthFraction'],
        message: 'gutter core and both transition margins must fit within the border width',
      });
  });

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

const coreUnitVariationShape = {
  kind: z.literal('vertex-scalar-attributes-v1'),
  valueAttribute: z.literal('videoer_unit_value_variation'),
  roughnessAttribute: z.literal('videoer_unit_roughness_variation'),
  weatheringAttribute: z.literal('videoer_unit_weathering_variation'),
  valueAmplitude: z.number().min(0).max(0.25),
  roughnessAmplitude: z.number().min(0).max(0.2),
  weatheringAmplitude: z.number().min(0).max(0.75),
} as const;

// Texture placement currently consumes only renderer-neutral per-unit variation.
// Construction-semantic masks live at surface level so no accepted field can be
// silently ignored by a texture backend.
export const textureUnitVariationSchema = z.object(coreUnitVariationShape).strict();

export const surfaceUnitVariationSchema = z
  .object({
    ...coreUnitVariationShape,
    edgeWearAttribute: z.literal('videoer_paving_edge_wear').optional(),
    dirtAccumulationAttribute: z.literal('videoer_paving_dirt_accumulation').optional(),
    edgeWearAmount: z.number().min(0).max(1).optional(),
    dirtAccumulationAmount: z.number().min(0).max(1).optional(),
  })
  .strict()
  .superRefine((variation, context) => {
    for (const [attribute, amount] of [
      ['edgeWearAttribute', 'edgeWearAmount'],
      ['dirtAccumulationAttribute', 'dirtAccumulationAmount'],
    ] as const)
      if ((variation[attribute] === undefined) !== (variation[amount] === undefined))
        context.addIssue({
          code: 'custom',
          path: [attribute],
          message: `${attribute} and ${amount} must be declared together`,
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
  unitVariation: textureUnitVariationSchema.optional(),
});

export const textureMaterialApplicationSchema = z
  .object({
    constructionDomain: constructionDomainSchema,
    placement: textureMaterialPlacementSchema,
  })
  .superRefine((application, context) => {
    if (
      application.placement.unitVariation &&
      application.constructionDomain !== 'modeled-paving-unit'
    )
      context.addIssue({
        code: 'custom',
        path: ['placement', 'unitVariation'],
        message: 'unit variation attributes are only valid on modeled paving units',
      });
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
    kind: z.literal('granular-aggregate'),
    aggregateScaleMeters: z.number().positive().max(0.05),
    finesScaleMeters: z.number().positive().max(0.02),
    aggregateContrast: z.number().min(0).max(1),
    poreAmount: z.number().min(0).max(1),
    compaction: z.number().min(0).max(1),
    embeddedDirtAmount: z.number().min(0).max(1),
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
    historyResponse: z
      .object({
        trafficWear: z.object({
          colorMultiplier: z.number().min(0.5).max(1.5),
          roughnessOffset: z.number().min(-0.5).max(0.5),
        }),
        longTermExposure: z.object({
          colorMultiplier: z.number().min(0.5).max(1.5),
          roughnessOffset: z.number().min(-0.5).max(0.5),
        }),
        runoffStaining: z.object({
          colorMultiplier: z.number().min(0.5).max(1.5),
          roughnessOffset: z.number().min(-0.5).max(0.5),
        }),
        repairInfluence: z.object({
          colorMultiplier: z.number().min(0.5).max(1.5),
          roughnessOffset: z.number().min(-0.5).max(0.5),
        }),
      })
      .optional(),
    historyResponseV3: z
      .object({
        trafficWear: z.object({
          colorMultiplier: z.number().min(0.5).max(1.5),
          roughnessOffset: z.number().min(-0.5).max(0.5),
        }),
        exposureWeathering: z.object({
          colorMultiplier: z.number().min(0.5).max(1.5),
          roughnessOffset: z.number().min(-0.5).max(0.5),
        }),
        runoffStaining: z.object({
          colorMultiplier: z.number().min(0.5).max(1.5),
          roughnessOffset: z.number().min(-0.5).max(0.5),
        }),
        repairInfluence: z.object({
          colorMultiplier: z.number().min(0.5).max(1.5),
          roughnessOffset: z.number().min(-0.5).max(0.5),
        }),
      })
      .optional(),
    dirtMassResponse: z
      .object({
        loose: z.object({
          colorMultiplier: z.number().min(0.25).max(1.5),
          roughnessOffset: z.number().min(-0.5).max(0.5),
        }),
        persistent: z.object({
          colorMultiplier: z.number().min(0.25).max(1.5),
          roughnessOffset: z.number().min(-0.5).max(0.5),
        }),
      })
      .optional(),
    surfaceHistoryV3Participation: surfaceHistoryV3ParticipationSchema.optional(),
    constructionSurfaceResponse: constructionSurfaceResponseSchema.optional(),
    pavingBorder: z
      .object({
        compatibleKinds: z
          .array(z.enum(['kerb', 'gutter', 'soldier-course']))
          .min(1)
          .refine((kinds) => new Set(kinds).size === kinds.length, 'border kinds must be unique'),
      })
      .optional(),
    metallic: z.number().min(0).max(1).default(0),
    unitVariation: surfaceUnitVariationSchema.optional(),
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
    if (material.unitVariation && material.textureMaps?.application?.placement.unitVariation)
      ctx.addIssue({
        code: 'custom',
        path: ['unitVariation'],
        message:
          'surface and texture-placement unit variation cannot be declared together because that would apply the same signal twice',
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
    if (
      material.pattern.kind === 'granular-aggregate' &&
      material.pattern.finesScaleMeters >= material.pattern.aggregateScaleMeters
    )
      ctx.addIssue({
        code: 'custom',
        path: ['pattern', 'finesScaleMeters'],
        message: 'granular fines must be smaller than the aggregate scale',
      });
    if (material.surfaceHistoryV3Participation?.policy === 'optical-response') {
      if (!material.historyResponseV3)
        ctx.addIssue({
          code: 'custom',
          path: ['historyResponseV3'],
          message: 'surface-history v3 optical participation requires historyResponseV3',
        });
      if (!material.dirtMassResponse)
        ctx.addIssue({
          code: 'custom',
          path: ['dirtMassResponse'],
          message: 'surface-history v3 optical participation requires dirtMassResponse',
        });
    }
    if (material.surfaceHistoryV3Participation?.policy === 'transport-only') {
      if (material.historyResponseV3)
        ctx.addIssue({
          code: 'custom',
          path: ['historyResponseV3'],
          message: 'surface-history v3 transport-only participation forbids historyResponseV3',
        });
      if (material.dirtMassResponse)
        ctx.addIssue({
          code: 'custom',
          path: ['dirtMassResponse'],
          message: 'surface-history v3 transport-only participation forbids dirtMassResponse',
        });
    }
    if (material.pavingBorder && material.metadata.constructionDomain !== 'paving-border')
      ctx.addIssue({
        code: 'custom',
        path: ['pavingBorder'],
        message: 'paving-border compatibility requires paving-border construction metadata',
      });
    if (
      material.constructionSurfaceResponse &&
      material.surfaceHistoryV3Participation?.policy !== 'optical-response'
    )
      ctx.addIssue({
        code: 'custom',
        path: ['constructionSurfaceResponse'],
        message: 'construction-surface response requires optical surface-history participation',
      });
    const granularKind = material.metadata.granularKind;
    const requiredGranularResponse =
      granularKind === 'natural-grit'
        ? 'natural-joint'
        : granularKind === 'polymeric-sand'
          ? 'polymeric-joint'
          : granularKind === 'compacted-base'
            ? 'exposed-substrate'
            : undefined;
    if (
      material.metadata.constructionDomain === 'paving-joint-substrate' &&
      requiredGranularResponse &&
      material.constructionSurfaceResponse?.kind !== requiredGranularResponse
    )
      ctx.addIssue({
        code: 'custom',
        path: ['constructionSurfaceResponse'],
        message: `granular kind '${granularKind}' requires ${requiredGranularResponse} construction response`,
      });
    if (material.metadata.constructionDomain === 'paving-border') {
      if (!material.pavingBorder)
        ctx.addIssue({
          code: 'custom',
          path: ['pavingBorder'],
          message: 'paving-border material requires typed border compatibility',
        });
      if (material.constructionSurfaceResponse?.kind !== 'paving-border')
        ctx.addIssue({
          code: 'custom',
          path: ['constructionSurfaceResponse'],
          message: 'paving-border material requires paving-border construction response',
        });
      else if (material.pavingBorder) {
        const gutterCompatible = material.pavingBorder.compatibleKinds.includes('gutter');
        if (gutterCompatible !== Boolean(material.constructionSurfaceResponse.gutterZones))
          ctx.addIssue({
            code: 'custom',
            path: ['constructionSurfaceResponse', 'gutterZones'],
            message: gutterCompatible
              ? 'gutter-compatible material requires gutter zones'
              : 'non-gutter material must not declare gutter zones',
          });
      }
    }
    if (
      material.constructionSurfaceResponse?.kind === 'paving-border' &&
      material.metadata.constructionDomain !== 'paving-border'
    )
      ctx.addIssue({
        code: 'custom',
        path: ['constructionSurfaceResponse'],
        message: 'paving-border construction response requires paving-border material metadata',
      });
    if (
      material.constructionSurfaceResponse &&
      ['natural-joint', 'polymeric-joint', 'exposed-substrate'].includes(
        material.constructionSurfaceResponse.kind,
      ) &&
      material.metadata.constructionDomain !== 'paving-joint-substrate'
    )
      ctx.addIssue({
        code: 'custom',
        path: ['constructionSurfaceResponse'],
        message: `${material.constructionSurfaceResponse.kind} construction response requires paving-joint-substrate material metadata`,
      });
  });

export type SurfaceMaterial = z.infer<typeof surfaceMaterialSchema>;
export type SurfaceWaterMaterialResponse = NonNullable<SurfaceMaterial['surfaceWaterResponse']>;
export type HashBoundTextureMapSet = z.infer<typeof hashBoundTextureMapSetSchema>;
export type ConstructionDomain = z.infer<typeof constructionDomainSchema>;
export type TextureMaterialSuitability = z.infer<typeof textureMaterialSuitabilitySchema>;
export type TextureMaterialApplication = z.infer<typeof textureMaterialApplicationSchema>;

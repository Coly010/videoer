import { z } from 'zod';
import { sceneTransformSchema } from '../interactions/model.js';
import { aerosolLayerSchema, surfaceFluxSchema } from '../vfx/model.js';
import { temporalLightModulationSchema } from '../lighting/temporal.js';

export const cinematicIdentifierSchema = z.string().regex(/^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)*$/);
export const cinematicVec3Schema = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
]);
const colorSchema = z.tuple([
  z.number().min(0).max(1),
  z.number().min(0).max(1),
  z.number().min(0).max(1),
]);

const motionBindingSchema = z.object({
  path: z.string().min(1),
  startSeconds: z.number().nonnegative().default(0),
  endSeconds: z.number().positive().optional(),
  sourceStartSeconds: z.number().nonnegative().default(0),
  sourceEndSeconds: z.number().positive().optional(),
});

export const cinematicSceneEntitySchema = z
  .object({
    id: cinematicIdentifierSchema,
    role: z.enum(['environment', 'character', 'prop', 'set-dressing']),
    geometryPath: z.string().min(1),
    productionRigProfilePath: z.string().min(1).optional(),
    productionCharacterBindingPath: z.string().min(1).optional(),
    surfaceWaterFieldPath: z.string().min(1).optional(),
    surfaceWaterReceiverAppearancePath: z.string().min(1).optional(),
    surfaceHistoryFieldPath: z.string().min(1).optional(),
    surfaceWaterOpticalSurfacePath: z.string().min(1).optional(),
    fixturePath: z.string().min(1).optional(),
    transform: sceneTransformSchema.default({
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    }),
    motion: motionBindingSchema.optional(),
    visible: z.boolean().default(true),
  })
  .superRefine((entity, context) => {
    if (entity.surfaceWaterReceiverAppearancePath && !entity.surfaceWaterFieldPath)
      context.addIssue({
        code: 'custom',
        path: ['surfaceWaterReceiverAppearancePath'],
        message: 'surface-water receiver appearance requires an exact source field path',
      });
    if (entity.surfaceWaterReceiverAppearancePath && entity.role !== 'environment')
      context.addIssue({
        code: 'custom',
        path: ['surfaceWaterReceiverAppearancePath'],
        message: 'surface-water receiver appearance may only bind environment entities',
      });
    if (entity.surfaceWaterOpticalSurfacePath && !entity.surfaceWaterFieldPath)
      context.addIssue({
        code: 'custom',
        path: ['surfaceWaterOpticalSurfacePath'],
        message: 'surface-water optical surfaces require an exact source field path',
      });
    if (entity.surfaceWaterOpticalSurfacePath && entity.role !== 'environment')
      context.addIssue({
        code: 'custom',
        path: ['surfaceWaterOpticalSurfacePath'],
        message: 'surface-water optical surfaces may only bind environment entities',
      });
    if (entity.surfaceHistoryFieldPath && !entity.surfaceWaterFieldPath)
      context.addIssue({
        code: 'custom',
        path: ['surfaceHistoryFieldPath'],
        message: 'surface-history fields require their exact source surface-water field path',
      });
    if (entity.surfaceHistoryFieldPath && entity.role !== 'environment')
      context.addIssue({
        code: 'custom',
        path: ['surfaceHistoryFieldPath'],
        message: 'surface-history fields may only bind environment entities',
      });
  });

export const cinematicCameraKeyframeSchema = z.object({
  time: z.number().nonnegative(),
  position: cinematicVec3Schema,
  target: cinematicVec3Schema,
  lensMillimeters: z.number().min(12).max(300),
  easing: z.enum(['linear', 'ease-in-out']).default('ease-in-out'),
});

/**
 * An editorially meaningful camera brief.  It deliberately describes the
 * movement and the render gates that prove framing, while the keyframes stay
 * the single executable source of camera motion.
 */
export const cinematicShotIntentSchema = z
  .object({
    id: cinematicIdentifierSchema,
    purpose: z.enum([
      'establish',
      'reveal',
      'coverage',
      'dialogue',
      'action',
      'product',
      'transition',
    ]),
    movement: z.enum([
      'locked-off',
      'push-in',
      'pull-back',
      'lateral-move',
      'rising-move',
      'falling-move',
      'free-move',
    ]),
    framingGateIds: z.array(cinematicIdentifierSchema).min(1),
    sampleCount: z.number().int().min(3).max(241).default(25),
    minimumSpeedMetersPerSecond: z.number().nonnegative().default(0),
    maximumSpeedMetersPerSecond: z.number().positive(),
    maximumAccelerationMetersPerSecondSquared: z.number().nonnegative(),
    minimumProgressMeters: z.number().nonnegative().default(0.05),
    distanceToleranceMeters: z.number().nonnegative().default(0.02),
  })
  .superRefine((intent, context) => {
    if (intent.minimumSpeedMetersPerSecond > intent.maximumSpeedMetersPerSecond)
      context.addIssue({
        code: 'custom',
        path: ['minimumSpeedMetersPerSecond'],
        message: 'shot intent minimum speed exceeds maximum speed',
      });
  });

export const cinematicLightSchema = z
  .object({
    id: cinematicIdentifierSchema,
    type: z.enum(['area', 'point', 'spot', 'sun']),
    position: cinematicVec3Schema,
    target: cinematicVec3Schema.optional(),
    color: colorSchema,
    energy: z.number().positive(),
    sizeMeters: z.number().positive().default(1),
    angleDegrees: z.number().min(1).max(179).default(45),
    temporalModulation: temporalLightModulationSchema.optional(),
    temporalSignalId: z
      .string()
      .regex(/^[a-z][a-z0-9-]*$/)
      .optional(),
    visibleSourceRole: z
      .string()
      .regex(/^[a-z][a-z0-9-]*$/)
      .optional(),
    visibleSourceBinding: z
      .object({
        entityId: cinematicIdentifierSchema,
        materialId: z.string().regex(/^[a-z][a-z0-9-]*$/),
      })
      .optional(),
  })
  .superRefine((light, context) => {
    if (
      (light.temporalSignalId || light.visibleSourceRole || light.visibleSourceBinding) &&
      !light.temporalModulation
    )
      context.addIssue({
        code: 'custom',
        path: ['temporalModulation'],
        message: 'temporal signal/source semantics require temporal modulation',
      });
    if (light.temporalModulation && !light.temporalSignalId)
      context.addIssue({
        code: 'custom',
        path: ['temporalSignalId'],
        message: 'modulated scene lights require a stable temporal signal id',
      });
  });

export const cinematicQualityGateSchema = z.discriminatedUnion('type', [
  z.object({
    id: cinematicIdentifierSchema,
    type: z.literal('camera-path-clearance'),
    obstacleEntityIds: z.array(cinematicIdentifierSchema).min(1),
    sampleCount: z.number().int().min(3).max(241).default(25),
    minimumCameraClearanceMeters: z.number().positive().max(5).default(0.15),
    targetOcclusionToleranceMeters: z.number().nonnegative().max(5).default(0.35),
  }),
  z.object({
    id: cinematicIdentifierSchema,
    type: z.literal('camera-shot-intent'),
    intentId: cinematicIdentifierSchema,
  }),
  z.object({
    id: cinematicIdentifierSchema,
    type: z.literal('directional-motion'),
    entityId: cinematicIdentifierSchema,
    minimumDistanceMeters: z.number().positive().default(0.05),
    minimumForwardDot: z.number().min(-1).max(1).default(0.25),
  }),
  z.object({
    id: cinematicIdentifierSchema,
    type: z.literal('axis-crossing'),
    entityId: cinematicIdentifierSchema,
    axis: z.enum(['x', 'y', 'z']),
    boundary: z.number().finite(),
    direction: z.enum(['negative-to-positive', 'positive-to-negative']),
    minimumClearanceMeters: z.number().nonnegative().default(0.05),
  }),
  z.object({
    id: cinematicIdentifierSchema,
    type: z.literal('mutual-facing'),
    firstEntityId: cinematicIdentifierSchema,
    secondEntityId: cinematicIdentifierSchema,
    minimumFacingDot: z.number().min(-1).max(1).default(0.8),
  }),
]);

export const cinematicResolutionSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  percentage: z.number().int().min(1).max(100).default(100),
});

export const cinematicRenderProfileSchema = z.discriminatedUnion('engine', [
  z.object({
    engine: z.literal('cycles-cpu'),
    samples: z.number().int().min(1).max(4096).default(64),
    seed: z.number().int().min(0).max(2_147_483_647).default(1729),
    denoise: z.boolean().default(false),
    intent: z.literal('deterministic-final').default('deterministic-final'),
  }),
  z.object({
    engine: z.literal('eevee-next'),
    samples: z.number().int().min(1).max(4096).default(64),
    intent: z.literal('preview').default('preview'),
  }),
]);

const sceneEnvelopeFogDomainPolicySchema = z
  .object({
    policy: z.literal('scene-envelope-v1'),
    horizontalPaddingMeters: z.number().finite().min(0.25).max(100).default(4),
    belowPaddingMeters: z.number().finite().min(0.1).max(100).default(1),
    abovePaddingMeters: z.number().finite().min(0.25).max(100).default(4),
    minimumHorizontalSpanMeters: z.number().finite().min(1).max(1000).default(12),
    minimumVerticalSpanMeters: z.number().finite().min(1).max(1000).default(6),
    maximumExtentMeters: z.number().finite().min(2).max(5000).default(200),
    edgeFalloffMeters: z.number().finite().min(0.05).max(50).default(1.5),
  })
  .superRefine((domain, context) => {
    const minimumHalfSpan =
      Math.min(domain.minimumHorizontalSpanMeters, domain.minimumVerticalSpanMeters) / 2;
    if (domain.edgeFalloffMeters >= minimumHalfSpan)
      context.addIssue({
        code: 'custom',
        path: ['edgeFalloffMeters'],
        message: 'fog edge falloff must be smaller than half the minimum declared span',
      });
  });

const explicitBoxFogDomainPolicySchema = z
  .object({
    policy: z.literal('explicit-box-v1'),
    boundsMinimum: cinematicVec3Schema,
    boundsMaximum: cinematicVec3Schema,
    maximumExtentMeters: z.number().finite().min(2).max(5000).default(200),
    edgeFalloffMeters: z.number().finite().min(0.05).max(50).default(1.5),
  })
  .superRefine((domain, context) => {
    const extents = domain.boundsMinimum.map(
      (minimum, axis) => domain.boundsMaximum[axis]! - minimum,
    );
    if (extents.some((extent) => extent <= 0 || extent > domain.maximumExtentMeters))
      context.addIssue({
        code: 'custom',
        path: ['boundsMaximum'],
        message: 'explicit fog bounds must be positive and within maximumExtentMeters',
      });
    if (domain.edgeFalloffMeters >= Math.min(...extents) / 2)
      context.addIssue({
        code: 'custom',
        path: ['edgeFalloffMeters'],
        message: 'fog edge falloff must be smaller than half the smallest explicit extent',
      });
  });

export const cinematicFogDomainPolicySchema = z.union([
  sceneEnvelopeFogDomainPolicySchema,
  explicitBoxFogDomainPolicySchema,
]);

export const defaultCinematicFogDomainPolicy = {
  policy: 'scene-envelope-v1',
  horizontalPaddingMeters: 4,
  belowPaddingMeters: 1,
  abovePaddingMeters: 4,
  minimumHorizontalSpanMeters: 12,
  minimumVerticalSpanMeters: 6,
  maximumExtentMeters: 200,
  edgeFalloffMeters: 1.5,
} as const;

export const cinematicAtmosphereSchema = z
  .object({
    worldColor: colorSchema.default([0.01, 0.015, 0.025]),
    fogDensity: z.number().min(0).max(0.2).default(0),
    fogColor: colorSchema.default([0.16, 0.2, 0.28]),
    fogDomain: cinematicFogDomainPolicySchema.optional(),
    rain: z
      .object({
        enabled: z.boolean().default(false),
        layers: z
          .array(
            z.object({
              id: z.enum(['foreground', 'midground', 'background']),
              count: z.number().int().positive().max(5000),
              seed: z.number().int(),
              depthMinimumMeters: z.number().positive(),
              depthMaximumMeters: z.number().positive(),
              horizontalSpanMeters: z.number().positive(),
              verticalSpanMeters: z.number().positive(),
              streakLengthMeters: z.number().positive(),
              streakRadiusMeters: z.number().positive(),
              fallSpeedMetersPerSecond: z.number().positive(),
              lengthVariation: z.number().min(0).max(0.8).default(0.24),
              speedVariation: z.number().min(0).max(0.8).default(0.18),
              opacity: z.number().min(0).max(1),
              color: colorSchema,
            }),
          )
          .default([]),
        windMetersPerSecond: z.tuple([z.number(), z.number()]).default([0, 0]),
        surfaceFlux: surfaceFluxSchema.optional(),
        groundSplashes: z
          .object({
            enabled: z.boolean(),
            count: z.number().int().min(0).max(500),
            seed: z.number().int(),
            boundsMinimum: cinematicVec3Schema,
            boundsMaximum: cinematicVec3Schema,
            radiusMinimumMeters: z.number().positive(),
            radiusMaximumMeters: z.number().positive(),
            crownHeightMeters: z.number().positive(),
            lifetimeSeconds: z.number().positive(),
            opacity: z.number().min(0).max(1),
            color: colorSchema,
          })
          .optional(),
        count: z.number().int().min(0).max(5000).default(0),
        seed: z.number().int().default(1),
        boundsMinimum: cinematicVec3Schema.default([-5, 0, -5]),
        boundsMaximum: cinematicVec3Schema.default([5, 5, 5]),
        streakLengthMeters: z.number().positive().default(0.14),
        fallSpeedMetersPerSecond: z.number().positive().default(8),
      })
      .default({
        enabled: false,
        layers: [],
        windMetersPerSecond: [0, 0],
        count: 0,
        seed: 1,
        boundsMinimum: [-5, 0, -5],
        boundsMaximum: [5, 5, 5],
        streakLengthMeters: 0.14,
        fallSpeedMetersPerSecond: 8,
      }),
    aerosols: z
      .array(
        z.object({
          source: z.object({
            vfxAssetId: z.string().regex(/^vfx\.[a-z0-9-]+(?:\.[a-z0-9-]+)*$/),
            entityId: cinematicIdentifierSchema,
            geometryAssetId: cinematicIdentifierSchema,
            attachmentId: cinematicIdentifierSchema,
            resolvedAttachmentPosition: cinematicVec3Schema,
          }),
          origin: cinematicVec3Schema,
          layer: aerosolLayerSchema,
        }),
      )
      .max(8)
      .default([]),
  })
  .default({
    worldColor: [0.01, 0.015, 0.025],
    fogDensity: 0,
    fogColor: [0.16, 0.2, 0.28],
    rain: {
      enabled: false,
      layers: [],
      windMetersPerSecond: [0, 0],
      count: 0,
      seed: 1,
      boundsMinimum: [-5, 0, -5],
      boundsMaximum: [5, 5, 5],
      streakLengthMeters: 0.14,
      fallSpeedMetersPerSecond: 8,
    },
    aerosols: [],
  });

export const cinematicOverlaySchema = z.object({
  id: cinematicIdentifierSchema.optional(),
  imagePath: z.string().min(1),
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().positive(),
  opacity: z.number().min(0).max(1).default(1),
  fadeInSeconds: z.number().nonnegative().default(0),
  fadeOutSeconds: z.number().nonnegative().default(0),
});

export const cinematicRenderGateSchema = z.discriminatedUnion('type', [
  z.object({
    id: cinematicIdentifierSchema,
    type: z.literal('overlay-visibility'),
    overlayId: cinematicIdentifierSchema,
    landmarkIds: z.array(cinematicIdentifierSchema).min(1),
    minimumOpacity: z.number().min(0).max(1).default(0.8),
  }),
  z.object({
    id: cinematicIdentifierSchema,
    type: z.literal('frame-visibility'),
    maximumBlackPercentage: z.number().min(0).max(100),
    blackThreshold: z.number().int().min(0).max(255).default(32),
  }),
  z.object({
    id: cinematicIdentifierSchema,
    type: z.literal('frame-overexposure'),
    maximumWhitePercentage: z.number().min(0).max(100),
    whiteThreshold: z.number().int().min(0).max(255).default(245),
  }),
  z.object({
    id: cinematicIdentifierSchema,
    type: z.literal('region-exposure'),
    region: z.object({
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      width: z.number().positive().max(1),
      height: z.number().positive().max(1),
    }),
    maximumBlackPercentage: z.number().min(0).max(100),
    maximumWhitePercentage: z.number().min(0).max(100),
    minimumMidtonePercentage: z.number().min(0).max(100),
    blackThreshold: z.number().int().min(0).max(255).default(32),
    whiteThreshold: z.number().int().min(0).max(255).default(245),
  }),
  z.object({
    id: cinematicIdentifierSchema,
    type: z.literal('region-spatial-color-variation'),
    region: z.object({
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      width: z.number().positive().max(1),
      height: z.number().positive().max(1),
    }),
    minimumMeanNormalizedColorEntropy: z.number().min(0).max(1),
  }),
  z.object({
    id: cinematicIdentifierSchema,
    type: z.literal('subject-coverage'),
    entityId: cinematicIdentifierSchema,
    minimumVisibleAreaPercentage: z.number().min(0).max(100),
    minimumVisibleScreenHeightPercentage: z.number().min(0).max(100),
    maximumVisibleScreenHeightPercentage: z.number().positive().max(100).default(100),
  }),
  z.object({
    id: cinematicIdentifierSchema,
    type: z.literal('subject-framing'),
    entityId: cinematicIdentifierSchema,
    minimumScreenHeightPercentage: z.number().positive().max(100),
    maximumScreenHeightPercentage: z.number().positive().max(100),
    marginPercentage: z.number().min(0).max(49).default(2),
  }),
  z.object({
    id: cinematicIdentifierSchema,
    type: z.literal('entity-set-coverage'),
    entityIds: z.array(cinematicIdentifierSchema).min(1),
    minimumScreenHeightPercentage: z.number().positive().max(100),
    maximumScreenHeightPercentage: z.number().positive().max(100).default(100),
    minimumVisibleAreaPercentage: z.number().min(0).max(100).default(95),
    marginPercentage: z.number().min(0).max(49).default(1),
  }),
  z.object({
    id: cinematicIdentifierSchema,
    type: z.literal('entity-set-frame-presence'),
    entityIds: z.array(cinematicIdentifierSchema).min(1),
    minimumVisibleFrameAreaPercentage: z.number().positive().max(100),
    maximumVisibleFrameAreaPercentage: z.number().positive().max(100).default(100),
    marginPercentage: z.number().min(0).max(49).default(0),
  }),
  z.object({
    id: cinematicIdentifierSchema,
    type: z.literal('subject-overexposure'),
    entityId: cinematicIdentifierSchema,
    maximumWhitePercentage: z.number().min(0).max(100),
    whiteThreshold: z.number().int().min(0).max(255).default(245),
  }),
]);

export const cinematicLandmarkSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  progress: z.number().min(0).max(1),
  description: z.string().min(1),
});

export const cinematicSceneSchema = z
  .object({
    schemaVersion: z.union([z.literal(1), z.literal(2)]),
    id: cinematicIdentifierSchema,
    durationSeconds: z.number().positive(),
    fps: z.number().int().min(12).max(120).default(24),
    resolution: cinematicResolutionSchema,
    renderProfile: cinematicRenderProfileSchema.default({
      engine: 'cycles-cpu',
      samples: 128,
      seed: 1729,
      denoise: true,
      intent: 'deterministic-final',
    }),
    entities: z.array(cinematicSceneEntitySchema).min(1),
    camera: z.object({
      keyframes: z.array(cinematicCameraKeyframeSchema).min(1),
      intent: cinematicShotIntentSchema.optional(),
    }),
    lightingRigPath: z.string().min(1).optional(),
    lights: z.array(cinematicLightSchema).default([]),
    atmosphere: cinematicAtmosphereSchema,
    overlays: z.array(cinematicOverlaySchema).max(3).default([]),
    finishProfilePath: z.string().min(1).optional(),
    renderGates: z.array(cinematicRenderGateSchema).default([]),
    qualityGates: z.array(cinematicQualityGateSchema).default([]),
    landmarks: z.array(cinematicLandmarkSchema).min(2),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .superRefine((scene, ctx) => {
    if (scene.schemaVersion === 1 && scene.lightingRigPath)
      ctx.addIssue({
        code: 'custom',
        path: ['lightingRigPath'],
        message: 'legacy cinematic scene v1 cannot bind a reusable lighting rig; use v2',
      });
    if (scene.schemaVersion === 1 && scene.atmosphere.fogDomain)
      ctx.addIssue({
        code: 'custom',
        path: ['atmosphere', 'fogDomain'],
        message: 'legacy cinematic scene v1 cannot declare a finite fog domain; use v2',
      });
    if (scene.schemaVersion === 1 && !scene.lights.length)
      ctx.addIssue({
        code: 'custom',
        path: ['lights'],
        message: 'legacy cinematic scene v1 requires at least one inline light',
      });
    if (!scene.lights.length && !scene.lightingRigPath)
      ctx.addIssue({
        code: 'custom',
        path: ['lights'],
        message: 'cinematic scenes require inline lights or an exact lighting rig binding',
      });
    const lightIds = new Set<string>();
    for (const [index, light] of scene.lights.entries()) {
      if (lightIds.has(light.id))
        ctx.addIssue({
          code: 'custom',
          path: ['lights', index, 'id'],
          message: 'duplicate cinematic scene light id',
        });
      lightIds.add(light.id);
    }
    if (
      Math.abs(scene.durationSeconds * scene.fps - Math.round(scene.durationSeconds * scene.fps)) >
      1e-8
    )
      ctx.addIssue({
        code: 'custom',
        path: ['durationSeconds'],
        message: 'cinematic duration must resolve to a whole number of frames',
      });
    const entityIds = new Set<string>();
    for (const [index, entity] of scene.entities.entries()) {
      if (entityIds.has(entity.id))
        ctx.addIssue({
          code: 'custom',
          path: ['entities', index, 'id'],
          message: 'duplicate scene entity id',
        });
      entityIds.add(entity.id);
      if (entity.motion) {
        const end = entity.motion.endSeconds ?? scene.durationSeconds;
        if (entity.motion.startSeconds >= end || end > scene.durationSeconds)
          ctx.addIssue({
            code: 'custom',
            path: ['entities', index, 'motion'],
            message: 'motion binding must occupy a positive interval within the scene',
          });
        if (
          entity.motion.sourceEndSeconds !== undefined &&
          entity.motion.sourceStartSeconds >= entity.motion.sourceEndSeconds
        )
          ctx.addIssue({
            code: 'custom',
            path: ['entities', index, 'motion'],
            message: 'motion source interval must be positive',
          });
      }
    }
    for (const [index, aerosol] of scene.atmosphere.aerosols.entries())
      if (!entityIds.has(aerosol.source.entityId))
        ctx.addIssue({
          code: 'custom',
          path: ['atmosphere', 'aerosols', index, 'source', 'entityId'],
          message: `aerosol source references unknown entity '${aerosol.source.entityId}'`,
        });
    const qualityGateIds = new Set<string>();
    for (const [index, gate] of scene.qualityGates.entries()) {
      if (qualityGateIds.has(gate.id))
        ctx.addIssue({
          code: 'custom',
          path: ['qualityGates', index, 'id'],
          message: 'duplicate cinematic quality gate id',
        });
      qualityGateIds.add(gate.id);
      if (gate.type === 'camera-path-clearance') {
        for (const [obstacleIndex, entityId] of gate.obstacleEntityIds.entries())
          if (!entityIds.has(entityId))
            ctx.addIssue({
              code: 'custom',
              path: ['qualityGates', index, 'obstacleEntityIds', obstacleIndex],
              message: 'camera path clearance gate references an unknown obstacle entity',
            });
      } else if (gate.type === 'camera-shot-intent') {
        if (!scene.camera.intent || gate.intentId !== scene.camera.intent.id)
          ctx.addIssue({
            code: 'custom',
            path: ['qualityGates', index, 'intentId'],
            message: 'camera shot-intent gate must reference the scene camera intent',
          });
      } else if (gate.type === 'mutual-facing') {
        for (const field of ['firstEntityId', 'secondEntityId'] as const)
          if (!entityIds.has(gate[field]))
            ctx.addIssue({
              code: 'custom',
              path: ['qualityGates', index, field],
              message: 'cinematic mutual-facing gate references an unknown entity',
            });
      } else if (!entityIds.has(gate.entityId))
        ctx.addIssue({
          code: 'custom',
          path: ['qualityGates', index, 'entityId'],
          message: 'cinematic quality gate references an unknown entity',
        });
    }
    for (const [index, gate] of scene.renderGates.entries()) {
      if (
        (gate.type === 'region-exposure' || gate.type === 'region-spatial-color-variation') &&
        (gate.region.x + gate.region.width > 1 || gate.region.y + gate.region.height > 1)
      )
        ctx.addIssue({
          code: 'custom',
          path: ['renderGates', index, 'region'],
          message: 'region render gate must remain within normalized frame bounds',
        });
      if (gate.type === 'overlay-visibility') {
        if (!scene.overlays.some((overlay) => overlay.id === gate.overlayId))
          ctx.addIssue({
            code: 'custom',
            path: ['renderGates', index, 'overlayId'],
            message: 'overlay visibility gate references an unknown overlay',
          });
        for (const [landmarkIndex, landmarkId] of gate.landmarkIds.entries())
          if (!scene.landmarks.some((landmark) => landmark.id === landmarkId))
            ctx.addIssue({
              code: 'custom',
              path: ['renderGates', index, 'landmarkIds', landmarkIndex],
              message: 'overlay visibility gate references an unknown landmark',
            });
        continue;
      }
      if (gate.type === 'entity-set-coverage' || gate.type === 'entity-set-frame-presence') {
        for (const [entityIndex, entityId] of gate.entityIds.entries())
          if (!entityIds.has(entityId))
            ctx.addIssue({
              code: 'custom',
              path: ['renderGates', index, 'entityIds', entityIndex],
              message: 'entity-set coverage gate references an unknown entity',
            });
        if (
          gate.type === 'entity-set-coverage' &&
          gate.minimumScreenHeightPercentage > gate.maximumScreenHeightPercentage
        )
          ctx.addIssue({
            code: 'custom',
            path: ['renderGates', index],
            message: 'entity-set coverage minimum height exceeds maximum height',
          });
        if (
          gate.type === 'entity-set-frame-presence' &&
          gate.minimumVisibleFrameAreaPercentage > gate.maximumVisibleFrameAreaPercentage
        )
          ctx.addIssue({
            code: 'custom',
            path: ['renderGates', index],
            message: 'entity-set frame-presence minimum area exceeds maximum area',
          });
        continue;
      }
      if (
        gate.type !== 'subject-framing' &&
        gate.type !== 'subject-overexposure' &&
        gate.type !== 'subject-coverage'
      )
        continue;
      if (!entityIds.has(gate.entityId))
        ctx.addIssue({
          code: 'custom',
          path: ['renderGates', index, 'entityId'],
          message: 'subject framing gate references an unknown entity',
        });
      if (
        gate.type === 'subject-framing' &&
        gate.minimumScreenHeightPercentage > gate.maximumScreenHeightPercentage
      )
        ctx.addIssue({
          code: 'custom',
          path: ['renderGates', index],
          message: 'subject framing minimum height exceeds maximum height',
        });
    }
    if (scene.camera.intent) {
      for (const [intentGateIndex, gateId] of scene.camera.intent.framingGateIds.entries()) {
        const gate = scene.renderGates.find((candidate) => candidate.id === gateId);
        if (
          !gate ||
          ![
            'subject-framing',
            'subject-coverage',
            'entity-set-coverage',
            'entity-set-frame-presence',
          ].includes(gate.type)
        )
          ctx.addIssue({
            code: 'custom',
            path: ['camera', 'intent', 'framingGateIds', intentGateIndex],
            message:
              'shot intent framing gates must reference a subject or entity-set framing render gate',
          });
      }
    }
    for (const [index, overlay] of scene.overlays.entries()) {
      if (overlay.startSeconds >= overlay.endSeconds || overlay.endSeconds > scene.durationSeconds)
        ctx.addIssue({
          code: 'custom',
          path: ['overlays', index],
          message: 'overlay must occupy a positive interval within the scene',
        });
      if (
        overlay.fadeInSeconds + overlay.fadeOutSeconds >
        overlay.endSeconds - overlay.startSeconds
      )
        ctx.addIssue({
          code: 'custom',
          path: ['overlays', index],
          message: 'overlay fades exceed its visible interval',
        });
    }
    for (const [index, keyframe] of scene.camera.keyframes.entries()) {
      if (keyframe.time > scene.durationSeconds)
        ctx.addIssue({
          code: 'custom',
          path: ['camera', 'keyframes', index, 'time'],
          message: 'camera keyframe exceeds scene duration',
        });
      if (index > 0 && keyframe.time <= scene.camera.keyframes[index - 1]!.time)
        ctx.addIssue({
          code: 'custom',
          path: ['camera', 'keyframes', index, 'time'],
          message: 'camera keyframes must be strictly increasing',
        });
    }
    if (scene.camera.keyframes[0]?.time !== 0)
      ctx.addIssue({
        code: 'custom',
        path: ['camera', 'keyframes', 0, 'time'],
        message: 'camera must begin at zero',
      });
    if (scene.camera.keyframes.at(-1)?.time !== scene.durationSeconds)
      ctx.addIssue({
        code: 'custom',
        path: ['camera', 'keyframes'],
        message: 'camera must end at scene duration',
      });
    for (let index = 1; index < scene.landmarks.length; index++)
      if (scene.landmarks[index]!.progress <= scene.landmarks[index - 1]!.progress)
        ctx.addIssue({
          code: 'custom',
          path: ['landmarks', index, 'progress'],
          message: 'landmarks must be strictly ordered',
        });
  });

export type CinematicScene = z.infer<typeof cinematicSceneSchema>;

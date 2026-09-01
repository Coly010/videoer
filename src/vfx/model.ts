import { z } from 'zod';

const colorSchema = z.tuple([
  z.number().min(0).max(1),
  z.number().min(0).max(1),
  z.number().min(0).max(1),
]);
const vec3Schema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);

export const surfaceFluxSchema = z.object({
  intensityMillimetersPerHour: z.number().nonnegative().max(500),
  durationSeconds: z.number().nonnegative().max(86_400),
  dropDiameterMillimeters: z.number().positive().max(20),
  impactSpeedMetersPerSecond: z.number().nonnegative().max(100),
});

export const rainLayerSchema = z.object({
  id: z.enum(['foreground', 'midground', 'background']),
  count: z.number().int().positive(),
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
});

export const atmosphericVfxSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(/^vfx\.[a-z0-9-]+(?:\.[a-z0-9-]+)*$/),
    placement: z.literal('camera-relative'),
    worldColor: colorSchema,
    fog: z.object({ density: z.number().min(0).max(0.2), color: colorSchema }),
    rain: z.object({
      enabled: z.boolean(),
      windMetersPerSecond: z.tuple([z.number(), z.number()]).default([0, 0]),
      surfaceFlux: surfaceFluxSchema.optional(),
      layers: z.array(rainLayerSchema).length(3),
      groundSplashes: z
        .object({
          enabled: z.boolean(),
          count: z.number().int().min(0).max(500),
          seed: z.number().int(),
          boundsMinimum: z.tuple([z.number(), z.number(), z.number()]),
          boundsMaximum: z.tuple([z.number(), z.number(), z.number()]),
          radiusMinimumMeters: z.number().positive(),
          radiusMaximumMeters: z.number().positive(),
          crownHeightMeters: z.number().positive(),
          lifetimeSeconds: z.number().positive(),
          opacity: z.number().min(0).max(1),
          color: colorSchema,
        })
        .optional(),
    }),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .superRefine((vfx, ctx) => {
    const ids = new Set<string>();
    const seeds = new Set<number>();
    for (const [index, layer] of vfx.rain.layers.entries()) {
      if (layer.depthMinimumMeters >= layer.depthMaximumMeters)
        ctx.addIssue({
          code: 'custom',
          path: ['rain', 'layers', index],
          message: 'rain depth interval must be positive',
        });
      if (ids.has(layer.id) || seeds.has(layer.seed))
        ctx.addIssue({
          code: 'custom',
          path: ['rain', 'layers', index],
          message: 'rain layer ids and seeds must be unique',
        });
      ids.add(layer.id);
      seeds.add(layer.seed);
      const previous = vfx.rain.layers[index - 1];
      if (previous && previous.depthMaximumMeters > layer.depthMinimumMeters)
        ctx.addIssue({
          code: 'custom',
          path: ['rain', 'layers', index],
          message: 'rain depth layers must be ordered and non-overlapping',
        });
    }
    const splashes = vfx.rain.groundSplashes;
    if (splashes) {
      if (splashes.radiusMinimumMeters > splashes.radiusMaximumMeters)
        ctx.addIssue({
          code: 'custom',
          path: ['rain', 'groundSplashes'],
          message: 'splash radius range is inverted',
        });
      if (splashes.boundsMinimum.some((value, index) => value >= splashes.boundsMaximum[index]!))
        ctx.addIssue({
          code: 'custom',
          path: ['rain', 'groundSplashes', 'boundsMinimum'],
          message: 'splash bounds must have positive extent',
        });
    }
  });

export type AtmosphericVfx = z.infer<typeof atmosphericVfxSchema>;

const aerosolLayerBaseSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  seed: z.number().int(),
  count: z.number().int().positive().max(500),
  originOffset: vec3Schema,
  sourceRadiusMeters: z.number().positive(),
  verticalSpanMeters: z.number().positive(),
  lifetimeSeconds: z.number().positive(),
  riseSpeedMetersPerSecond: z.object({
    minimum: z.number().finite(),
    maximum: z.number().finite(),
  }),
  windMetersPerSecond: vec3Schema,
  turbulenceMeters: z.number().nonnegative(),
  color: colorSchema,
  opacity: z.number().min(0).max(1),
});

export const aerosolLayerSchema = z.discriminatedUnion('kind', [
  aerosolLayerBaseSchema.extend({
    kind: z.literal('smoke-volume'),
    particleRadiusMeters: z.object({
      minimum: z.number().positive(),
      maximum: z.number().positive(),
    }),
    density: z.number().positive().max(20),
    anisotropy: z.number().min(-1).max(1).default(0.1),
    noiseScaleMeters: z.number().positive(),
    noiseDetail: z.number().min(0).max(15).default(4),
  }),
  aerosolLayerBaseSchema.extend({
    kind: z.literal('ember-particles'),
    particleRadiusMeters: z.object({
      minimum: z.number().positive(),
      maximum: z.number().positive(),
    }),
    trailLengthMeters: z.number().nonnegative(),
    emissionStrength: z.number().positive().max(100),
  }),
  aerosolLayerBaseSchema.extend({
    kind: z.literal('dust-motes'),
    particleRadiusMeters: z.object({
      minimum: z.number().positive(),
      maximum: z.number().positive(),
    }),
    roughness: z.number().min(0).max(1),
  }),
]);

export const aerosolVfxSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(/^vfx\.[a-z0-9-]+(?:\.[a-z0-9-]+)*$/),
    placement: z.literal('source-relative'),
    layers: z.array(aerosolLayerSchema).min(1).max(8),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .superRefine((vfx, context) => {
    const ids = new Set<string>();
    const seeds = new Set<number>();
    for (const [index, layer] of vfx.layers.entries()) {
      if (ids.has(layer.id))
        context.addIssue({
          code: 'custom',
          path: ['layers', index, 'id'],
          message: 'aerosol layer ids must be unique',
        });
      if (seeds.has(layer.seed))
        context.addIssue({
          code: 'custom',
          path: ['layers', index, 'seed'],
          message: 'aerosol layer seeds must be unique',
        });
      ids.add(layer.id);
      seeds.add(layer.seed);
      if (layer.riseSpeedMetersPerSecond.minimum > layer.riseSpeedMetersPerSecond.maximum)
        context.addIssue({
          code: 'custom',
          path: ['layers', index, 'riseSpeedMetersPerSecond'],
          message: 'aerosol rise-speed range is inverted',
        });
      if (layer.particleRadiusMeters.minimum > layer.particleRadiusMeters.maximum)
        context.addIssue({
          code: 'custom',
          path: ['layers', index, 'particleRadiusMeters'],
          message: 'aerosol particle-radius range is inverted',
        });
    }
  });

export type AerosolLayer = z.infer<typeof aerosolLayerSchema>;
export type AerosolVfx = z.infer<typeof aerosolVfxSchema>;

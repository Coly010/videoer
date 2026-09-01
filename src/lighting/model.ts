import { z } from 'zod';
import { relativeArtifactPathSchema } from '../assets/sources/model.js';
import { temporalLightModulationSchema } from './temporal.js';

const vec3Schema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const colorSchema = z.tuple([
  z.number().min(0).max(1),
  z.number().min(0).max(1),
  z.number().min(0).max(1),
]);

const sourcePackageBindingSchema = z.object({
  manifest: z.object({
    path: relativeArtifactPathSchema,
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    sizeBytes: z.number().int().positive(),
    mediaType: z.literal('application/vnd.videoer.environment-radiance-source+json'),
  }),
});

const environmentIlluminationSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('hash-bound-equirectangular-radiance'),
      source: z.object({
        path: relativeArtifactPathSchema,
        sha256: z.string().regex(/^[a-f0-9]{64}$/u),
        sizeBytes: z.number().int().positive(),
        mediaType: z.enum(['image/vnd.radiance', 'image/x-exr']),
      }),
      sourcePackage: sourcePackageBindingSchema,
      colorSpace: z.literal('scene-linear-rec709'),
      projection: z.literal('equirectangular'),
      dimensions: z.object({
        widthPixels: z.number().int().positive().max(65_536),
        heightPixels: z.number().int().positive().max(32_768),
      }),
      yawDegrees: z.number().finite().min(-180).max(180).default(0),
      exposureStops: z.number().finite().min(-6).max(6).default(0),
    })
    .superRefine((environment, context) => {
      if (environment.dimensions.widthPixels !== environment.dimensions.heightPixels * 2)
        context.addIssue({
          code: 'custom',
          path: ['dimensions'],
          message: 'equirectangular radiance dimensions must have an exact 2:1 aspect ratio',
        });
    }),
  z.object({
    kind: z.literal('physical-sky'),
    model: z.literal('nishita'),
    sun: z.object({
      azimuthDegrees: z.number().finite().min(-180).max(180),
      elevationDegrees: z.number().finite().min(-12).max(90),
      angularDiameterDegrees: z.number().finite().min(0.1).max(2),
      intensity: z.number().finite().positive().max(100),
    }),
    atmosphere: z.object({
      altitudeMeters: z.number().finite().min(-500).max(10_000),
      airDensity: z.number().finite().min(0).max(10),
      dustDensity: z.number().finite().min(0).max(10),
      ozoneDensity: z.number().finite().min(0).max(10),
      groundAlbedo: colorSchema,
    }),
    exposureStops: z.number().finite().min(-6).max(6).default(0),
  }),
]);

const exposureSchema = z.object({
  viewTransform: z.literal('AgX').default('AgX'),
  look: z.literal('AgX - Medium High Contrast'),
  exposureStops: z.number().finite().min(-4).max(4).default(0),
  coherentAcrossShots: z.boolean(),
});

const lightSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  type: z.enum(['area', 'point', 'spot', 'sun']),
  position: vec3Schema,
  target: vec3Schema.optional(),
  color: colorSchema,
  energy: z.number().positive(),
  sizeMeters: z.number().positive().default(1),
  angleDegrees: z.number().min(1).max(179).default(45),
  purpose: z.enum(['key', 'fill', 'rim', 'practical', 'environment']),
  temporalModulation: temporalLightModulationSchema.optional(),
  temporalSignalId: z
    .string()
    .regex(/^[a-z][a-z0-9-]*$/)
    .optional(),
  visibleSourceRole: z
    .string()
    .regex(/^[a-z][a-z0-9-]*$/)
    .optional(),
});

const commonShape = {
  id: z.string().regex(/^(?:environment|lighting)\.[a-z0-9-]+(?:\.[a-z0-9-]+)*$/),
  exposure: exposureSchema,
  worldColor: colorSchema,
  metadata: z.record(z.string(), z.unknown()).default({}),
};

function validateLights(rig: { lights: z.infer<typeof lightSchema>[] }, context: z.RefinementCtx) {
  const ids = new Set<string>();
  const signals = new Map<string, string>();
  for (const [index, light] of rig.lights.entries()) {
    if (ids.has(light.id))
      context.addIssue({
        code: 'custom',
        path: ['lights', index, 'id'],
        message: 'duplicate lighting-rig light id',
      });
    ids.add(light.id);
    if ((light.temporalSignalId || light.visibleSourceRole) && !light.temporalModulation)
      context.addIssue({
        code: 'custom',
        path: ['lights', index, 'temporalModulation'],
        message: 'temporal signal/source semantics require temporal modulation',
      });
    if (light.temporalModulation && !light.temporalSignalId)
      context.addIssue({
        code: 'custom',
        path: ['lights', index, 'temporalSignalId'],
        message: 'modulated rig lights require a stable temporal signal id',
      });
    if (light.temporalSignalId && light.temporalModulation) {
      const signature = JSON.stringify(light.temporalModulation);
      const existing = signals.get(light.temporalSignalId);
      if (existing !== undefined && existing !== signature)
        context.addIssue({
          code: 'custom',
          path: ['lights', index, 'temporalSignalId'],
          message: 'lights sharing a temporal signal must declare identical modulation',
        });
      signals.set(light.temporalSignalId, signature);
    }
  }
}

const legacyLightingRigSchema = z
  .object({
    schemaVersion: z.literal(1),
    ...commonShape,
    environmentIllumination: z.never().optional(),
    lights: z.array(lightSchema).min(1),
  })
  .superRefine(validateLights);

const environmentLightingRigSchema = z
  .object({
    schemaVersion: z.literal(2),
    ...commonShape,
    environmentIllumination: environmentIlluminationSchema.optional(),
    lights: z.array(lightSchema).default([]),
  })
  .superRefine((rig, context) => {
    if (!rig.lights.length && !rig.environmentIllumination)
      context.addIssue({
        code: 'custom',
        path: ['lights'],
        message: 'lighting rigs require at least one emitter or environment illumination',
      });
    validateLights(rig, context);
  });

export const lightingRigSchema = z.union([legacyLightingRigSchema, environmentLightingRigSchema]);

export type LightingRig = z.infer<typeof lightingRigSchema>;
export type LightingRigInput = z.input<typeof lightingRigSchema>;

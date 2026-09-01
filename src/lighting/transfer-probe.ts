import { z } from 'zod';
import { lightingRigAdaptationSchema } from './adaptation.js';
import { cinematicRenderProfileSchema } from '../cinematic/model.js';

const vec3Schema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const cameraSchema = z.object({
  position: vec3Schema,
  target: vec3Schema,
  lensMillimeters: z.number().min(12).max(300),
});

export const lightingTransferProbeSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^lighting-probe\.[a-z0-9-]+(?:\.[a-z0-9-]+)*$/),
  sourceRigPath: z.string().min(1),
  environmentGeometryPath: z.string().min(1),
  visibleSourceBindings: z
    .record(
      z.string().regex(/^[a-z][a-z0-9-]*$/),
      z.object({
        entityId: z.string().regex(/^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)*$/),
        materialId: z.string().regex(/^[a-z][a-z0-9-]*$/),
      }),
    )
    .default({}),
  adaptation: lightingRigAdaptationSchema,
  witnessTransform: z.object({
    position: vec3Schema,
    rotation: vec3Schema.default([0, 0, 0]),
    scale: vec3Schema.default([1, 1, 1]),
  }),
  camera: z.object({ start: cameraSchema, end: cameraSchema }),
  resolution: z.object({
    width: z.number().int().min(240).max(1920),
    height: z.number().int().min(240).max(1920),
    percentage: z.literal(100).default(100),
  }),
  renderProfile: cinematicRenderProfileSchema.optional(),
  fogDensity: z.number().min(0).max(0.2).default(0.002),
  minimumSpatialColorVariationEntropy: z.number().min(0).max(1).optional(),
  exposureRegion: z
    .object({
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      width: z.number().positive().max(1),
      height: z.number().positive().max(1),
      maximumBlackPercentage: z.number().min(0).max(100),
      maximumWhitePercentage: z.number().min(0).max(100),
      minimumMidtonePercentage: z.number().min(0).max(100),
    })
    .refine((region) => region.x + region.width <= 1 && region.y + region.height <= 1, {
      message: 'transfer-probe exposure region must remain inside the frame',
    }),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type LightingTransferProbe = z.infer<typeof lightingTransferProbeSchema>;

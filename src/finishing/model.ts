import { z } from 'zod';

export const cinematicFinishProfileSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^vfx\.[a-z0-9-]+(?:\.[a-z0-9-]+)*$/),
  tonal: z.object({
    contrast: z.number().min(0.75).max(1.35).default(1),
    saturation: z.number().min(0.5).max(1.5).default(1),
    brightness: z.number().min(-0.15).max(0.15).default(0),
    gamma: z.number().min(0.75).max(1.35).default(1),
    temperature: z.number().min(-0.2).max(0.2).default(0),
    tint: z.number().min(-0.15).max(0.15).default(0),
    preserveLightness: z.boolean().default(true),
  }),
  bloom: z.object({
    enabled: z.boolean().default(true),
    threshold: z.number().min(0.55).max(0.95).default(0.78),
    radiusPixels: z.number().min(1).max(32).default(8),
    intensity: z.number().min(0).max(0.35).default(0.1),
  }),
  vignette: z.object({
    enabled: z.boolean().default(true),
    angleRadians: z.number().min(0.01).max(0.9).default(0.32),
  }),
  grain: z.object({
    enabled: z.boolean().default(true),
    strength: z.number().int().min(0).max(12).default(3),
    seed: z.number().int().min(0).max(2_147_483_647),
    temporal: z.boolean().default(true),
  }),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type CinematicFinishProfile = z.infer<typeof cinematicFinishProfileSchema>;

export function createSoftAtmosphericFinishProfile(): CinematicFinishProfile {
  return cinematicFinishProfileSchema.parse({
    schemaVersion: 1,
    id: 'vfx.soft-atmospheric-finish',
    tonal: {
      contrast: 1.04,
      saturation: 0.97,
      brightness: 0,
      gamma: 1,
      temperature: 0.01,
      tint: 0,
      preserveLightness: true,
    },
    bloom: { enabled: true, threshold: 0.8, radiusPixels: 7.5, intensity: 0.055 },
    vignette: { enabled: true, angleRadians: 0.06 },
    grain: { enabled: true, strength: 2, seed: 53_921, temporal: true },
    metadata: {
      generator: 'videoer.cinematic-finish.v1',
      intendedUse: 'restrained-short-form-cinematic-finishing',
      colorPipeline: 'post-AgX-display-referred',
    },
  });
}

import { z } from 'zod';

export const seededFlickerSchema = z
  .object({
    kind: z.literal('seeded-flicker'),
    seed: z.number().int(),
    frequencyHz: z.number().positive().max(30),
    intensityMinimumMultiplier: z.number().positive().max(2),
    intensityMaximumMultiplier: z.number().positive().max(2),
    colorTemperatureMinimumKelvin: z.number().min(1000).max(12_000),
    colorTemperatureMaximumKelvin: z.number().min(1000).max(12_000),
    interpolation: z.literal('smooth').default('smooth'),
  })
  .superRefine((modulation, context) => {
    if (modulation.intensityMinimumMultiplier >= modulation.intensityMaximumMultiplier)
      context.addIssue({
        code: 'custom',
        path: ['intensityMinimumMultiplier'],
        message: 'flicker intensity range must have positive extent',
      });
    if (modulation.colorTemperatureMinimumKelvin >= modulation.colorTemperatureMaximumKelvin)
      context.addIssue({
        code: 'custom',
        path: ['colorTemperatureMinimumKelvin'],
        message: 'flicker colour-temperature range must have positive extent',
      });
  });

export const seededElectricalInstabilitySchema = z
  .object({
    kind: z.literal('seeded-electrical-instability'),
    seed: z.number().int(),
    frequencyHz: z.number().positive().max(30),
    intensityMinimumMultiplier: z.number().positive().max(2),
    intensityMaximumMultiplier: z.number().positive().max(2),
    dropoutProbability: z.number().min(0).max(0.5),
    interpolation: z.literal('smooth').default('smooth'),
  })
  .superRefine((modulation, context) => {
    if (modulation.intensityMinimumMultiplier >= modulation.intensityMaximumMultiplier)
      context.addIssue({
        code: 'custom',
        path: ['intensityMinimumMultiplier'],
        message: 'electrical-instability intensity range must have positive extent',
      });
  });

export const temporalLightModulationSchema = z.discriminatedUnion('kind', [
  seededFlickerSchema,
  seededElectricalInstabilitySchema,
]);

export type TemporalLightModulation = z.infer<typeof temporalLightModulationSchema>;

import { z } from 'zod';
import { temporalLightModulationSchema } from './temporal.js';

const vec3Schema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const colorSchema = z.tuple([
  z.number().min(0).max(1),
  z.number().min(0).max(1),
  z.number().min(0).max(1),
]);

export const lightingRigSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(/^(?:environment|lighting)\.[a-z0-9-]+(?:\.[a-z0-9-]+)*$/),
    exposure: z.object({
      look: z.literal('AgX - Medium High Contrast'),
      coherentAcrossShots: z.boolean(),
    }),
    worldColor: colorSchema,
    lights: z
      .array(
        z.object({
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
        }),
      )
      .min(1),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .superRefine((rig, context) => {
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
  });

export type LightingRig = z.infer<typeof lightingRigSchema>;

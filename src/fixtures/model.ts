import { z } from 'zod';
import { temporalLightModulationSchema } from '../lighting/temporal.js';

const vec3Schema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const colorSchema = z.tuple([
  z.number().min(0).max(1),
  z.number().min(0).max(1),
  z.number().min(0).max(1),
]);

export const practicalFixtureSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(/^fixture\.[a-z0-9-]+(?:\.[a-z0-9-]+)*$/),
    geometryAssetId: z.string().regex(/^prop\.[a-z0-9-]+(?:\.[a-z0-9-]+)*$/),
    mountAttachmentId: z.string().regex(/^[a-z][a-z0-9-]*$/),
    emitters: z
      .array(
        z.object({
          id: z.string().regex(/^[a-z][a-z0-9-]*$/),
          type: z.enum(['point', 'spot', 'area']),
          position: vec3Schema,
          target: vec3Schema.optional(),
          color: colorSchema,
          powerWatts: z.number().positive().max(10_000),
          sizeMeters: z.number().positive().max(10).default(0.08),
          angleDegrees: z.number().min(1).max(179).default(45),
          falloff: z.literal('inverse-square').default('inverse-square'),
          purpose: z.literal('practical').default('practical'),
          visibleSourceMaterialId: z
            .string()
            .regex(/^[a-z][a-z0-9-]*$/)
            .optional(),
          temporalModulation: temporalLightModulationSchema.optional(),
        }),
      )
      .min(1),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .superRefine((fixture, context) => {
    const emitters = new Set<string>();
    for (const [index, emitter] of fixture.emitters.entries()) {
      if (emitters.has(emitter.id))
        context.addIssue({
          code: 'custom',
          path: ['emitters', index, 'id'],
          message: 'duplicate fixture emitter id',
        });
      emitters.add(emitter.id);
      if ((emitter.type === 'spot' || emitter.type === 'area') && !emitter.target)
        context.addIssue({
          code: 'custom',
          path: ['emitters', index, 'target'],
          message: `${emitter.type} fixture emitters require a local target`,
        });
    }
  });

export type PracticalFixture = z.infer<typeof practicalFixtureSchema>;

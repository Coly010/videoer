import { z } from 'zod';

export const editPlanSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(/^edit\.[a-z0-9-]+(?:\.[a-z0-9-]+)*$/),
    fps: z.number().int().positive(),
    resolution: z.object({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    }),
    clips: z
      .array(
        z.object({
          id: z.string().regex(/^[a-z][a-z0-9-]*$/),
          path: z.string().min(1),
          frames: z.number().int().positive(),
          transition: z.literal('cut').default('cut'),
        }),
      )
      .min(1),
    audioPath: z.string().min(1),
    delivery: z.object({
      codec: z.literal('h264'),
      pixelFormat: z.literal('yuv420p'),
      fastStart: z.boolean(),
    }),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .superRefine((plan, ctx) => {
    const ids = new Set<string>();
    for (const [index, clip] of plan.clips.entries()) {
      if (ids.has(clip.id))
        ctx.addIssue({
          code: 'custom',
          path: ['clips', index, 'id'],
          message: 'edit clip ids must be unique',
        });
      ids.add(clip.id);
    }
  });

export type EditPlan = z.infer<typeof editPlanSchema>;

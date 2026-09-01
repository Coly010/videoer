import { z } from 'zod';

const cueSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  kind: z.enum(['noise-bed', 'tone-bed', 'foley-noise', 'tonal-accent', 'speech', 'audio-source']),
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().positive(),
  gain: z.number().min(0).max(1),
  seed: z.number().int().optional(),
  frequencyHz: z.number().positive().optional(),
  text: z.string().min(1).optional(),
  voice: z.string().min(1).optional(),
  rate: z.number().int().min(80).max(450).optional(),
  pitch: z.number().int().min(0).max(99).optional(),
  source: z
    .string()
    .regex(/^[a-z][a-z0-9-]*$/)
    .optional(),
  purpose: z.string().min(1),
});

export const soundtrackPlanSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(/^audio\.[a-z0-9-]+(?:\.[a-z0-9-]+)*$/),
    durationSeconds: z.number().positive(),
    sampleRate: z.literal(48000),
    channels: z.literal(2),
    cues: z.array(cueSchema).min(1),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .superRefine((plan, ctx) => {
    for (const [index, cue] of plan.cues.entries()) {
      if (cue.startSeconds >= cue.endSeconds || cue.endSeconds > plan.durationSeconds)
        ctx.addIssue({
          code: 'custom',
          path: ['cues', index],
          message: 'audio cue must occupy a positive interval inside the master',
        });
      if (cue.kind.includes('noise') && cue.seed === undefined)
        ctx.addIssue({
          code: 'custom',
          path: ['cues', index, 'seed'],
          message: 'procedural noise cues require deterministic seeds',
        });
      if ((cue.kind === 'tone-bed' || cue.kind === 'tonal-accent') && !cue.frequencyHz)
        ctx.addIssue({
          code: 'custom',
          path: ['cues', index, 'frequencyHz'],
          message: 'tonal cues require a frequency',
        });
      if (cue.kind === 'speech') {
        for (const field of ['text', 'voice', 'rate', 'pitch'] as const)
          if (cue[field] === undefined)
            ctx.addIssue({
              code: 'custom',
              path: ['cues', index, field],
              message: `speech cues require ${field}`,
            });
      }
      if (cue.kind === 'audio-source' && !cue.source)
        ctx.addIssue({
          code: 'custom',
          path: ['cues', index, 'source'],
          message: 'audio-source cues require a source identifier',
        });
    }
  });

export type SoundtrackPlan = z.infer<typeof soundtrackPlanSchema>;

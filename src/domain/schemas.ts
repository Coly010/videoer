import { z } from 'zod';
import { motionPresets } from './motion.js';

const outputSchema = z
  .object({
    width: z.number().int().positive().default(1080),
    height: z.number().int().positive().default(1920),
    fps: z.number().int().positive().default(60),
    format: z.literal('mp4').default('mp4'),
  })
  .default({ width: 1080, height: 1920, fps: 60, format: 'mp4' });
export const campaignSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(1),
  type: z.enum(['book', 'product', 'project']),
  style: z.enum(['cinematic-fantasy', 'saas-promo']),
  durationSeconds: z.number().positive().max(120),
  targetAudience: z.string().min(1),
  description: z.string().min(1),
  tone: z.array(z.string()).min(1),
  cta: z.string().min(1),
  output: outputSchema,
  assets: z.record(z.string(), z.string()).default({}),
  brand: z
    .object({
      name: z.string(),
      colors: z.array(z.string()).default([]),
      logo: z.string().optional(),
    })
    .optional(),
  providers: z
    .object({
      image: z.string().optional(),
      video: z.string().optional(),
      voice: z.string().optional(),
      music: z.string().optional(),
    })
    .default({}),
});

const sourceSchema = z
  .object({
    kind: z.enum(['supplied', 'generated']),
    path: z.string().optional(),
    prompt: z.string().optional(),
    cacheKey: z.string().optional(),
  })
  .refine((v) => v.path || v.prompt, { message: 'source requires path or prompt' });
const baseShot = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  startSeconds: z.number().nonnegative(),
  durationSeconds: z.number().positive(),
  text: z.string().optional(),
  caption: z.string().optional(),
  voiceover: z.string().optional(),
  motion: z.enum(motionPresets).default('static'),
  transition: z.enum(['cut', 'crossfade', 'swipe']).default('cut'),
  sources: z.array(sourceSchema).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
  generation: z
    .object({
      revision: z.number().int().nonnegative().default(0),
      stale: z.boolean().default(false),
    })
    .default({ revision: 0, stale: false }),
});
const shotSchema = z.discriminatedUnion('type', [
  baseShot.extend({ type: z.literal('kinetic-text') }),
  baseShot.extend({ type: z.literal('image-motion') }),
  baseShot.extend({ type: z.literal('screenshot') }),
  baseShot.extend({ type: z.literal('slideshow') }),
  baseShot.extend({ type: z.literal('cover-reveal') }),
  baseShot.extend({ type: z.literal('cta') }),
]);
export const storyboardSchema = z
  .object({
    schemaVersion: z.literal(1),
    campaignId: z.string(),
    title: z.string(),
    durationSeconds: z.number().positive(),
    style: z.enum(['cinematic-fantasy', 'saas-promo']),
    shots: z.array(shotSchema).min(1),
  })
  .superRefine((v, ctx) => {
    const ids = new Set<string>();
    for (const [i, s] of v.shots.entries()) {
      if (ids.has(s.id))
        ctx.addIssue({
          code: 'custom',
          path: ['shots', i, 'id'],
          message: `duplicate shot id: ${s.id}`,
        });
      ids.add(s.id);
      if (s.startSeconds + s.durationSeconds > v.durationSeconds + 0.001)
        ctx.addIssue({
          code: 'custom',
          path: ['shots', i],
          message: 'shot extends beyond storyboard duration',
        });
    }
  });
export type Campaign = z.infer<typeof campaignSchema>;
export type Storyboard = z.infer<typeof storyboardSchema>;
export type Shot = Storyboard['shots'][number];

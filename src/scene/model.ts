import { z } from 'zod';

export const sceneDepths = ['background', 'midground', 'foreground', 'screen'] as const;
export const sceneDepthSchema = z.union([z.number().finite(), z.enum(sceneDepths)]);
export type SceneDepth = z.infer<typeof sceneDepthSchema>;

export const blendModes = ['normal', 'multiply', 'screen', 'overlay', 'add', 'soft-light'] as const;
export const blendModeSchema = z.enum(blendModes);
export type BlendMode = z.infer<typeof blendModeSchema>;

export const sceneCameraPresets = [
  'push-in',
  'slow-push-in',
  'pull-out',
  'pan',
  'track-left',
  'track-right',
  'pan-up',
  'pan-down',
  'drift',
  'shake',
  'handheld',
  'punch',
  'scale-pop',
  'slide-in',
  'static',
] as const;

const timingSchema = z.object({
  start: z.number().nonnegative().default(0),
  end: z.number().positive().optional(),
});

export const transformSchema = z
  .object({
    x: z.number().default(0),
    y: z.number().default(0),
    scale: z.number().positive().default(1),
    rotation: z.number().default(0),
  })
  .default({ x: 0, y: 0, scale: 1, rotation: 0 });

export const motionDefinitionSchema = z.object({
  preset: z.enum(sceneCameraPresets),
  intensity: z.number().nonnegative().max(3).default(1),
  easing: z.enum(['linear', 'ease-in', 'ease-out', 'ease-in-out']).default('ease-in-out'),
});

export const maskSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('rectangle'),
    x: z.number(),
    y: z.number(),
    width: z.number().positive(),
    height: z.number().positive(),
    feather: z.number().nonnegative().default(0),
  }),
  z.object({
    type: z.literal('circle'),
    x: z.number(),
    y: z.number(),
    radius: z.number().positive(),
    feather: z.number().nonnegative().default(0),
  }),
  z.object({
    type: z.literal('asset'),
    asset: z.string().min(1),
    invert: z.boolean().default(false),
  }),
]);

export const filterSchema = z.object({
  type: z.enum(['blur', 'brightness', 'contrast', 'saturate', 'hue-rotate', 'glow']),
  value: z.number().finite(),
});

const baseLayerShape = {
  id: z.string().regex(/^[a-z0-9-]+$/),
  depth: sceneDepthSchema.default('midground'),
  zIndex: z.number().int().default(0),
  start: z.number().nonnegative().default(0),
  end: z.number().positive().optional(),
  opacity: z.number().min(0).max(1).default(1),
  transform: transformSchema,
  motion: motionDefinitionSchema.optional(),
  blendMode: blendModeSchema.default('normal'),
  mask: maskSchema.optional(),
  filters: z.array(filterSchema).default([]),
};

const imageLayerSchema = z.object({
  ...baseLayerShape,
  type: z.literal('image'),
  asset: z.string().min(1),
  fit: z.enum(['cover', 'contain', 'fill']).default('cover'),
});
const videoLayerSchema = z.object({
  ...baseLayerShape,
  type: z.literal('video'),
  asset: z.string().min(1),
  muted: z.boolean().default(true),
  fit: z.enum(['cover', 'contain', 'fill']).default('cover'),
});
const textLayerSchema = z.object({
  ...baseLayerShape,
  type: z.literal('text'),
  text: z.string(),
  color: z.string().default('#ffffff'),
  fontSize: z.number().positive().default(72),
  fontWeight: z.number().int().min(100).max(900).default(700),
  align: z.enum(['left', 'center', 'right']).default('center'),
});
const shapeLayerSchema = z.object({
  ...baseLayerShape,
  type: z.literal('shape'),
  shape: z.enum(['rectangle', 'circle', 'gradient']),
  color: z.string().default('#ffffff'),
  width: z.number().positive().default(100),
  height: z.number().positive().default(100),
  radius: z.number().nonnegative().default(0),
  gradient: z.array(z.string()).min(2).optional(),
});
const spriteLayerSchema = z.object({
  ...baseLayerShape,
  type: z.literal('sprite'),
  asset: z.string().min(1),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
});
const particleLayerSchema = z.object({
  ...baseLayerShape,
  type: z.literal('particle-system'),
  preset: z.string().min(1),
  seed: z.union([z.string(), z.number().int()]).default(1),
  params: z.record(z.string(), z.unknown()).default({}),
});
const effectLayerSchema = z.object({
  ...baseLayerShape,
  type: z.literal('effect'),
  preset: z.string().min(1),
  seed: z.union([z.string(), z.number().int()]).default(1),
  params: z.record(z.string(), z.unknown()).default({}),
});

export const sceneLayerSchema = z.discriminatedUnion('type', [
  imageLayerSchema,
  videoLayerSchema,
  textLayerSchema,
  shapeLayerSchema,
  spriteLayerSchema,
  particleLayerSchema,
  effectLayerSchema,
]);
export type SceneLayer = z.infer<typeof sceneLayerSchema>;

export const sceneEffectSchema = timingSchema.extend({
  id: z.string().regex(/^[a-z0-9-]+$/),
  type: z.string().min(1),
  intensity: z.number().nonnegative().max(3).default(1),
  depth: sceneDepthSchema.default('screen'),
  blendMode: blendModeSchema.default('normal'),
  params: z.record(z.string(), z.unknown()).default({}),
});

export const sceneCameraSchema = z.object({
  preset: z.enum(sceneCameraPresets).default('static'),
  intensity: z.number().nonnegative().max(3).default(1),
  easing: z.enum(['linear', 'ease-in', 'ease-out', 'ease-in-out']).default('ease-in-out'),
  focusDepth: sceneDepthSchema.default('midground'),
});

export const sceneSchema = z
  .object({
    camera: sceneCameraSchema.default({
      preset: 'static',
      intensity: 1,
      easing: 'ease-in-out',
      focusDepth: 'midground',
    }),
    layers: z.array(sceneLayerSchema).min(1),
    effects: z.array(sceneEffectSchema).default([]),
  })
  .superRefine((scene, ctx) => {
    const ids = new Set<string>();
    for (const [index, item] of [...scene.layers, ...scene.effects].entries()) {
      if (ids.has(item.id))
        ctx.addIssue({
          code: 'custom',
          path: [
            index < scene.layers.length ? 'layers' : 'effects',
            index < scene.layers.length ? index : index - scene.layers.length,
            'id',
          ],
          message: `duplicate scene item id: ${item.id}`,
        });
      ids.add(item.id);
      if (item.end !== undefined && item.end <= item.start)
        ctx.addIssue({
          code: 'custom',
          path: [
            index < scene.layers.length ? 'layers' : 'effects',
            index < scene.layers.length ? index : index - scene.layers.length,
            'end',
          ],
          message: 'end must be greater than start',
        });
    }
  });
export type Scene = z.infer<typeof sceneSchema>;

const semanticDepth: Record<(typeof sceneDepths)[number], number> = {
  background: 0,
  midground: 40,
  foreground: 75,
  screen: 100,
};
export const numericDepth = (depth: SceneDepth): number =>
  typeof depth === 'number' ? depth : semanticDepth[depth];
export const sceneItemOrder = (item: { depth: SceneDepth; zIndex?: number }) =>
  numericDepth(item.depth) * 1000 + (item.zIndex ?? 0);
export const isVisibleAt = (item: { start: number; end?: number | undefined }, seconds: number) =>
  seconds >= item.start && (item.end === undefined || seconds < item.end);

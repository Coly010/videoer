import { z } from 'zod';

const vec3Schema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const identifierSchema = z.string().regex(/^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)*$/);

export const sceneTransformSchema = z.object({
  position: vec3Schema.default([0, 0, 0]),
  rotation: vec3Schema.default([0, 0, 0]),
  scale: vec3Schema.default([1, 1, 1]),
});

export const interactionPhaseSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  start: z.number().min(0).max(1),
  end: z.number().min(0).max(1),
  constraint: z.enum(['none', 'approach', 'point', 'attach', 'pivot', 'release']),
  actorEffector: z.string().optional(),
  targetAttachment: z.string().optional(),
});

export const interactionDefinitionSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: identifierSchema,
    type: z.enum(['turn', 'reach', 'open-door', 'hold-book', 'read-book']),
    actor: identifierSchema,
    target: identifierSchema.optional(),
    hand: z.enum(['left', 'right', 'both', 'none']).default('none'),
    phases: z.array(interactionPhaseSchema).min(1),
    invariants: z.array(z.enum(['contact', 'gaze', 'joint-limits', 'root-continuity'])).default([]),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .superRefine((interaction, ctx) => {
    let end = 0;
    const ids = new Set<string>();
    for (const [index, phase] of interaction.phases.entries()) {
      if (phase.start !== end)
        ctx.addIssue({
          code: 'custom',
          path: ['phases', index, 'start'],
          message: 'interaction phases must be contiguous and ordered',
        });
      if (phase.end <= phase.start)
        ctx.addIssue({
          code: 'custom',
          path: ['phases', index, 'end'],
          message: 'interaction phase end must follow start',
        });
      if (ids.has(phase.id))
        ctx.addIssue({
          code: 'custom',
          path: ['phases', index, 'id'],
          message: 'interaction phase ids must be unique',
        });
      if ((phase.actorEffector === undefined) !== (phase.targetAttachment === undefined))
        ctx.addIssue({
          code: 'custom',
          path: ['phases', index],
          message: 'actor effector and target attachment must be declared together',
        });
      ids.add(phase.id);
      end = phase.end;
    }
    if (Math.abs(end - 1) > 1e-9)
      ctx.addIssue({
        code: 'custom',
        path: ['phases'],
        message: 'interaction phases must cover the complete normalized interval',
      });
    if (!interaction.target && interaction.phases.some((phase) => phase.targetAttachment))
      ctx.addIssue({
        code: 'custom',
        path: ['target'],
        message: 'target-bound phases require an interaction target',
      });
  });

export type SceneTransform = z.infer<typeof sceneTransformSchema>;
export type InteractionDefinition = z.infer<typeof interactionDefinitionSchema>;

export function interactionPhaseAt(interaction: InteractionDefinition, progress: number) {
  const normalized = Math.max(0, Math.min(1, progress));
  return interaction.phases.find(
    (phase, index) =>
      normalized >= phase.start &&
      (normalized < phase.end || (index === interaction.phases.length - 1 && normalized === 1)),
  );
}

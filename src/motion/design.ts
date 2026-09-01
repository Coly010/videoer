import { z } from 'zod';

const phaseIdSchema = z.string().regex(/^[a-z][a-z0-9-]*$/);

export const motionParameterSchema = z.object({
  id: phaseIdSchema,
  default: z.number().finite(),
  minimum: z.number().finite(),
  maximum: z.number().finite(),
  unit: z.enum(['ratio', 'seconds', 'meters', 'meters-per-second', 'degrees', 'steps-per-minute']),
});

export const motionPhaseSchema = z.object({
  id: phaseIdSchema,
  start: z.number().min(0).max(1),
  end: z.number().min(0).max(1),
  description: z.string().min(1),
});

export const motionContactSchema = z.object({
  id: phaseIdSchema,
  effector: z.string().min(1),
  target: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('ground-plane'), height: z.number().finite().default(0) }),
    z.object({ kind: z.literal('scene-point'), reference: z.string().min(1) }),
    z.object({ kind: z.literal('moving-point'), reference: z.string().min(1) }),
  ]),
  phases: z.array(phaseIdSchema).min(1),
  mode: z.enum(['touch', 'plant', 'attach', 'pivot']),
});

export const motionLayerSchema = z.object({
  id: phaseIdSchema,
  role: z.enum(['base', 'additive', 'override', 'constraint', 'secondary']),
  joints: z.array(z.string().min(1)).min(1),
  description: z.string().min(1),
});

export const motionInvariantSchema = z.object({
  id: phaseIdSchema,
  type: z.enum([
    'contact-lock',
    'ground-clearance',
    'joint-limit',
    'root-continuity',
    'centre-of-mass-continuity',
    'target-attachment',
  ]),
  tolerance: z.number().nonnegative(),
  unit: z.enum(['meters', 'meters-per-second', 'radians', 'ratio']),
  description: z.string().min(1),
});

export const motionDesignSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(/^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)*$/),
    category: z.enum([
      'locomotion',
      'orientation',
      'posture',
      'reaching',
      'environment-interaction',
      'prop-interaction',
      'cinematic-emotional',
    ]),
    description: z.string().min(1),
    parameters: z.array(motionParameterSchema).default([]),
    phases: z.array(motionPhaseSchema).min(1),
    contacts: z.array(motionContactSchema).default([]),
    layers: z.array(motionLayerSchema).min(1),
    invariants: z.array(motionInvariantSchema).default([]),
    research: z.object({
      sources: z.array(z.string().url()).default([]),
      notes: z.array(z.string()).default([]),
    }),
  })
  .superRefine((design, ctx) => {
    const phaseIds = new Set<string>();
    for (const [index, phase] of design.phases.entries()) {
      if (phase.start >= phase.end)
        ctx.addIssue({
          code: 'custom',
          path: ['phases', index],
          message: 'phase start must precede end',
        });
      if (phaseIds.has(phase.id))
        ctx.addIssue({
          code: 'custom',
          path: ['phases', index, 'id'],
          message: 'duplicate phase id',
        });
      phaseIds.add(phase.id);
    }
    for (const [index, contact] of design.contacts.entries())
      for (const phase of contact.phases)
        if (!phaseIds.has(phase))
          ctx.addIssue({
            code: 'custom',
            path: ['contacts', index, 'phases'],
            message: `contact references unknown phase '${phase}'`,
          });
    for (const [index, parameter] of design.parameters.entries())
      if (parameter.minimum > parameter.default || parameter.default > parameter.maximum)
        ctx.addIssue({
          code: 'custom',
          path: ['parameters', index],
          message: 'parameter default must lie within its bounds',
        });
  });

export type MotionDesign = z.infer<typeof motionDesignSchema>;

export function phaseAt(design: MotionDesign, phase: number) {
  const normalized = ((phase % 1) + 1) % 1;
  return design.phases.find(
    (candidate) => normalized >= candidate.start && normalized < candidate.end,
  );
}

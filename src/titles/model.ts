import { z } from 'zod';

export const titleTreatmentSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(/^(?:material|editorial)\.[a-z0-9-]+(?:\.[a-z0-9-]+)*$/),
    canvas: z.object({
      width: z.number().int().min(240).max(3840),
      height: z.number().int().min(240).max(3840),
    }),
    safeArea: z.object({
      left: z.number().int().nonnegative(),
      top: z.number().int().nonnegative(),
      right: z.number().int().positive(),
      bottom: z.number().int().positive(),
    }),
    font: z.object({
      family: z.literal('Cormorant Garamond'),
      weight: z.literal(600),
      licence: z.literal('OFL-1.1'),
      package: z.literal('@fontsource/cormorant-garamond@5.3.0'),
      nativeInstall: z.literal('font-cormorant-garamond'),
    }),
    copy: z.object({
      eyebrow: z.string().min(1),
      title: z.string().min(1),
      cta: z.string().min(1),
    }),
    palette: z.object({
      background: z.string().regex(/^#[0-9a-f]{6}$/),
      foreground: z.string().regex(/^#[0-9a-f]{6}$/),
      accent: z.string().regex(/^#[0-9a-f]{6}$/),
    }),
    motif: z.object({ kind: z.literal('threshold-lines'), opacity: z.number().min(0).max(1) }),
    typographyScale: z.number().min(0.75).max(1.3).default(1),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .superRefine((treatment, context) => {
    if (
      treatment.safeArea.left >= treatment.safeArea.right ||
      treatment.safeArea.top >= treatment.safeArea.bottom ||
      treatment.safeArea.right > treatment.canvas.width ||
      treatment.safeArea.bottom > treatment.canvas.height
    )
      context.addIssue({
        code: 'custom',
        path: ['safeArea'],
        message: 'editorial safe area must be a positive rectangle inside the canvas',
      });
  });

export type TitleTreatment = z.infer<typeof titleTreatmentSchema>;
